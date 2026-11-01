import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '../errors';
import type { UploadedChunk } from '../files';
import { UploadEventType, type Account, type UploadEvent } from '../models';
import { transferFiles } from '../browser/upload/index';
import type { ChunkTransport } from '../browser/upload/request';
import type { UploadJob } from '../browser/upload/jobs';
import type { Fetcher } from '../server/fetcher';
import { receiveChunk } from '../server/upload/input';
import { uploadFiles as forwardChunk } from '../server/upload/index';
import { validateWorkers } from '../server/workers';

export type TransferOptions = { signal?: AbortSignal; fetcher?: Fetcher };

/** Forward chunks to Google Photos in this process, reporting the same events as the HTTP API. */
export function localChunkTransport(
    account: Account,
    { signal, fetcher }: TransferOptions = {}
): ChunkTransport {
    return ({ metadata, payload }, onEvent) =>
        Ok(undefined).andThenAsync(async () => {
            const abort = new AbortController();
            const onAbort = () => abort.abort();
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) abort.abort();

            // Stop the provider transfer as soon as the uploader rejects an event.
            const failures: ApplicationError[] = [];
            const emit = (event: UploadEvent) => {
                if (failures.length) return;

                onEvent(event).inspectErr((error) => {
                    failures.push(error);
                    abort.abort();
                });
            };

            try {
                const uploaded = await receiveChunk(
                    { ...account, ...metadata },
                    payload.stream(),
                    abort.signal
                ).andThenAsync(async (input) => {
                    const forwarded = await forwardChunk(input, emit, fetcher);

                    const cancelled = await input.cancel();

                    return forwarded.andThen(() => cancelled);
                });

                const failure = failures[0];
                if (failure) return Err(failure);

                return uploaded.match({
                    Ok: () => onEvent({ type: UploadEventType.Complete }),
                    Err: (error) => onEvent({ type: UploadEventType.Error, error: error.message })
                });
            } finally {
                signal?.removeEventListener('abort', onAbort);
            }
        });
}

/**
 * Upload local files with the web app's hashing, chunking, deduplication, and worker pool,
 * using up to one worker per available processor.
 */
export function uploadFiles(
    files: readonly File[],
    email: string,
    token: string,
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk, jobId: number) => void,
    options: TransferOptions = {}
): AsyncResult<void, ApplicationError> {
    return validateWorkers(workers).andThenAsync((concurrency) =>
        transferFiles(
            files,
            email,
            concurrency,
            onJob,
            onChunk,
            localChunkTransport({ email, token }, options)
        )
    );
}
