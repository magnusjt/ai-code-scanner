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
            'You are a professional code reviewer. Your task is to analyze the code for bugs, issues, and readability.',
            'Related code is given starting with the word CONTEXT and ending with CONTEXT END. You should not review this related code directly, but you can refer to it.',
            'Give a concise answer with bullet points. Think step by step.'
        ].join(' '),
        textProcessing: {
            continuedContentPrefix: '// ...previous code snipped\n\n',
            snippedContentPostfix: '\n\n// ...rest of code snipped',
            contextPrefix: 'CONTEXT\n',
            contextPostfix: '\nCONTEXT END\n',
            filePathPrefixTemplate: '// filePath={filePath}\n\n'
        }
    },
    loggerOptions: {
        level: 'debug'
    }
})
