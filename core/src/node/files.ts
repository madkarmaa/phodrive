import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../errors';
import type { FileGroup } from '../files';
import { FileActionKind, FileRequestSchema, type FileRequest, type RemoteBmp } from '../models';
import { schemaResult } from '../validation';
import { SERVER_ERRORS, type ServerError } from '../server/errors';
import {
    deleteFile as deleteRemoteFile,
    downloadFile as downloadRemoteFile
} from '../server/files';
import { validateWorkers } from '../server/workers';
import { ensureAvailable, moveIntoPlace, writeBody } from './save';

export type DownloadOptions = {
    force?: boolean;
    signal?: AbortSignal;
    onProgress?: (written: number) => void;
};
export type DeleteResult = { deleted: RemoteBmp[]; error?: string };

type FileError = ApplicationError | ServerError;

function fileRequest(
    item: FileGroup,
    action: FileActionKind,
    token: string,
    workers: number
): Result<FileRequest, ApplicationError> {
    return schemaResult(
        FileRequestSchema,
        {
            action,
            email: item.email,
            token,
            name: item.name,
            fileHash: item.fileHash,
            fileId: item.fileId,
            chunks: item.chunks,
            workers
        },
        'Invalid file metadata.'
    );
}

/** Stream a verified file into a hidden sibling, then move it into place only when complete. */
export function downloadFile(
    item: FileGroup,
    token: string,
    destination: string,
    { force = false, signal, onProgress }: DownloadOptions = {}
): AsyncResult<void, FileError> {
    return Ok(undefined).andThenAsync<void, FileError>(async () => {
        if (!item.complete)
            return Err({
                code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
                message: `${item.name} is missing chunks and cannot be downloaded.`
            } as const);

        const available = await ensureAvailable(destination, force);
        if (available.isErr()) return available;

        const temporary = join(
            dirname(destination),
            `.${basename(destination)}.${randomUUID()}.part`
        );
        const saved = await fileRequest(item, FileActionKind.Download, token, 1)
            .andThenAsync((input) => downloadRemoteFile(input, signal))
            .andThenAsync(async (response) => {
                if (!response.body) return Err(SERVER_ERRORS.MISSING_DOWNLOAD_BODY);

                return await writeBody(response.body, temporary, onProgress);
            })
            .andThenAsync(() => moveIntoPlace(temporary, destination, force));

        if (saved.isErr()) await rm(temporary, { force: true }).catch(() => {});

        return saved;
    });
}

/** Move every chunk to the trash; confirmed removals are returned even after a partial failure. */
export function deleteFile(
    item: FileGroup,
    token: string,
    workers: number
): AsyncResult<DeleteResult, FileError> {
    return validateWorkers(workers)
        .andThen((concurrency) => fileRequest(item, FileActionKind.Delete, token, concurrency))
        .andThenAsync((input) => deleteRemoteFile(input));
}
