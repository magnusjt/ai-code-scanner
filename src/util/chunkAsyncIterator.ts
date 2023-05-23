export const chunkAsyncIterator = async function*<T>(iterable: AsyncIterable<T>, chunkSize: number): AsyncGenerator<T[], void, void> {
    let chunk: T[] = []
    for await (const item of iterable) {
        chunk.push(item)
        if (chunk.length >= chunkSize) {
            yield chunk
            chunk = []
        }
    }

    if (chunk.length > 0) {
        yield chunk
    }
}
