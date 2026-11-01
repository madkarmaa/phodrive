import { lstat, open, rename, type FileHandle } from 'node:fs/promises';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '../errors';
import { SERVER_ERRORS, type ServerError } from '../server/errors';

type FileError = ApplicationError | ServerError;

const KNOWN_SERVER_ERRORS: readonly ServerError[] = Object.values(SERVER_ERRORS);

function saveFailure(path: string): ApplicationError {
    return { code: 'DOWNLOAD_SAVE_FAILED', message: `Could not save ${path}.` };
}

/** The download stream fails with the server's own error values, which keep their messages. */
function streamFailure(reason: unknown): ServerError {
    return (
        KNOWN_SERVER_ERRORS.find((error) => error === reason) ??
        SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE
    );
}

export function ensureAvailable(path: string, force: boolean): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (force) return Ok(undefined);

        try {
            await lstat(path);
        } catch (error) {
            const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';

            return missing ? Ok(undefined) : Err(saveFailure(path));
        }

        return Err({ code: 'FILE_EXISTS', message: `${path} already exists.` } as const);
    });
}

function copyBody(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    handle: FileHandle,
    path: string,
    onProgress?: (written: number) => void
): AsyncResult<void, FileError> {
    return Ok(undefined).andThenAsync<void, FileError>(async () => {
        let written = 0;

        while (true) {
            let next: ReadableStreamReadResult<Uint8Array>;

            try {
                next = await reader.read();
            } catch (reason) {
                return Err(streamFailure(reason));
            }
            if (next.done) return Ok(undefined);

            try {
                await handle.write(next.value);
            } catch {
                return Err(saveFailure(path));
            }

            written += next.value.byteLength;
            onProgress?.(written);
        }
    });
}

export function writeBody(
    body: ReadableStream<Uint8Array>,
    path: string,
    onProgress?: (written: number) => void
): AsyncResult<void, FileError> {
    return Ok(undefined).andThenAsync(async () => {
        let handle: FileHandle;

        try {
            handle = await open(path, 'wx');
        } catch {
            return Err(saveFailure(path));
        }

        const reader = body.getReader();
        const copied = await copyBody(reader, handle, path, onProgress);

        await reader.cancel().catch(() => {});
        reader.releaseLock();

        try {
            await handle.close();
        } catch {
            return copied.andThen(() => Err(saveFailure(path)));
        }

        return copied;
    });
}

export function moveIntoPlace(
    temporary: string,
    destination: string,
    force: boolean
): AsyncResult<void, ApplicationError> {
    return ensureAvailable(destination, force).andThenAsync(async () => {
        try {
            await rename(temporary, destination);

            return Ok(undefined);
        } catch {
            return Err(saveFailure(destination));
        }
    });
}
