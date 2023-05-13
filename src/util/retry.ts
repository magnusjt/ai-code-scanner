import { Logger } from './logger'
import { delay } from './delay'

export const retry = async <T>(
    func: () => Promise<T>,
    shouldRetry: (err: unknown) => boolean,
    logger: Logger,
    maxRetries = 10
) => {
    let n = 0
    while (n++ < maxRetries) {
        try {
            return await func()
        } catch (err: unknown) {
            logger.warn(err)
            if (!shouldRetry(err)) {
                throw err
            }
        }
        await delay(1000 * n * n)
    }
    throw new Error('Max retries exceeded')
}
