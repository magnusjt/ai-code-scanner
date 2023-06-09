import * as fs from 'fs'
import * as path from 'path'

export type FileScannerOptions = {
    include: RegExp[]
    exclude: RegExp[]
}

export const getFilesInDirDepthFirst = (baseDir: string, dir: string, options: FileScannerOptions): string[] => {
    const files = fs.readdirSync(path.join(baseDir, dir))

    const filesWithType = files.flatMap(fileOrDirName => {
        const relativeFileOrDirPath = path.join(dir, fileOrDirName)
        const absoluteFileOrDirPath = path.join(baseDir, relativeFileOrDirPath)

        const stats = fs.statSync(absoluteFileOrDirPath)

        if (stats.isDirectory()) {
            return [{ path: relativeFileOrDirPath, type: 'dir' }]
        } else {
            return [{ path: relativeFileOrDirPath, type: 'file' }]
        }
    })

    const filesInSubDirs = filesWithType
        .filter(f => f.type === 'dir')
        .filter(f => !options.exclude.some(regex => regex.test(f.path)))
        .flatMap(f => getFilesInDirDepthFirst(baseDir, f.path, options))

    const topLevelFiles = filesWithType
        .filter(f => f.type === 'file')
        .flatMap(f => f.path)
        .filter(filePath => options.include.some(regex => regex.test(filePath)))
        .filter(filePath => !options.exclude.some(regex => regex.test(filePath)))

    return [...filesInSubDirs, ...topLevelFiles]
}
