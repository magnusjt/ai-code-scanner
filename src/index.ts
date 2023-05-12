import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '../.env-local') })
import { Configuration, OpenAIApi } from 'openai'
import { FileScannerOptions, getFilesInDirDepthFirst } from './util/getFilesInDirDepthFirst'
import { AnalyzerOptions, createAnalyzeFiles } from './analyzeContent'
import fs from 'fs'
import { Logger, LoggerOptions } from './util/logger'

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

    const filePaths = getFilesInDirDepthFirst(appConfig.inputDirectory, appConfig.fileScannerOptions)

    logger.info('Analyzing files')
    logger.info(JSON.stringify(filePaths, null, 2))

    const analyzeFiles = createAnalyzeFiles(client, appConfig.analyzerOptions, logger)

    for await ( const r of analyzeFiles(filePaths)) {
        const resultFileName = r.filePath.replaceAll(/\W/g, '') + '.result.txt'
        const outputFilePath = path.join(appConfig.outputDirectory, resultFileName)
        if (!appConfig.analyzerOptions.dryRun) {
            fs.writeFileSync(outputFilePath, r.result)
        }
    }
}

run({
    inputDirectory: path.join(__dirname, './'),
    outputDirectory: path.join(__dirname, '../.output'),
    fileScannerOptions: {
        include:  [/\.ts$/],
        exclude: [/node_modules/, /\.env/],
    },
    analyzerOptions: {
        model: 'gpt-3.5-turbo',
        maxTokensPerRequest: 2000,
        dryRun: false,
    },
    loggerOptions: {
        level: 'info'
    }
})