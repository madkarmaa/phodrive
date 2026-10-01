import { FileActionKind, type FileRequest, type RemoteBmp } from '$lib/models';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { decodeSplitBmp } from '$server/bmp';
import { downloadBmp, moveToTrash } from '$server/photos';
import { createTemporaryDirectory, removeTemporaryDirectory } from '$server/temporary-files';

function validateChunks(input: FileRequest): Result<RemoteBmp[], Error> {
    const chunks = input.chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
    if (
        !input.name ||
        /[\\/\r\n\0]/.test(input.name) ||
        chunks.some((chunk) => chunk.fileHash !== input.fileHash)
    )
        return Err(new Error('Invalid file metadata.'));

    if (input.action === FileActionKind.Delete) return Ok(chunks);
    if (
        chunks.some(
            (chunk, index) =>
                chunk.chunkIndex !== index ||
                chunk.isLast !== (index === chunks.length - 1) ||
                (index === 0 && chunk.originalName !== input.name)
        )
    )
        return Err(new Error('Load the remaining chunks before downloading.'));

    return Ok(chunks);
}

function downloadPayload(input: FileRequest, chunk: RemoteBmp): AsyncResult<Uint8Array, Error> {
    return downloadBmp(input.email, input.token, chunk.mediaKey, chunk.sha1)
        .andThen(decodeSplitBmp)
        .andThen(({ header, payload }) => {
            if (
                header.fileHash !== input.fileHash ||
                header.chunkIndex !== chunk.chunkIndex ||
                header.flags !== Number(chunk.isLast) ||
                header.payloadSize !== chunk.size ||
                (chunk.chunkIndex === 0 && header.fileName !== input.name)
            )
                return Err(new Error('Downloaded chunks do not match this file.'));

            return Ok(payload);
        });
}

function writePayload(file: FileHandle, payload: Uint8Array): AsyncResult<void, Error> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await file.writeFile(payload);
            return Ok(undefined);
        } catch {
            return Err(new Error('Could not save the downloaded file.'));
        }
    });
}

function reconstructFile(
    input: FileRequest,
    chunks: RemoteBmp[],
    file: FileHandle
): AsyncResult<void, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const hash = createHash('sha256');
        for (const chunk of chunks) {
            const downloaded = await downloadPayload(input, chunk);
            const written = await downloaded.andThenAsync((payload) => {
                hash.update(payload);
                return writePayload(file, payload);
            });
            if (written.isErr()) return written;
        }

        if (hash.digest('hex') !== input.fileHash)
            return Err(new Error('Reconstructed file failed SHA-256 verification.'));

        return Ok(undefined);
    });
}

function writeDownload(
    input: FileRequest,
    chunks: RemoteBmp[],
    path: string
): AsyncResult<void, Error> {
    return Ok(undefined).andThenAsync(async () => {
        let file: FileHandle;
        try {
            file = await open(path, 'wx', 0o600);
        } catch {
            return Err(new Error('Could not create the downloaded file.'));
        }

        let written: Result<void, Error> = Ok(undefined);
        let closed: Result<void, Error> = Ok(undefined);
        try {
            written = await reconstructFile(input, chunks, file);
        } finally {
            try {
                await file.close();
            } catch {
                closed = Err(new Error('Could not close the downloaded file.'));
            }
        }

        return written.andThen(() => closed);
    });
}

function downloadResponse(path: string, directory: string): Response {
    const file = createReadStream(path);
    const reader = file.iterator();
    let closed = false;
    const cleanup = async () => {
        if (closed) return;
        closed = true;
        file.destroy();
        const removed = await removeTemporaryDirectory(directory);
        removed.match({ Ok: () => {}, Err: (error) => console.error(error.message) });
    };
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            let next: IteratorResult<unknown>;
            try {
                next = await reader.next();
            } catch {
                controller.error(new Error('Could not read the downloaded file.'));
                await cleanup();
                return;
            }
            if (closed) return;
            if (next.done) {
                await cleanup();
                controller.close();
                return;
            }
            if (!(next.value instanceof Uint8Array)) {
                controller.error(new Error('Invalid downloaded file data.'));
                await cleanup();
                return;
            }

            controller.enqueue(next.value);
        },
        cancel: cleanup
    });

    return new Response(body, {
        headers: {
            'content-type': 'application/octet-stream',
            'cache-control': 'no-store'
        }
    });
}

/** Verify the full original hash before returning any reconstructed bytes to the browser. */
export function downloadFile(input: FileRequest): AsyncResult<Response, Error> {
    return validateChunks(input).andThenAsync((chunks) =>
        createTemporaryDirectory().andThenAsync(async (directory) => {
            const path = join(directory, 'download');
            const written = await writeDownload(input, chunks, path);
            if (written.isErr()) {
                const removed = await removeTemporaryDirectory(directory);
                return removed.andThen(() => written);
            }

            return written.map(() => downloadResponse(path, directory));
        })
    );
}

/** Attempt every known chunk and return all confirmed removals even after partial failure. */
export function deleteFile(
    input: FileRequest
): AsyncResult<{ deleted: RemoteBmp[]; error?: string }, Error> {
    return validateChunks(input).andThenAsync(async (chunks) => {
        const deleted: RemoteBmp[] = [];
        let failure: Error | null = null;
        const limit = pLimit(input.workers);
        await limit.map(chunks, async (chunk) => {
            const removed = await moveToTrash(input.email, input.token, chunk.sha1);
            removed.match({
                Ok: () => {
                    deleted.push(chunk);
                },
                Err: (error) => {
                    failure ??= error;
                }
            });
        });

        return Ok({
            deleted,
            ...(failure ? { error: 'Could not move every chunk to Google Photos trash.' } : {})
        });
    });
}
