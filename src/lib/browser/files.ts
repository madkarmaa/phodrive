import type { ApplicationError } from '$lib/errors';
import { FileActionKind, ConcurrentWorkersSchema, FileDeleteResponseSchema } from '$lib/models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup, UploadedChunk } from '$lib/file-groups';
import { schemaResult } from '$lib/schema-result';
import { apiJson, request } from '$browser/api';
export { createUploadJobs, type UploadJob } from '$browser/upload-jobs';

export type { UploadProgress } from '$lib/models';

export { uploadFiles } from '$browser/upload-files';

function fileRequest(
    item: FileGroup,
    action: FileActionKind,
    token: string,
    workers: number
): RequestInit {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            action,
            email: item.email,
            token,
            name: item.name,
            fileHash: item.fileHash,
            fileId: item.fileId,
            chunks: item.chunks,
            workers
        })
    };
}

export function deleteFile(
    item: FileGroup,
    token: string,
    onDeleted: (chunk: UploadedChunk) => void,
    workers: number
): AsyncResult<void, ApplicationError> {
    return schemaResult(ConcurrentWorkersSchema, workers, 'Invalid concurrent worker count.')
        .andThenAsync((concurrency) =>
            apiJson(
                '/api/files',
                fileRequest(item, FileActionKind.Delete, token, concurrency),
                'Delete failed'
            )
        )
        .andThen((data) => schemaResult(FileDeleteResponseSchema, data, 'Delete failed'))
        .andThen(({ deleted, error }): Result<void, ApplicationError> => {
            for (const chunk of deleted) {
                const known = item.chunks.find(
                    (current) => current.mediaKey === chunk.mediaKey && current.sha1 === chunk.sha1
                );
                if (!known)
                    return Err({
                        code: 'INVALID_DELETE_RESPONSE',
                        message: 'Invalid delete response.'
                    } as const);
                onDeleted(known);
            }

            return error ? Err({ code: 'DELETE_FAILED', message: error } as const) : Ok(undefined);
        });
}

export function downloadFile(item: FileGroup, token: string): AsyncResult<Blob, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!item.complete || item.chunkCount === null)
            return Err({
                code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
                message: 'Load the remaining chunks before downloading.'
            } as const);

        return request(
            '/api/files',
            fileRequest(item, FileActionKind.Download, token, 1),
            'Download failed'
        ).andThenAsync(async (response) => {
            try {
                const file = await response.blob();
                return Ok(file);
            } catch {
                return Err({
                    code: 'DOWNLOAD_RECEIVE_FAILED',
                    message: 'Could not receive the downloaded file.'
                } as const);
            }
        });
    });
}
