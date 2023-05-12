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
}
````

## How does it work?

We simply list all files matching include/exclude patterns in a directory and its subdirectories.
The files are iterated bottom-up, and for each file we send one or more requests to openai's chat endpoint.
We keep already iterated files as context, and send over some of that as well.
Depending on the model used, we can send more or less context. If a file is too big, it will be broken into multiple requests.