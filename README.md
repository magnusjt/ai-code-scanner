# AI overlord code scanner

Scans a set of files and asks openAI to find issues, bugs, etc.
It dumps one result per input file in an output folder.

## How to use

- Tweak the parameters in index.ts to your liking.
- Paste in your openapi key in .env-local (see .env-sample for examples)

## How does it work?

We simply list all files matching include/exclude patterns in a directory and its subdirectories.
The files are iterated bottom-up, and for each file we send one or more requests to openAI's chat endpoint.
We keep already iterated files as context, and send over some of that as well.
Depending on the model used, we can send more or less context. If a file is really big, it will be broken into multiple requests.