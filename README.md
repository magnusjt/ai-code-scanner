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
}
````

## How does it work?

We create a sliding window over all the file contents in the input directory (filtering in the desired files),
going from the deepest directories first. The idea behind going bottom-up like this is to give the AI as much context as possible. 

We then send the whole content slice to openai's chat endpoint,
asking it to review all the files in the slice. At the beginning of each file we add the filepath as a hint to the ai,
and firmly ask it to separate its reviews by file.

The reason why its done this way is to cram as many tokens as possible into each request.
This gives the AI more context, and it's also faster than sending many smaller requests.

For each set of input files analyzed, one or more result files are created in the output directory.
We try to put the results in roughly the same directory structure as the input,
but there are no guarantees since we potentially cram in many different files in each request.
Each result file will be applicable to one or more input files in the same directory or its subdirectories.

As the AI gets better at separating its review we might be able to create a separate result file for each reviewed file. 
