import { openAsBlob } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { fdir } from 'fdir';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '../errors';

export type LocalFile = { path: string; file: File };

function readFailure(path: string): ApplicationError {
    return { code: 'FILE_READ_FAILED', message: `Could not read ${path}.` };
}

/** Symbolic links are followed the same way on every runtime; repeated targets are removed later. */
function listFolder(path: string): AsyncResult<string[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const files = await new fdir()
                .withFullPaths()
                .withSymlinks({ resolvePaths: false })
                .withErrors()
                .crawl(path)
                .withPromise();

            return Ok(files.sort());
        } catch {
            return Err(readFailure(path));
        }
    });
}

function openFile(path: string): AsyncResult<LocalFile, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const blob = await openAsBlob(path);

            // Disk-backed blobs are read lazily, so large files are never loaded into memory.
            return Ok({ path, file: new File([blob], basename(path)) });
        } catch {
            return Err(readFailure(path));
        }
    });
}

function expandPath(path: string): AsyncResult<string[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let isFolder: boolean;

        try {
            const stats = await stat(path);
            if (!stats.isFile() && !stats.isDirectory())
                return Err({
                    code: 'FILE_READ_FAILED',
                    message: `${path} is not a file or folder.`
                } as const);

            isFolder = stats.isDirectory();
        } catch {
            return Err(readFailure(path));
        }

        if (!isFolder) return Ok([path]);

        return await listFolder(path);
    });
}

function canonicalPath(path: string): AsyncResult<string, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const resolved = await realpath(path);

            return Ok(resolved);
        } catch {
            return Err(readFailure(path));
        }
    });
}

/** Open each file once, even when it is selected again directly or through a link. */
function openFiles(
    paths: readonly string[],
    files: LocalFile[],
    opened: Set<string>
): AsyncResult<LocalFile[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        for (const path of paths) {
            const added = await canonicalPath(path).andThenAsync(async (real) => {
                if (opened.has(real)) return Ok(undefined);

                opened.add(real);

                return await openFile(path).map((local) => {
                    files.push(local);
                });
            });
            if (added.isErr()) return added;
        }

        return Ok(files);
    });
}

/** Open files and every file below folders, flattening names as the web app does. */
export function openLocalFiles(
    paths: readonly string[]
): AsyncResult<LocalFile[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const files: LocalFile[] = [];
        const opened = new Set<string>();

        for (const path of paths) {
            const expanded = await expandPath(path).andThenAsync((found) =>
                openFiles(found, files, opened)
            );
            if (expanded.isErr()) return expanded;
        }

        return Ok(files);
    });
}
