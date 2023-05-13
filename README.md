# AI code scanner

Scans a set of files and asks openai to find issues, bugs, etc.
It dumps one result per input file in an output folder.

## How to use

- Tweak the parameters in index.ts to your liking.
- Paste in your openai api key in .env-local (see .env-sample for examples)
- Run `npm ci`
- Run `npm start`

Example config:

````ts
const config = {
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
        enableSelfAnalysis: true,
        selfAnalysisPrompt: [
            'Please analyze the code and the code review, and give an improved answer.'
        ].join('\n'),
        textProcessing: {
            continuedContentPrefix: '// ...previous code snipped\n\n',
            snippedContentPostfix: '\n\n// ...rest of code snipped',
            contextPrefix: '',
            contextPostfix: '',
            filePathPrefixTemplate: '// filePath={filePath}\n\n'
        }
    },
    loggerOptions: {
        level: 'debug'
    }
}
````

For each input file a corresponding result file is created in the .output directory.

## How does it work?

We simply list all files matching include/exclude patterns in a directory and its subdirectories.
The files are iterated bottom-up, and for each file we send one or more requests to openai's chat endpoint.
We keep already iterated files as context, and send over some of that as well.
Depending on the model used, we can send more or less context. If a file is too big, it will be broken into multiple requests.