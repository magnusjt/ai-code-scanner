import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '../.env-local') })
import { Configuration, OpenAIApi } from 'openai'
import { FileScannerOptions, getFilesInDirDepthFirst } from './util/getFilesInDirDepthFirst'
import { AnalyzerOptions, createAnalyzeFiles } from './analyzeFiles'
import fs from 'fs'
import { Logger, LoggerOptions } from './util/logger'
import { mkdirp } from 'mkdirp'

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

    for await (const r of analyzeFiles(appConfig.inputDirectory, filePaths)) {
        const absoluteFilePath = path.join(appConfig.outputDirectory, r.filePath + '.result.txt')
        const dir = path.dirname(absoluteFilePath)
        if (!appConfig.analyzerOptions.dryRun) {
            mkdirp.mkdirpSync(dir)
            fs.writeFileSync(absoluteFilePath, r.result)
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
        dryRun: false,
        systemPrompt: [
            'You are a senior fullstack developer.',
            'You are an expert on the typescript programming language.',
            'You care deeply about readable and maintainable code.',
            'You pay close attention to technical details, and make sure the code is correct.',
            'You pay extra close attention to function names, and that the function does what it says it does.',
            'You know how to write secure software, and can spot security issues.',
            'Your task is to review the code given to you.',
            'You MUST look for bugs, security issues, readability, maintainability, and possible improvements.',
            'You should verify that the code is up to date with modern standards.',
            'You MUST think through the code step by step before committing to your final answer.',
            'You MUST give your final answer as bullet point lists.',
            'There should be a separate list for each category of review.',
            'When the code is good, you should say so, and not elaborate',
            'You MUST not attempt to explain the code.',
            'You MUST only review the code after filePath={filePath}.',
            'The code that comes before filePath={filePath} may only be used for reference.',
        ].join('\n'),
        enableSelfAnalysis: false,
        selfAnalysisPrompt: [
            'Please analyze the code and the code review, and give an improved answer.'
        ].join('\n'),
        textProcessing: {
            continuedContentPrefix: '// ...previous code snipped\n\n',
            snippedContentPostfix: '\n\n// ...rest of code snipped',
            contextPrefix: '', //'CONTEXT\n',
            contextPostfix: '', //\nCONTEXT END\n',
            filePathPrefixTemplate: '// filePath={filePath}\n\n'
        }
    },
    loggerOptions: {
        level: 'debug'
    }
})
