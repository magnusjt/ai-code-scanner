export type LoggerOptions = {
    level: 'debug' | 'info' | 'warn' | 'error'
}

const levelToNumber = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
}

export class Logger {
    constructor(private options: LoggerOptions) {}

    log = (level: LoggerOptions['level'], ...args: any[]) => {
        const levelNumber = levelToNumber[level]
        const minimumLevel = levelToNumber[this.options.level]
        if (levelNumber < minimumLevel) {
            return
        }
        console.log(...args)
    }

    debug = (...args: any[]) => this.log('debug', ...args)
    info = (...args: any[]) => this.log('info', ...args)
    warn = (...args: any[]) => this.log('warn', ...args)
    error = (...args: any[]) => this.log('error', ...args)
}