import type { ApplicationError } from '../errors';
import { FileActionKind, ConcurrentWorkersSchema, FileDeleteResponseSchema } from '../models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup, UploadedChunk } from '../files';
import { schemaResult } from '../validation';
import { apiJson, request } from './api';

export { createUploadJobs, type UploadJob } from './upload/jobs';

export type { UploadProgress } from '../models';
export { uploadFiles } from './upload/index';

const FILES_API_URL = '/api/files';

function fileRequest(item: FileGroup, action: FileActionKind, workers: number): RequestInit {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            action,
            name: item.name,
            fileHash: item.fileHash,
            fileId: item.fileId,
            // Chunks carry their owner's email locally; the server uses the signed-in account.
            chunks: item.chunks.map(({ email: _email, ...chunk }) => chunk),
            workers
        })
    };
}

export function deleteFile(
    item: FileGroup,
    onDeleted: (chunk: UploadedChunk) => void,
    workers: number
): AsyncResult<void, ApplicationError> {
    return schemaResult(ConcurrentWorkersSchema, workers, 'Invalid concurrent worker count.')
        .andThenAsync((concurrency) =>
            apiJson(
                FILES_API_URL,
                fileRequest(item, FileActionKind.Delete, concurrency),
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

export function downloadFile(item: FileGroup): AsyncResult<Blob, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!item.complete || item.chunkCount === null)
            return Err({
                code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
                message: 'Load the remaining chunks before downloading.'
            } as const);

        return request(
            FILES_API_URL,
            fileRequest(item, FileActionKind.Download, 1),
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
