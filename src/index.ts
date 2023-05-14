import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '../.env-local') })
import { Configuration, OpenAIApi } from 'openai'
import { FileScannerOptions, getFilesInDirDepthFirst } from './util/getFilesInDirDepthFirst'
import { AnalyzerOptions, createAnalyzeFiles } from './analyzeFiles'
import fs from 'fs'
import { Logger, LoggerOptions } from './util/logger'
import { mkdirp } from 'mkdirp'
import _ from 'lodash'
import { DateTime } from 'luxon'

type AppConfig = {
    inputDirectory: string
    outputDirectory: string
    fileScannerOptions: FileScannerOptions
    loggerOptions: LoggerOptions
    analyzerOptions: AnalyzerOptions
}

const run = async (appConfig: AppConfig) => {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY must be set')
    }

    const config = new Configuration({ apiKey })
    const client = new OpenAIApi(config)
    const logger = new Logger(appConfig.loggerOptions)

    const filePaths = getFilesInDirDepthFirst(appConfig.inputDirectory, './', appConfig.fileScannerOptions)

    logger.info('Analyzing files')
    logger.info(JSON.stringify(filePaths, null, 2))

    const analyzeFiles = createAnalyzeFiles(client, appConfig.analyzerOptions, logger)

    for await (const { result, filePaths: resultFilePaths } of analyzeFiles(appConfig.inputDirectory, filePaths)) {
        const dirs = resultFilePaths.map(filePath => path.dirname(filePath))
        const shortestDir = _.sortBy(dirs, dir => dir.length)[0]
        const timeStr = DateTime.now().toFormat('yyyyMMddHHmmss')
        const absoluteFilePath = path.join(appConfig.outputDirectory, shortestDir, `result.${timeStr}.txt`)
        const outContent = [
            'Summary',
            result.summary,
            'Re-analyzed result',
            result.improvedResult,
            'Initial result',
            result.initialResult
        ].join('\n\n')

        if (!appConfig.analyzerOptions.dryRun) {
            mkdirp.mkdirpSync(path.dirname(absoluteFilePath))
            fs.writeFileSync(absoluteFilePath, outContent)
        }
    }
}

run({
    inputDirectory: path.join(__dirname, '../'),
    outputDirectory: path.join(__dirname, '../.output'),
    fileScannerOptions: {
        include:  [/\.ts$/],
        exclude: [/node_modules/, /\.env/],
    },
    analyzerOptions: {
        model: 'gpt-3.5-turbo',
        maxSourceTokensPerRequest: 2000,
        maxResultTokens: 800,
        dryRun: false,
        systemPrompt: [
            'You are a senior fullstack developer.',
            'You are an expert on the typescript programming language.',
            'You care deeply about readable and maintainable code.',
            'You pay close attention to technical details, and make sure the code is correct.',
            'You pay extra close attention to function names, and that the function does what it says it does.',
            'You know how to write secure software, and can spot security issues.',
            'Your task is to review the code given to you.',
            'You MUST look for bugs, security issues, readability, maintainability, performance, and other possible improvements.',
            'You should verify that the code is up to date with modern standards.',
            'You MUST think through the code step by step before committing to your final answer.',
            'You MUST give your final answer as bullet point lists.',
            'There should be a separate list for each category of review.',
            'If the code is good, just say LGTM. Don\'t elaborate.',
            'Always be concrete about your suggestions. Point to specific examples, and explain why they need improvement.',
            'You MUST NOT attempt to explain the code.',
            'You MUST review all code files.',
            'You MUST always indicate which code file or files you are reviewing.',
            'The start of each code file is always indicated by a comment with its path, like this: // file = filepath.ts.'
        ].join('\n'),
        enableSelfAnalysis: true,
        selfAnalysisPrompt: [
            'Please re-analyze the code and code review, and give an improved answer where possible.'
        ].join('\n'),
        enableSummary: true,
        summaryPrompt: [
            'Please summarize all your findings so far into a short bullet point list. Max 10 items.'
        ].join('\n'),
        textProcessing: {
            prefix: '// ...previous code snipped',
            postfix: '// ...rest of code snipped',
            filePathPrefixTemplate: '// file = {filePath}'
        }
    },
    loggerOptions: {
        level: 'debug'
    }
})
