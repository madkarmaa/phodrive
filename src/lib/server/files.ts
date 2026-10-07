import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { FileActionKind, type FileRequest, type RemoteBmp } from '$lib/models';
import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { moveToTrash } from '$server/photos';
import { streamDownload } from '$server/download';

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
        chunks.length === 0 ||
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

/** Reconstruct in order as the browser reads, verifying integrity before stream completion. */
export function downloadFile(
    input: FileRequest,
    signal?: AbortSignal
): AsyncResult<Response, ServerError> {
    return validateChunks(input).andThenAsync((chunks) => streamDownload(input, chunks, signal));
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
