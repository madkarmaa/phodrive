import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    ConcurrentWorkersSchema,
    FileNameSchema,
    FileSizeSchema,
    UploadEventType,
    UploadPhase,
    UploadStatus,
    UploadJobStatus,
    type UploadEvent,
    type SplitHeader,
    type UploadResponse
} from '../../models';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { schemaResult } from '../../validation';
import { MAX_CHUNK_PAYLOAD_BYTES } from '../../bmp/format';
import { planChunks, type UploadPlan } from '../../upload';
import { INVALID_UPLOAD_PROGRESS, httpChunkTransport, type ChunkTransport } from './request';
import { hashFile, hashUploadChunk, uploadIdentity } from './hash';
import { createUploadJobs, createUploadEventHandler, type UploadJob } from './jobs';

const PROGRESS_INTERVAL_MS = 100;

function invalidResponse(): Result<never, ApplicationError> {
    return Err(INVALID_UPLOAD_PROGRESS);
}

function uploadChunk(
    file: File,
    header: SplitHeader,
    email: string,
    transport: ChunkTransport,
    onProgress: (sent: number, reused: number) => void,
    onChunk: (
        chunk: UploadEvent & { type: UploadEventType.Chunk }
    ) => Result<void, ApplicationError>
): AsyncResult<UploadResponse, ApplicationError> {
    const start = header.chunkIndex * MAX_CHUNK_PAYLOAD_BYTES;
    const payload = file.slice(start, start + header.payloadSize);

    return hashUploadChunk(payload, header).andThenAsync(async ({ sha1, size }) => {
        const metadata = {
            file: { name: file.name, size: file.size, fileHash: header.fileHash },
            chunkIndex: header.chunkIndex,
            sha1
        };

        let sent = 0;
        let reused = 0;
        let saved: UploadedChunk | null = null;
        let result: UploadResponse | null = null;
        const uploaded = await transport(metadata, payload, (event) => {
            if (event.type === UploadEventType.Error)
                return Err({ code: 'UPLOAD_FAILED', message: event.error } as const);
            if (event.type === UploadEventType.Complete)
                return saved && result ? Ok(undefined) : invalidResponse();
            if (event.id !== 0 || result) return invalidResponse();
            if (event.type === UploadEventType.Progress) {
                const progress = event.progress;
                if (
                    progress.phase !== UploadPhase.Uploading ||
                    progress.total !== size ||
                    progress.completed < sent ||
                    progress.reused < reused
                )
                    return invalidResponse();

                sent = progress.completed;
                reused = progress.reused;
                onProgress(sent, reused);

                return Ok(undefined);
            }
            if (event.type === UploadEventType.Chunk) {
                const chunk = event.chunk;
                if (
                    saved ||
                    chunk.fileHash !== header.fileHash ||
                    chunk.fileId !== header.fileId ||
                    chunk.chunkIndex !== header.chunkIndex ||
                    chunk.isLast !== Boolean(header.flags) ||
                    chunk.size !== header.payloadSize ||
                    chunk.originalName !== header.fileName ||
                    chunk.sha1 !== sha1
                )
                    return invalidResponse();

                saved = { ...chunk, email };

                return onChunk(event);
            }
            if (event.type === UploadEventType.FileComplete) {
                if (
                    !saved ||
                    sent + reused !== size ||
                    event.result.sha1 !== saved.sha1 ||
                    event.result.mediaKey !== saved.mediaKey
                )
                    return invalidResponse();

                result = event.result;

                return Ok(undefined);
            }

            return invalidResponse();
        });

        return uploaded.andThen(() => (result ? Ok(result) : invalidResponse()));
    });
}

function uploadPlannedFile(
    { file, id }: { file: File; id: number },
    { headers, sizes }: UploadPlan,
    email: string,
    transport: ChunkTransport,
    chunkLimit: ReturnType<typeof pLimit>,
    handle: (event: UploadEvent) => Result<void, ApplicationError>
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const total = sizes.reduce((sum, size) => sum + size, 0);
        const sent = headers.map(() => 0);
        const reused = headers.map(() => 0);
        let failure: ApplicationError | null = null;
        let uploadedAny = false;
        handle({
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Uploading, completed: 0, reused: 0, total }
        });

        const results = await chunkLimit.map(headers, async (header) => {
            if (failure) return Err(failure);

            const result = await uploadChunk(
                file,
                header,
                email,
                transport,
                (completed, existing) => {
                    sent[header.chunkIndex] = completed;
                    reused[header.chunkIndex] = existing;
                    handle({
                        type: UploadEventType.Progress,
                        id,
                        progress: {
                            phase: UploadPhase.Uploading,
                            completed: sent.reduce((sum, size) => sum + size, 0),
                            reused: reused.reduce((sum, size) => sum + size, 0),
                            total
                        }
                    });
                },
                (event) => handle({ ...event, id })
            );

            result.match({
                Ok: (response) => {
                    uploadedAny ||= response.status === UploadStatus.Uploaded;
                },
                Err: (error) => {
                    failure ??= error;
                }
            });

            return result;
        });

        const failed = results.find((result) => result.isErr());
        if (failed) {
            failed.inspectErr((error) =>
                handle({ type: UploadEventType.FileError, id, error: error.message })
            );

            return Ok(undefined);
        }

        const last = results.at(-1);
        if (!last) {
            handle({
                type: UploadEventType.FileError,
                id,
                error: 'No chunks were uploaded.'
            });

            return Ok(undefined);
        }

        last.inspect((result) =>
            handle({
                type: UploadEventType.FileComplete,
                id,
                result: {
                    ...result,
                    status: uploadedAny ? UploadStatus.Uploaded : UploadStatus.AlreadyExists
                }
            })
        );

        return Ok(undefined);
    });
}

/** Hash locally, then send bounded slices through a single shared transfer pool. */
export function uploadFiles(
    files: readonly File[],
    email: string,
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void
): AsyncResult<void, ApplicationError> {
    return schemaResult(
        ConcurrentWorkersSchema,
        workers,
        'Invalid concurrent worker count.'
    ).andThenAsync((concurrency) =>
        transferFiles(files, email, concurrency, onJob, onChunk, httpChunkTransport)
    );
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
    onChunk: (chunk: UploadedChunk) => void,
    transport: ChunkTransport
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const jobs = createUploadJobs(files);
        const sources: { file: File; jobId: number }[] = [];
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
        if (!sources.length) return Ok(undefined);

        const handle = createUploadEventHandler(sources, jobs, email, onJob, onChunk);
        const chunkLimit = pLimit(concurrency);
        const fileLimit = pLimit(concurrency);
        await fileLimit.map(sources, async ({ file }, id) => {
            handle({ type: UploadEventType.Queued, id });

            let lastProgress = 0;
            const prepared = await hashFile(file, (completed) => {
                const now = performance.now();
                if (completed !== file.size && now - lastProgress < PROGRESS_INTERVAL_MS) return;

                lastProgress = now;
                handle({
                    type: UploadEventType.Progress,
                    id,
                    progress: { phase: UploadPhase.Preparing, completed, total: file.size }
                });
            }).andThenAsync((fileHash) =>
                uploadIdentity(file.name, fileHash).map((fileId) => ({ fileHash, fileId }))
            );
            if (prepared.isErr()) {
                prepared.inspectErr((error) =>
                    handle({ type: UploadEventType.FileError, id, error: error.message })
                );

                return;
            }

            const planned = prepared.andThen(({ fileHash, fileId }) =>
                planChunks({ name: file.name, size: file.size, fileHash }, fileId)
            );

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
