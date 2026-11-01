import pLimit from 'p-limit';
import { Ok, type AsyncResult } from 'results-ts';
import {
    ConcurrentWorkersSchema,
    ProcessingMode,
    FileNameSchema,
    FileSizeSchema,
    UploadEventType,
    UploadJobStatus
} from '../../models';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { schemaResult } from '../../validation';
import { httpChunkTransport, uploadFileRequest, type ChunkTransport } from './request';
import {
    createUploadJobs,
    createUploadEventHandler,
    type UploadJob,
    type UploadSource
} from './jobs';
import { prepareFile, uploadPlannedFile } from './planned';

/** Reject unusable selections up front; the rest keep their job IDs as upload sources. */
function uploadSources(
    files: readonly File[],
    jobs: UploadJob[],
    onJob: (job: UploadJob) => void
): UploadSource[] {
    const sources: UploadSource[] = [];

    for (const [id, file] of files.entries()) {
        const valid =
            FileNameSchema.safeParse(file.name).success &&
            FileSizeSchema.safeParse(file.size).success;
        if (!valid) {
            jobs[id] = {
                ...jobs[id],
                status: UploadJobStatus.Error,
                message: 'Invalid file name or size.'
            };
            onJob(jobs[id]);
            continue;
        }

        sources.push({ file, jobId: id });
    }

    return sources;
}

/**
 * Upload with the server's processing mode: in the browser, hash and encode locally, then send
 * finished chunks through one shared pool; on the server, send each whole file.
 */
export function uploadFiles(
    files: readonly File[],
    email: string,
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk, jobId: number) => void,
    processing: ProcessingMode
): AsyncResult<void, ApplicationError> {
    return schemaResult(
        ConcurrentWorkersSchema,
        workers,
        'Invalid concurrent worker count.'
    ).andThenAsync((concurrency) =>
        processing === ProcessingMode.Server
            ? sendFiles(files, email, concurrency, onJob, onChunk)
            : transferFiles(files, email, concurrency, onJob, onChunk, httpChunkTransport)
    );
}

/** The server reports each file under ID 0; its events are mapped back to the file's own ID. */
function sendFiles(
    files: readonly File[],
    email: string,
    concurrency: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk, jobId: number) => void
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const jobs = createUploadJobs(files);
        const sources = uploadSources(files, jobs, onJob);
        if (!sources.length) return Ok(undefined);

        const handle = createUploadEventHandler(sources, jobs, email, onJob, onChunk);
        await pLimit(concurrency).map(sources, async ({ file }, id) => {
            const sent = await uploadFileRequest(file, concurrency, (event) => {
                if (event.type === UploadEventType.Complete || event.type === UploadEventType.Error)
                    return Ok(undefined);

                return handle({ ...event, id });
            });

            // A job already marked complete or failed rejects this report, which is expected.
            sent.inspectErr((error) =>
                handle({ type: UploadEventType.FileError, id, error: error.message })
            );
        });

        return handle({ type: UploadEventType.Complete });
    });
}

/**
 * The shared pool behind every uploader; callers validate the worker count for their runtime.
 * The email labels uploaded chunks, while the transport supplies the account credentials.
 */
export function transferFiles(
    files: readonly File[],
    email: string,
    concurrency: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk, jobId: number) => void,
    transport: ChunkTransport
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const jobs = createUploadJobs(files);
        const sources = uploadSources(files, jobs, onJob);
        if (!sources.length) return Ok(undefined);

        const handle = createUploadEventHandler(sources, jobs, email, onJob, onChunk);
        const chunkLimit = pLimit(concurrency);
        const fileLimit = pLimit(concurrency);
        await fileLimit.map(sources, async ({ file }, id) => {
            handle({ type: UploadEventType.Queued, id });

            const planned = await prepareFile(file, id, handle);
            if (planned.isErr()) {
                planned.inspectErr((error) =>
                    handle({ type: UploadEventType.FileError, id, error: error.message })
                );

                return;
            }

            await planned.andThenAsync((plan) =>
                uploadPlannedFile({ file, id }, plan, email, transport, chunkLimit, handle)
            );
        });

        return handle({ type: UploadEventType.Complete });
    });
}
