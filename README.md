# AI code scanner

Scans a set of files and asks openai to find issues, bugs, etc.
It dumps one result per input file in an output folder.

## How to use

- Set API_KEY as an environment variable OR copy .env-sample to .env-local and add your key there
- Copy config.sample.json to config.json, and tweak the settings to your liking
- Run ./bin/ai-code-scanner.js --input ./src --output ./.output --config ./config.json

CLI Options

````
ai-code-scanner 1.0.0
> Scans and reviews code in given directories

OPTIONS:
  --config <str> - Path to json config file [optional]
  --input <str>  - Path to input directory. Required
  --output <str> - Path to output directory. Default: .output [optional]
  --prompt <str> - Path to file containing the prompt. Default: ./prompts/codereview2_concrete.txt [optional]
  --model <str>  - OpenAI model name, one of gpt-4, gpt-4-0314, gpt-4-32k, gpt-4-32k-0314, gpt-3.5-turbo, gpt-3.5-turbo-0301. Default: gpt-3.5-turbo [optional]

FLAGS:
  --enable-self-analysis - Enable self analysis prompt
  --enable-summary       - Enable summary prompt
  --verbose              - Verbose logging
  --dry-run              - Run without calling api's
  --help, -h             - show help
  --version, -v          - print the version

````

Config options:

````
{
    apiEndpoint: {
        type: 'azure'
        deploymentId: string
        host: string // E.g. https://<your-host>.openai.azure.com
    } | {
        type: 'openai' // This is the default
    }
    include: string[] // Regexes of filepaths to include. Default: ['\\.ts$']
    exclude: string[] // Regexes of filepaths/dirs to exclude. Default: ['node_modules']
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
