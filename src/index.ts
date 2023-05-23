#!/usr/bin/env node

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '../.env-local') })
import fs from 'fs'
import { run } from './run'
import * as cmd from 'cmd-ts'
import { AnalyzerOptions } from './analyzeFiles'

type Config = {
    apiEndpoint: {
        type: 'azure'
        deploymentId: string
        host: string
    } | {
        type: 'openai'
    }
    include: string[]
    exclude: string[]

    inputPath?: string
    outputPath?: string
    promptFilePath?: string
    model?: string
}

const parseConfig = (config: any): Config => {
    if (!config.apiEndpoint) throw new Error('apiEndpoint must be set')
    if (!Array.isArray(config.include)) throw new Error('include must be an array')
    if (!Array.isArray(config.exclude)) throw new Error('exclude must be an array')
    if (!['azure', 'openai'].includes(config.apiEndpoint.type)) throw new Error('apiEndpoint.type must be set to "azure" or "openai"')
    if (config.apiEndpoint.type === 'azure') {
        if (!config.apiEndpoint.deploymentId) throw new Error('apiEndpoint.deploymentId must be set')
        if (!config.apiEndpoint.host) throw new Error('apiEndpoint.host must be set')
    }
    return config
}

const readJsonFile = (filePath: string) => {
    const content = fs.readFileSync(filePath, 'utf-8')
    try {
        return JSON.parse(content)
    } catch (err: any) {
        throw new Error('Invalid json in ' + filePath)
    }
}

const app = cmd.command({
    name: 'ai-code-scanner',
    version: '1.0.0',
    description: 'Scans and reviews code in given directories',
    args: {
        configPath: cmd.option({ type: cmd.string, long: 'config', defaultValue: () => 'config.json', description: 'Path to json config file' }),
        inputPath: cmd.option({ type: cmd.optional(cmd.string), long: 'input', description: 'Path to input directory' }),
        outputPath: cmd.option({ type: cmd.optional(cmd.string), long: 'output', description: 'Path to output directory' }),
        promptFilePath: cmd.option({ type: cmd.optional(cmd.string), long: 'prompt', description: 'Path to file containing the prompt' }),
        model: cmd.option({ type: cmd.optional(cmd.string), long: 'model', description: 'OpenAI model name, one of gpt-4, gpt-4-0314, gpt-4-32k, gpt-4-32k-0314, gpt-3.5-turbo, gpt-3.5-turbo-0301' }),
        enableSelfAnalysis: cmd.flag({ long: 'enable-self-analysis', description: 'Enable self analysis prompt' }),
        enableSummary: cmd.flag({ long: 'enable-summary', description: 'Enable summary prompt' }),
        verbose: cmd.flag({ long: 'verbose', description: 'Verbose logging' }),
        dryRun: cmd.flag({ long: 'dry-run', description: 'Run without calling api\'s' }),
    },
    handler: async (opts) => {
        const config = parseConfig(readJsonFile(opts.configPath))
        const inputPath = opts.inputPath ?? config.inputPath
        if (!inputPath) {
            throw new Error('Input path must be set either via config or via command line')
        }
        const outputPath = opts.outputPath ?? config.outputPath ?? '.output'
        const promptFilePath = opts.promptFilePath ?? config.promptFilePath ?? path.join(__dirname, '../prompts/codereview2_concrete.txt')
        const prompt = fs.readFileSync(promptFilePath, 'utf-8')
        const model = opts.model ?? config.model ?? 'gpt-3.5-turbo'
        const verbose = opts.verbose

        const apiKey = process.env.API_KEY
        if (!apiKey) throw new Error('API_KEY must be set')

        await run({
            inputDirectory: inputPath,
            outputDirectory: outputPath,
            fileScannerOptions: {
                include: config.include.map(x => new RegExp(x)),
                exclude: config.exclude.map(x => new RegExp(x)),
            },
            apiEndpoint: config.apiEndpoint.type === 'openai'
                ? {
                    ...config.apiEndpoint,
                    type: 'openai',
                    apiKey: apiKey
                }
                : {
                    ...config.apiEndpoint,
                    type: 'azure',
                    apiKey: apiKey
                },
            analyzerOptions: {
                model: model as AnalyzerOptions['model'],
                maxSourceTokensPerRequest: 2000,
                maxResultTokens: 800,
                dryRun: opts.dryRun,
                systemPrompt: prompt,
                enableSelfAnalysis: opts.enableSelfAnalysis,
                selfAnalysisPrompt: [
                    'Can you try to improve upon your answer?'
                ].join('\n'),
                enableSummary: opts.enableSummary,
                summaryPrompt: [
                    'Please summarize all your findings so far into a short bullet point list. Max 10 items.'
                ].join('\n'),
                textProcessing: {
                    prefix: '// ...previous lines snipped',
                    postfix: '// ...rest of lines snipped',
                    filePathPrefixTemplate: '// file = {filePath}'
                }
            },
            loggerOptions: {
                level: verbose ? 'debug' : 'info'
            }
        })
    },
})

cmd.run(app, process.argv.slice(2))
    .catch(err => console.error(err))

