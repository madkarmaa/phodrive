import { mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Err, Ok, type AsyncResult } from 'results-ts';

export function createTemporaryDirectory(): AsyncResult<string, Error> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const directory = await mkdtemp(join(tmpdir(), 'phodrive-'));
            return Ok(directory);
        } catch {
            return Err(new Error('Could not create temporary file storage.'));
        }
    });
}

export function removeTemporaryDirectory(directory: string): AsyncResult<void, Error> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await rm(directory, { recursive: true, force: true });
            return Ok(undefined);
        } catch {
            return Err(new Error('Could not remove temporary file storage.'));
        }
    });
}

/** Allocate only the payload for the worker currently reading this range. */
export function readFileRange(
    path: string,
    start: number,
    length: number
): AsyncResult<Buffer, Error> {
    return Ok(undefined).andThenAsync(async () => {
        let file: Awaited<ReturnType<typeof open>>;
        let bytes: Buffer;

        try {
            bytes = Buffer.alloc(length);
            file = await open(path, 'r');
        } catch {
            return Err(new Error('Could not read the received file.'));
        }

        let failure: Error | null = null;
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
                    failure = new Error('The received file is incomplete.');
                    break;
                }
                offset += bytesRead;
            }
        } catch {
            failure = new Error('Could not read the received file.');
        } finally {
            try {
                await file.close();
            } catch {
                failure ??= new Error('Could not close temporary file storage.');
            }
        }

        return failure ? Err(failure) : Ok(bytes);
    });
}
