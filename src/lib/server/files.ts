import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { FileActionKind, type FileRequest, type RemoteBmp } from '$lib/models';
import { createHash } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { decodeSplitBmp } from '$server/bmp';
import { downloadBmp, moveToTrash } from '$server/photos';
import { createTemporaryDirectory, removeTemporaryDirectory } from '$server/temporary-files';

const STREAM_PREMATURE_CLOSE_CODE = 'ERR_STREAM_PREMATURE_CLOSE';

function validateChunks(input: FileRequest): Result<RemoteBmp[], ServerError> {
    const chunks = input.chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
    if (
        !input.name ||
        /[\\/\r\n\0]/.test(input.name) ||
        chunks.some((chunk) => chunk.fileHash !== input.fileHash || chunk.fileId !== input.fileId)
    )
        return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

    if (input.action === FileActionKind.Delete) return Ok(chunks);
    if (
        chunks.some(
            (chunk, index) =>
                chunk.chunkIndex !== index ||
                chunk.isLast !== (index === chunks.length - 1) ||
                (index === 0 && chunk.originalName !== input.name)
        )
    )
        return Err(SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS);

    return Ok(chunks);
}

function downloadPayload(
    input: FileRequest,
    chunk: RemoteBmp
): AsyncResult<Uint8Array, ServerError> {
    return downloadBmp(input.email, input.token, chunk.mediaKey, chunk.sha1)
        .andThen(decodeSplitBmp)
        .andThen(({ header, payload }) => {
            if (
                header.fileHash !== input.fileHash ||
                header.fileId !== input.fileId ||
                header.chunkIndex !== chunk.chunkIndex ||
                header.flags !== Number(chunk.isLast) ||
                header.payloadSize !== chunk.size ||
                (chunk.chunkIndex === 0 && header.fileName !== input.name)
            )
                return Err(SERVER_ERRORS.DOWNLOAD_CHUNK_MISMATCH);

            return Ok(payload);
        });
}

function writePayload(file: FileHandle, payload: Uint8Array): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await file.writeFile(payload);
            return Ok(undefined);
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_SAVE_THE_DOWNLOADED_FILE);
        }
    });
}

function reconstructFile(
    input: FileRequest,
    chunks: RemoteBmp[],
    file: FileHandle
): AsyncResult<void, ServerError> {
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

        if (hash.digest('hex') !== input.fileHash) return Err(SERVER_ERRORS.FILE_INTEGRITY_FAILED);

        return Ok(undefined);
    });
}

function writeDownload(
    input: FileRequest,
    chunks: RemoteBmp[],
    path: string
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let file: FileHandle;
        try {
            file = await open(path, 'wx', 0o600);
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_CREATE_THE_DOWNLOADED_FILE);
        }

        let written: Result<void, ServerError> = Ok(undefined);
        let closed: Result<void, ServerError> = Ok(undefined);
        try {
            written = await reconstructFile(input, chunks, file);
        } finally {
            try {
                await file.close();
            } catch {
                closed = Err(SERVER_ERRORS.COULD_NOT_CLOSE_THE_DOWNLOADED_FILE);
            }
        }

        return written.andThen(() => closed);
    });
}

function closeDownloadStream(file: ReadStream): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const close = promisify(file.close.bind(file));

        try {
            await close();
        } catch (error) {
            if (
                file.closed &&
                error instanceof Error &&
                'code' in error &&
                error.code === STREAM_PREMATURE_CLOSE_CODE
            )
                return Ok(undefined);

            return Err(SERVER_ERRORS.COULD_NOT_CLOSE_THE_DOWNLOADED_FILE);
        }

        return Ok(undefined);
    });
}

function downloadResponse(path: string, directory: string): Response {
    const file = createReadStream(path);
    const reader = file.iterator();
    let closed = false;
    const cleanup = async () => {
        if (closed) return;
        closed = true;

        // Windows cannot remove a temporary file until its read handle has closed.
        const fileClosed = await closeDownloadStream(file);
        const removed = await removeTemporaryDirectory(directory);
        fileClosed
            .andThen(() => removed)
            .match({ Ok: () => {}, Err: (error) => console.error(error.message) });
    };
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            let next: IteratorResult<unknown>;
            try {
                next = await reader.next();
            } catch {
                controller.error(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
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
                controller.error(SERVER_ERRORS.INVALID_DOWNLOADED_FILE_DATA);
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
export function downloadFile(input: FileRequest): AsyncResult<Response, ServerError> {
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
): AsyncResult<{ deleted: RemoteBmp[]; error?: string }, ServerError> {
    return validateChunks(input).andThenAsync(async (chunks) => {
        const deleted: RemoteBmp[] = [];
        const failures: ServerError[] = [];
        const limit = pLimit(input.workers);
        await limit.map(chunks, async (chunk) => {
            const removed = await moveToTrash(input.email, input.token, chunk.sha1);
            removed.match({
                Ok: () => {
                    deleted.push(chunk);
                },
                Err: (error) => {
                    failures.push(error);
                }
            });
        });

        const failure = failures[0];
        return Ok({
            deleted,
            ...(failure ? { error: failure.message } : {})
        });
    });
}
