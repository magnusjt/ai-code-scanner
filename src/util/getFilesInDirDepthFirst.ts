import * as fs from 'fs';
import * as path from 'path';

export type FileScannerOptions = {
    include: RegExp[]
    exclude: RegExp[]
}

export const getFilesInDirDepthFirst = (dir: string, options: FileScannerOptions): string[] => {
    const files = fs.readdirSync(dir)

    const filesWithType = files.flatMap(fileOrDirName => {
        const fileOrDirPath = path.join(dir, fileOrDirName)

        const stats = fs.statSync(fileOrDirPath)

        if (stats.isDirectory()) {
            return [{ path: fileOrDirPath, type: 'dir' }]
        } else {
            return [{ path: fileOrDirPath, type: 'file' }]
        }
    })

    const filesInSubDirs = filesWithType
        .filter(f => f.type === 'dir')
        .flatMap(f => getFilesInDirDepthFirst(f.path, options))

    const topLevelFiles = filesWithType
        .filter(f => f.type === 'file')
        .flatMap(f => f.path)
        .filter(path => {
            if (!options.include.some(regex => regex.test(path))) {
                return false
            }
            if (options.exclude.some(regex => regex.test(path))) {
                return false
            }
            return true
        })

    return [...filesInSubDirs, ...topLevelFiles]
}