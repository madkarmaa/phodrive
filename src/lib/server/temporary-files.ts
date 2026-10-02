import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Err, Ok, type AsyncResult } from 'results-ts';

export function createTemporaryDirectory(): AsyncResult<string, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const directory = await mkdtemp(join(tmpdir(), 'phodrive-'));
            return Ok(directory);
        } catch {
            return Err(SERVER_ERRORS.TEMPORARY_STORAGE_CREATE_FAILED);
        }
    });
}

export function removeTemporaryDirectory(directory: string): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await rm(directory, { recursive: true, force: true });
            return Ok(undefined);
        } catch {
            return Err(SERVER_ERRORS.TEMPORARY_STORAGE_REMOVE_FAILED);
        }
    });
}

/** Allocate only the payload for the worker currently reading this range. */
export function readFileRange(
    path: string,
    start: number,
    length: number
): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let file: Awaited<ReturnType<typeof open>>;
        let bytes: Buffer;

        try {
            bytes = Buffer.alloc(length);
            file = await open(path, 'r');
        } catch {
            return Err(SERVER_ERRORS.FILE_READ_FAILED);
        }

        let failure: ServerError | null = null;
        try {
            let offset = 0;
            while (offset < length) {
                const { bytesRead } = await file.read(
                    bytes,
                    offset,
                    length - offset,
                    start + offset
                );
                if (bytesRead === 0) {
                    failure = SERVER_ERRORS.INCOMPLETE_FILE;
                    break;
                }
                offset += bytesRead;
            }
        } catch {
            failure = SERVER_ERRORS.FILE_READ_FAILED;
        } finally {
            try {
                await file.close();
            } catch {
                failure ??= SERVER_ERRORS.TEMPORARY_STORAGE_CLOSE_FAILED;
            }
        }

        return failure ? Err(failure) : Ok(bytes);
    });
}
