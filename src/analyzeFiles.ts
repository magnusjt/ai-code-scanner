import { OpenAIApi } from 'openai'
import _ from 'lodash'
import fs from 'fs/promises'
import path from 'path'
import { ChatCompletionRequestMessage, CreateChatCompletionRequest } from 'openai/api'
import { Logger } from './util/logger'
import { AxiosError } from 'axios'
import { retry } from './util/retry'
import { getLLMTokensFromString } from './util/getLLMTokensFromString'

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
        /** Text prefixed to the context. The idea is to help the AI separate the context from the content */
        contextPrefix: string
        /** Text postfixed to the context. The idea is to help the AI separate the context from the content */
        contextPostfix: string
        /** When the content is too large for a single request, add this prefix to subsequent requests */
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

type File = {
    filePath: string
    content: string
}
type Context = File[]

export const createAnalyzeFiles = (
    ai: OpenAIApi,
    options: AnalyzerOptions,
    logger: Logger
) => async function* (
    baseDirectory: string,
    filePaths: string[]
): AsyncGenerator<{ result: string, filePath: string }, void, void> {
    let context: Context = []

    for (const filePath of filePaths) {
        logger.info('Analyzing file' + filePath)

        const content = await fs.readFile(path.join(baseDirectory, filePath), 'utf-8')

        const file: File = {
            filePath,
            content
        }

        const results = await analyzeFileWithContext(ai, options, logger, file, context)

        logger.info('Done analyzing file ' + filePath)

        yield { result: results.join('\n\n-----continued-----\n\n'), filePath }

        context.push(file)

        // Keep max 10 files in context. No particular reason.
        if (context.length > 10) {
            context = context.slice(1)
        }
    }
}

const analyzeFileWithContext = async (ai: OpenAIApi, options: AnalyzerOptions, logger: Logger, file: File, context: Context): Promise<string[]> => {
    const tokensWithFilePath = [...context, file]
        .flatMap(f => getLLMTokensFromString(f.content).map(token => ({ token, filePath: f.filePath })))

    let nextStart = tokensWithFilePath.findIndex(t => t.filePath === file.filePath)
    nextStart -= Math.floor(options.maxSourceTokensPerRequest / 2) // Use about half of the request for contextual info
    if (nextStart < 0) {
        nextStart = 0
    }

    const results: string[] = []

    while (true) {
        const wasContinued = tokensWithFilePath.at(nextStart - 1)?.filePath === file.filePath
        const slice = tokensWithFilePath.slice(nextStart, nextStart + options.maxSourceTokensPerRequest)
        nextStart += options.maxSourceTokensPerRequest
        const hasMoreLeftToAnalyze = nextStart < tokensWithFilePath.length
        if (slice.length === 0) {
            break
        }

        const values = _(slice)
            .groupBy('filePath')
            .mapValues((tokens, filePath) => {
                const prefix = options.textProcessing.filePathPrefixTemplate.replaceAll(/\{filePath}/g, filePath)
                return prefix + tokens.map(t => t.token).join('')
            })
            .values()
            .value()

        const contextContent = values.length > 0 ? values.slice(0, -1).join('\n') : ''
        const content = values.at(-1)!

        const userPrompt = [
            contextContent.length > 0 ? options.textProcessing.contextPrefix : '',
            contextContent.length > 0 ? options.textProcessing.continuedContentPrefix : '',
            contextContent.length > 0 ? contextContent : '',
            contextContent.length > 0 ? options.textProcessing.contextPostfix : '',
            contextContent.length > 0 ? '\n\n' : '',
            wasContinued ? options.textProcessing.continuedContentPrefix : '',
            content,
            hasMoreLeftToAnalyze ? options.textProcessing.snippedContentPostfix : ''
        ].join('')

        const systemPrompt = options.systemPrompt.replaceAll(/\{filePath}/g, file.filePath)

        const messages: ChatCompletionRequestMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]

        let result = await runAiOverlordAnalyzer(ai, options, logger, messages)
        if (options.enableSelfAnalysis) {
            const selfAnalysisMessages: ChatCompletionRequestMessage[] = [
                ...messages,
                { role: 'assistant', content: result },
                { role: 'user', content: options.selfAnalysisPrompt }
            ]
            const improvedResult = await runAiOverlordAnalyzer(ai, options, logger, selfAnalysisMessages)
            result += '\n\n----- Improved result -----\n\n'
            result += improvedResult
        }

        results.push(result)

        if (hasMoreLeftToAnalyze) {
            // Repeat some of the tokens next time to get more context.
            nextStart -= Math.floor(options.maxSourceTokensPerRequest / 10)
        }
    }

    return results
}

const runAiOverlordAnalyzer = async (
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

    const shouldRetry = err => (err as AxiosError).status === 429
    const res = await retry(() => ai.createChatCompletion(request), shouldRetry, logger)

    logger.debug('Request result')
    logger.debug(JSON.stringify(res.data, null, 2))

    return res.data.choices.at(-1)!.message!.content!
}
