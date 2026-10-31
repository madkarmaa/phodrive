import { openAsBlob } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import {
    FileUploadRequestSchema,
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    type Account,
    type FileUploadRequest,
    type UploadEvent
} from '../../models';
import type { UploadJob } from '../../browser/upload/jobs';
import { uploadFiles as uploadLocalFiles } from '../../node/upload';
import { schemaResult } from '../../validation';
import type { Fetcher } from '../fetcher';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { limitWorkers } from '../workers';
import { receiveMultipartFile, type ReceivedMultipartFile } from './multipart';
import { uploadEventStream } from './stream';

const PROGRESS_INTERVAL_MS = 100;
const SPOOL_PREFIX = 'phodrive-upload-';

export type ReceivedFile = ReceivedMultipartFile<FileUploadRequest>;

type SpoolError = ServerError | ApplicationError;

/** Read a whole file's metadata, then expose the file for the server to hash, split, and encode. */
export function receiveFileUpload(request: Request): AsyncResult<ReceivedFile, ServerError> {
    return receiveMultipartFile(request, {
        fileField: 'file',
        maxFileBytes: Number.MAX_SAFE_INTEGER,
        parseMetadata: (value) =>
            schemaResult(FileUploadRequestSchema, value, 'Invalid upload request.').mapErr(
                () => SERVER_ERRORS.INVALID_UPLOAD_REQUEST
            )
    });
}

function openSpool(path: string): AsyncResult<FileHandle, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const handle = await open(path, 'wx');

            return Ok(handle);
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_SPOOL_FAILED);
        }
    });
}

function writeBlock(handle: FileHandle, block: Uint8Array): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await handle.write(block);

            return Ok(undefined);
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_SPOOL_FAILED);
        }
    });
}

/** Copy the incoming file to disk, reporting how much the server has received. */
function writeSpool(
    received: ReceivedFile,
    handle: FileHandle,
    emit: (event: UploadEvent) => void
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, ServerError>> => {
        const total = received.metadata.size;
        const reader = received.payload.getReader();
        let written = 0;
        let lastProgress = 0;
        const report = (force: boolean) => {
            const now = performance.now();
            if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return;

            lastProgress = now;
            emit({
                type: UploadEventType.Progress,
                id: 0,
                progress: { phase: UploadPhase.Receiving, completed: written, total }
            });
        };
        report(true);

        try {
            while (true) {
                let next: ReadableStreamReadResult<Uint8Array>;

                try {
                    next = await reader.read();
                } catch {
                    return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
                }
                if (next.done) break;

                written += next.value.length;
                if (written > total) return Err(SERVER_ERRORS.FILE_TOO_LARGE);

                const stored = await writeBlock(handle, next.value);
                if (stored.isErr()) return stored;

                report(false);
            }
        } finally {
            reader.releaseLock();
        }

        if (written !== total) return Err(SERVER_ERRORS.INCOMPLETE_FILE);

        report(true);

        return await received.finished();
    });
}

/** Translate the local uploader's job updates into the events the browser expects. */
function jobEvent(job: UploadJob): UploadEvent | null {
    if (job.status === UploadJobStatus.Error)
        return { type: UploadEventType.FileError, id: 0, error: job.message };
    if (job.status === UploadJobStatus.Complete && job.result)
        return { type: UploadEventType.FileComplete, id: 0, result: job.result };
    if (job.progress.phase === UploadPhase.Receiving) return null;

    return { type: UploadEventType.Progress, id: 0, progress: job.progress };
}

function chunkEvent({ email: _email, ...chunk }: UploadedChunk): UploadEvent {
    return { type: UploadEventType.Chunk, id: 0, chunk };
}

/** The spooled file is read lazily from disk while it is hashed, split, encoded, and uploaded. */
function uploadSpooledFile(
    path: string,
    { name, workers }: FileUploadRequest,
    account: Account,
    emit: (event: UploadEvent) => void,
    signal: AbortSignal,
    fetcher?: Fetcher
): AsyncResult<void, SpoolError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, SpoolError>> => {
        let file: File;

        try {
            const blob = await openAsBlob(path);
            file = new File([blob], name);
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_SPOOL_FAILED);
        }

        return await uploadLocalFiles(
            [file],
            account.email,
            account.token,
            limitWorkers(workers),
            (job) => {
                const event = jobEvent(job);
                if (event) emit(event);
            },
            (chunk) => emit(chunkEvent(chunk)),
            { signal, fetcher }
        );
    });
}

function spoolAndUpload(
    received: ReceivedFile,
    account: Account,
    emit: (event: UploadEvent) => void,
    fetcher?: Fetcher
): AsyncResult<void, SpoolError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, SpoolError>> => {
        let directory: string;

        try {
            directory = await mkdtemp(join(tmpdir(), SPOOL_PREFIX));
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_SPOOL_FAILED);
        }

        const path = join(directory, 'file');

        try {
            const spooled = await openSpool(path).andThenAsync(async (handle) => {
                try {
                    return await writeSpool(received, handle, emit);
                } finally {
                    await handle.close().catch(() => {});
                }
            });
            if (spooled.isErr()) return spooled;

            return await uploadSpooledFile(
                path,
                received.metadata,
                account,
                emit,
                received.signal,
                fetcher
            );
        } finally {
            await rm(directory, { recursive: true, force: true }).catch(() => {});
        }
    });
}

/** Store the whole file on disk, then hash, split, encode, and upload it on the server. */
export function fileUploadStream(
    received: ReceivedFile,
    account: Account,
    fetcher?: Fetcher
): Response {
    return uploadEventStream({
        run: (emit) => spoolAndUpload(received, account, emit, fetcher),
        cancel: received.cancel
    });
}
