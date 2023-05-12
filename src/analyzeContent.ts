import { OpenAIApi } from 'openai'
import _ from 'lodash'
import fs from 'fs/promises'
import { CreateChatCompletionRequest } from 'openai/api'
import { Logger } from './util/logger'
import { delay } from './util/delay'
import { AxiosError } from 'axios'

type File = {
    filePath: string
    content: string
}
type Context = File[]

export type AnalyzerOptions = {
    model: 'gpt-4' | 'gpt-4-0314' | 'gpt-4-32k' | 'gpt-4-32k-0314' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0301'
    maxTokensPerRequest: number
    dryRun: boolean
}

const getTokens = (content: string) => {
    const tokens: string[] = []
    let nextToken = ''
    for (const char of content.split('')) {
        nextToken = nextToken.concat(char)
        if (nextToken.length >= 4) { // Apparently a token is around 4 characters
            tokens.push(nextToken)
            nextToken = ''
        }
    }
    if (nextToken.length > 0) {
        tokens.push(nextToken)
    }
    return tokens
}

export const createAnalyzeFiles = (ai: OpenAIApi, options: AnalyzerOptions, logger: Logger) => async function* (filePaths: string[]): AsyncGenerator<{ result: string, filePath: string }, void, void> {
    let context: Context = []

    for (const filePath of filePaths) {
        logger.info('Analyzing file' + filePath)

        const content = await fs.readFile(filePath, 'utf-8')

        const results = await analyzeFileWithContext(ai, options, logger, { filePath, content }, context)

        logger.info('Done analyzing file ' + filePath)

        yield { result: results.join('\n\n-----continued-----\n\n'), filePath }

        context.push({ filePath, content })

        // Keep max 10 files in context. No particular reason.
        if (context.length > 10) {
            context = context.slice(1)
        }
    }
}

const analyzeFileWithContext = async (ai: OpenAIApi, options: AnalyzerOptions, logger: Logger, file: File, context: Context): Promise<string[]> => {
    const tokensWithFilePath = [...context, file]
        .flatMap(f => getTokens(f.content).map(token => ({ token, filePath: f.filePath })))

    let nextStart = tokensWithFilePath.findIndex(t => t.filePath === file.filePath)
    nextStart -= Math.floor(options.maxTokensPerRequest / 2) // Use about half of the request for contextual info
    if (nextStart < 0) {
        nextStart = 0
    }

    const results: string[] = []

    while (true) {
        const slice = tokensWithFilePath.slice(nextStart, nextStart + options.maxTokensPerRequest)
        nextStart += options.maxTokensPerRequest
        if (slice.length === 0) {
            break
        }

        const values = _(slice)
            .groupBy('filePath')
            .mapValues((tokens, filePath) => {
                return `// filePath=${filePath}\n\n` + tokens.map(t => t.token).join('')
            })
            .values()
            .value()

        const contextContent = values.length > 0 ? values.slice(0, -1).join('\n') : ''
        let content = values.at(-1)!

        // Attempt to tell the AI that the request doesn't contain the complete code
        if (tokensWithFilePath.length > nextStart) {
            content += '\n// ...rest of code snipped'
        }
        if (tokensWithFilePath.at(nextStart - options.maxTokensPerRequest - 1)?.filePath === file.filePath) {
            content = '// ...previous code snipped\n' + content
        }

        const result = await runAiOverlordAnalyzer(ai, options, logger, contextContent, content)
        results.push(result)
    }

    return results
}

const runAiOverlordAnalyzer = async (ai: OpenAIApi, options: AnalyzerOptions, logger: Logger, context: string, content: string): Promise<string> => {
    const request: CreateChatCompletionRequest = {
        model: options.model,
        messages: [{
            role: 'system',
            content: `You are given a piece of code, and your task is to analyze the code for bugs, issues, and readability. You are also given some related code, starting with the word CONTEXT and ending with CONTEXT END. Give a concise answer with bullet points. Think step by step.`
        }, {
            role: 'user',
            content: 'CONTEXT\n' + context + '\nCONTEXT END\n'
        }, {
            role: 'user',
            content
        }]
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

const retry = async <T>(
    func: () => Promise<T>,
    shouldRetry: (err: unknown) => boolean,
    logger: Logger
) => {
    let n = 0
    while (n++ < 10) {
        try {
            return await func()
        } catch (err: unknown) {
            logger.warn(err)
            if (!shouldRetry(err)) {
                throw err
            }
        }
        await delay(10000 * n)
    }
    throw new Error('Max retries exceeded')
}