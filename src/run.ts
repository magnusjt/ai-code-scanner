import { FileScannerOptions, getFilesInDirDepthFirst } from './util/getFilesInDirDepthFirst'
import { Logger, LoggerOptions } from './util/logger'
import { AnalyzerOptions, createAnalyzeFiles, Result } from './analyzeFiles'
import { Configuration, OpenAIApi } from 'openai'
import axios from 'axios'
import { DateTime } from 'luxon'
import path from 'path'
import _ from 'lodash'
import { mkdirp } from 'mkdirp'
import fs from 'fs'

type AppConfig = {
    inputDirectory: string
    outputDirectory: string
    fileScannerOptions: FileScannerOptions
    loggerOptions: LoggerOptions
    analyzerOptions: AnalyzerOptions
    apiEndpoint: {
        type: 'openai'
        apiKey: string
    } | {
        type: 'azure'
        apiKey: string
        host: string
        deploymentId: string
    }
}

const createOpenAIClient = (appConfig: AppConfig) => {
    const config = new Configuration({ apiKey: appConfig.apiEndpoint.apiKey })
    const axiosInstance = axios.create()

    if (appConfig.apiEndpoint.type === 'azure') {
        axiosInstance.interceptors.request.use(request => {
            request.url += `?api-version=2023-03-15-preview`
            request.headers.set('api-key', appConfig.apiEndpoint.apiKey)
            return request
        })
    }

    const basePath = appConfig.apiEndpoint.type === 'openai'
        ? 'https://api.openai.com/v1'
        : `${appConfig.apiEndpoint.host}/openai/deployments/${appConfig.apiEndpoint.deploymentId}`

    return new OpenAIApi(config, basePath, axiosInstance as any) // openai axios is severly outdated, so need to cast here
}

export const run = async (appConfig: AppConfig) => {
    const client = createOpenAIClient(appConfig)
    const logger = new Logger(appConfig.loggerOptions)

    logger.info('Scanning input directory')
    if (appConfig.analyzerOptions.dryRun) {
        logger.info('Dry run enabled')
    }
    const filePaths = getFilesInDirDepthFirst(appConfig.inputDirectory, './', appConfig.fileScannerOptions)

    logger.info('Analyzing files')
    logger.info(JSON.stringify(filePaths, null, 2))

    const analyzeFiles = createAnalyzeFiles(client, appConfig.analyzerOptions, logger)

    const timeStr = DateTime.now().toFormat('yyyyMMddHHmmss')

    for await (const { result, filePaths: resultFilePaths } of analyzeFiles(appConfig.inputDirectory, filePaths)) {
        if (appConfig.analyzerOptions.dryRun) {
            continue
        }

        const outfilePath = getOutfilePath(appConfig.outputDirectory, resultFilePaths, timeStr)
        const outContent = createOutfileContent(result)
        mkdirp.mkdirpSync(path.dirname(outfilePath))
        fs.writeFileSync(outfilePath, outContent + '\n', { flag: 'a' })
    }
}

const getOutfilePath = (outputDirectory: string, resultFilePaths: string[], timeStr: string) => {
    const dirs = resultFilePaths.map(filePath => path.dirname(filePath))
    const shortestDir = _.sortBy(dirs, dir => dir.length)[0]
    return path.join(outputDirectory, shortestDir, `result.${timeStr}.md`)
}

const createOutfileContent = (result: Result) => {
    const outLines: string [] = []
    if (result.summary.length > 0) {
        outLines.push('Summary')
        outLines.push(result.summary)
    }
    if (result.improvedResult.length > 0) {
        outLines.push('Re-analyzed result')
        outLines.push(result.improvedResult)
    }
    outLines.push('Initial result')
    outLines.push(result.initialResult)
    return outLines.join('\n\n') + '\n\n'
}
