import { OpenAIApi } from 'openai'
import _ from 'lodash'
import fs from 'fs/promises'
import path from 'path'
import { ChatCompletionRequestMessage, CreateChatCompletionRequest } from 'openai/api'
import { Logger } from './util/logger'
import { AxiosError } from 'axios'
import { retry } from './util/retry'
import { getLLMTokensFromString } from './util/getLLMTokensFromString'
import { interpolateTemplate } from './util/interpolateTemplate'

export type AnalyzerOptions = {
    model: 'gpt-4' | 'gpt-4-0314' | 'gpt-4-32k' | 'gpt-4-32k-0314' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0301'
    /**
     * This refers to the number of tokens picked from the source files.
     * Make sure to keep this quite a bit lower than the supported token number for the model.
     * A good ballpark number is to subtract around 2000 tokens from the supported token number for the model.
     *
     * Why? The supported token number must have room for both the source file tokens,
     * the system prompt, and crucially, the answer from the AI.
     *
     * Supported tokens for the different models:
     * - gpt-4 - 8,192. Set to 6 000
     * - gpt-4-32k - 32,768. Set to 30 0000
     * - gpt-3.5-turbo - 4096. Set to 2 000.
     */
    maxSourceTokensPerRequest: number
    /**
     * Max number of tokens for the AI to generate each time
     * Take care to reduce this if using self-analysis and/or summary.
     * The total number of tokens include both system, user, and assistant prompts.
     */
    maxResultTokens: number
    /**
     * When dryRun is enabled, no api requests will be sent
     */
    dryRun: boolean
    systemPrompt: string
    /**
     * Enable self-analysis, i.e. asking the AI to improve its answer.
     * Uses the selfAnalysisPrompt to ask for an improvement.
     */
    enableSelfAnalysis: boolean
    selfAnalysisPrompt: string
    /**
     * Enable summary, i.e. asking the AI summarize its answer.
     * Uses the summaryPrompt
     */
    enableSummary: boolean
    summaryPrompt: string
    textProcessing: {
        /** Prefix all user chat messages */
        prefix: string
        /** Postfix all user chat messages */
        postfix: string
        /**
         * Prefixes the start of each file content with the filepath. The idea is to help the AI understand the architecture better
         * Example: "// filePath={filePath}"
         */
        filePathPrefixTemplate: string
    }
}

type AnalysisToken = {
    token: string
    filePath: string
}
type SlicePart = {
    filePath: string
    content: string
}
type Result = {
    initialResult: string
    improvedResult: string
    summary: string
}
type Slice = SlicePart[]

export const createAnalyzeFiles = (
    ai: OpenAIApi,
    options: AnalyzerOptions,
    logger: Logger
) => async function* (
    baseDirectory: string,
    filePaths: string[]
): AsyncGenerator<{ result: Result, filePaths: string[] }, void, void> {
    for await (const slice of getContentSlices(logger, options, baseDirectory, filePaths)) {
        const result = await analyzeSlice(ai, options, logger, slice)

        yield { result, filePaths: slice.map(part => part.filePath) }
    }
}

const getContentSlices = async function*(
    logger: Logger,
    options: AnalyzerOptions,
    baseDirectory: string,
    filePaths: string[]
): AsyncGenerator<Slice, void, void> {
    let analysisTokens: AnalysisToken[] = []

    for (const filePath of filePaths) {
        logger.info('Loading file ' + filePath)

        const content = await fs.readFile(path.join(baseDirectory, filePath), 'utf-8')
        const tokens = getLLMTokensFromString(content)
        analysisTokens.push(...tokens.map(token => ({ token, filePath })))

        while (analysisTokens.length > options.maxSourceTokensPerRequest) {
            const analysisTokensSlice = analysisTokens.slice(0, options.maxSourceTokensPerRequest)
            yield analysisTokensToSlice(analysisTokensSlice)
            // Cut off the slice, but keep a bit near the end to not lose too much context
            analysisTokens = analysisTokens.slice(options.maxSourceTokensPerRequest - Math.floor(options.maxSourceTokensPerRequest / 10))
        }
    }

    if (analysisTokens.length > 0) {
        yield analysisTokensToSlice(analysisTokens)
    }
}

const analysisTokensToSlice = (tokenSlice: AnalysisToken[]): Slice => {
    return _(tokenSlice)
        .groupBy('filePath')
        .mapValues((tokens, filePath) => ({ filePath, content: tokens.map(t => t.token).join('') }))
        .values()
        .value()
}

const analyzeSlice = async (
    ai: OpenAIApi,
    options: AnalyzerOptions,
    logger: Logger,
    slice: Slice,
): Promise<Result> => {
    const messages = createAiInitialChatMessages(options, slice)
    const initialResult = await sendAiRequest(ai, options, logger, messages)

    const selfAnalysisMessages = createAiSelfAnalysisMessages(options, messages, initialResult)

    let improvedResult = ''
    if (options.enableSelfAnalysis) {
        improvedResult = await sendAiRequest(ai, options, logger, selfAnalysisMessages)
    }

    // Skip the initial result for the rest of the analysis to avoid spending too many tokens
    const finalResult = improvedResult !== '' ? improvedResult : initialResult

    const summaryMessages = createAiSummaryMessages(options, messages, finalResult)

    let summary = ''
    if (options.enableSummary) {
        summary = await sendAiRequest(ai, options, logger, summaryMessages)
    }

    return { initialResult, improvedResult, summary }
}

const createAiInitialChatMessages = (
    options: AnalyzerOptions,
    slice: Slice
) => {
    const userPrompt = [
        options.textProcessing.prefix,
        ...slice.flatMap(({ filePath, content }) => [
            interpolateTemplate(options.textProcessing.filePathPrefixTemplate, { filePath }),
            content
        ]),
        options.textProcessing.postfix
    ].join('\n')

    const messages: ChatCompletionRequestMessage[] = [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: userPrompt }
    ]

    return messages
}

const createAiSelfAnalysisMessages = (
    options: AnalyzerOptions,
    previousMessages: ChatCompletionRequestMessage[],
    previousResult: string
) => {
    const messages: ChatCompletionRequestMessage[] = [
        ...previousMessages,
        { role: 'assistant', content: previousResult },
        { role: 'user', content: options.selfAnalysisPrompt }
    ]

    return messages
}

const createAiSummaryMessages = (
    options: AnalyzerOptions,
    previousMessages: ChatCompletionRequestMessage[],
    previousResult: string
) => {
    const messages: ChatCompletionRequestMessage[] = [
        ...previousMessages,
        { role: 'assistant', content: previousResult },
        { role: 'user', content: options.summaryPrompt }
    ]

    return messages
}

const sendAiRequest = async (
    ai: OpenAIApi,
    options: AnalyzerOptions,
    logger: Logger,
    messages: ChatCompletionRequestMessage[]
): Promise<string> => {
    const request: CreateChatCompletionRequest = {
        model: options.model,
        messages,
        max_tokens: options.maxResultTokens
    }

    logger.debug('Sending request')
    logger.debug(request)

    if (options.dryRun) {
        return 'Dry-run'
    }

    const shouldRetry = (err: unknown) => (err as AxiosError)?.response?.status === 429
    const res = await retry(() => ai.createChatCompletion(request), shouldRetry, logger)

    logger.debug('Request result')
    logger.debug(JSON.stringify(res.data, null, 2))

    return res.data.choices.at(-1)?.message?.content ?? 'Empty response'
}
