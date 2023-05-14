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
    textProcessing: {
        continuedContentPrefix: string
        /** When the content is too large for a single request, add this postfix to indicate that there is more after this */
        snippedContentPostfix: string
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

export const createAnalyzeFiles = (
    ai: OpenAIApi,
    options: AnalyzerOptions,
    logger: Logger
) => async function* (
    baseDirectory: string,
    filePaths: string[]
): AsyncGenerator<{ result: string, filePath: string }, void, void> {
    let analysisTokens: AnalysisToken[] = []

    for (const filePath of filePaths) {
        logger.info('Analyzing file ' + filePath)

        const content = await fs.readFile(path.join(baseDirectory, filePath), 'utf-8')
        const tokens = getLLMTokensFromString(content)
        analysisTokens.push(...tokens.map(token => ({ token, filePath })))

        const result = await analyzeTokens(ai, options, logger, analysisTokens, filePath)

        logger.info('Done analyzing file ' + filePath)

        yield { result: result, filePath }

        analysisTokens = analysisTokens.slice(-40_000)
    }
}

const analyzeTokens = async (
    ai: OpenAIApi,
    options: AnalyzerOptions,
    logger: Logger,
    analysisTokens: AnalysisToken[],
    currentFilePath: string
): Promise<string> => {
    const startOfFile = analysisTokens.findIndex(t => t.filePath === currentFilePath)
    const startOfAnalysis = startOfFile - Math.floor(options.maxSourceTokensPerRequest / 2) // Use about half of the request for contextual info
    const start = startOfAnalysis < 0 ? 0 : startOfAnalysis
    const results: string[] = []

    for (let curr = start; curr < analysisTokens.length; curr += options.maxSourceTokensPerRequest - Math.floor(options.maxSourceTokensPerRequest / 10)) {
        const slice = analysisTokens.slice(curr, curr + options.maxSourceTokensPerRequest)

        const wasContinued = curr >= 1 && analysisTokens.at(curr - 1)?.filePath === currentFilePath
        const wasSnipped = analysisTokens.at(curr + options.maxSourceTokensPerRequest)?.filePath === currentFilePath

        const messages = createAiInitialChatMessages(options, currentFilePath, slice, wasContinued, wasSnipped)
        let result = await sendAiRequest(ai, options, logger, messages)

        if (options.enableSelfAnalysis) {
            const selfAnalysisMessages = createAiSelfAnalysisMessages(options, currentFilePath, messages, result)
            const improvedResult = await sendAiRequest(ai, options, logger, selfAnalysisMessages)
            result += '\n\n----- Improved result -----\n\n'
            result += improvedResult
        }

        results.push(result)

        if (slice.length < options.maxSourceTokensPerRequest) {
            break
        }
    }

    return results.join('\n\n-----continued-----\n\n')
}

const createAiInitialChatMessages = (
    options: AnalyzerOptions,
    currentFilePath: string,
    slice: AnalysisToken[],
    sliceWasContinued: boolean,
    sliceWasSnipped: boolean
) => {
    const files = _(slice)
        .groupBy('filePath')
        .mapValues((tokens, filePath) => ({ filePath, content: tokens.map(t => t.token).join('') }))
        .values()
        .value()

    const getFilePathPrefix = (filePath: string) => interpolateTemplate(options.textProcessing.filePathPrefixTemplate, { filePath })

    const contextFiles = files.length > 0 ? files.slice(0, -1) : []
    const contentFile = files.at(-1)!

    const userPrompt = [
        ...(contextFiles.length > 0 ? [options.textProcessing.continuedContentPrefix] : []),
        ...contextFiles.flatMap(file => [getFilePathPrefix(file.filePath), file.content]),
        getFilePathPrefix(contentFile.filePath),
        ...(sliceWasContinued ? [options.textProcessing.continuedContentPrefix] : []),
        contentFile.content,
        ...(sliceWasSnipped ? [options.textProcessing.snippedContentPostfix] : [])
    ].join('\n\n')

    const systemPrompt = interpolateTemplate(options.systemPrompt, { filePath: currentFilePath })

    const messages: ChatCompletionRequestMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ]

    return messages
}

const createAiSelfAnalysisMessages = (
    options: AnalyzerOptions,
    currentFilePath: string,
    previousMessages: ChatCompletionRequestMessage[],
    previousResult: string
) => {
    const messages: ChatCompletionRequestMessage[] = [
        ...previousMessages,
        { role: 'assistant', content: previousResult },
        { role: 'user', content: interpolateTemplate(options.selfAnalysisPrompt, { filePath: currentFilePath }) }
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
        messages
    }

    logger.debug('Sending request')
    logger.debug(request)

    if (options.dryRun) {
        return 'Dry-run'
    }

    const shouldRetry = (err: unknown) => (err as AxiosError)?.status === 429
    const res = await retry(() => ai.createChatCompletion(request), shouldRetry, logger)

    logger.debug('Request result')
    logger.debug(JSON.stringify(res.data, null, 2))

    return res.data.choices.at(-1)?.message?.content ?? 'Empty response'
}
