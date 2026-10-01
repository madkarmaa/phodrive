import {
    FileActionKind,
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    ConcurrentWorkersSchema,
    FileDeleteResponseSchema,
    type UploadEvent,
    type UploadProgress,
    type UploadResponse
} from '$lib/models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup, UploadedChunk } from '$lib/file-groups';
import { schemaResult } from '$lib/schema-result';
import { apiJson, request } from '$browser/api';
import { uploadRequest } from '$browser/upload';

export type { UploadProgress } from '$lib/models';

export interface UploadJob {
    id: number;
    name: string;
    status: UploadJobStatus;
    progress: UploadProgress;
    message: string;
    result: UploadResponse | null;
}

export function createUploadJobs(files: readonly File[]): UploadJob[] {
    return files.map((file, id) => ({
        id,
        name: file.name,
        status: UploadJobStatus.Queued,
        progress: { phase: UploadPhase.Receiving, completed: 0, total: file.size },
        message: '',
        result: null
    }));
}

/** The browser sends original files without reading, hashing, slicing, or encoding their bytes. */
export function uploadFiles(
    files: readonly File[],
    email: string,
    token: string,
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void
): AsyncResult<void, Error> {
    return schemaResult(
        ConcurrentWorkersSchema,
        workers,
        'Invalid concurrent worker count.'
    ).andThenAsync(async (concurrency) => {
        const jobs = createUploadJobs(files);
        const sources: { file: File; jobId: number }[] = [];
        const confirmed = jobs.map(() => new Map<number, UploadedChunk>());
        const form = new FormData();
        form.set('email', email);
        form.set('token', token);
        form.set('workers', String(concurrency));

        for (const [id, file] of files.entries()) {
            if (!file.name || /[\\/\r\n\0]/.test(file.name) || !Number.isSafeInteger(file.size)) {
                jobs[id] = {
                    ...jobs[id],
                    status: UploadJobStatus.Error,
                    message: 'Invalid file name or size.'
                };
                onJob(jobs[id]);
                continue;
            }

            sources.push({ file, jobId: id });
            form.append('file', file);
            jobs[id] = { ...jobs[id], status: UploadJobStatus.Active };
            onJob(jobs[id]);
        }
        if (sources.length === 0) return Ok(undefined);

        const invalid = () => Err(new Error('Invalid upload progress response.'));
        const handle = (event: UploadEvent): Result<void, Error> => {
            if (event.type === UploadEventType.Error) return Err(new Error(event.error));
            if (event.type === UploadEventType.Complete) {
                if (
                    jobs.some(
                        (job) =>
                            job.status !== UploadJobStatus.Complete &&
                            job.status !== UploadJobStatus.Error
                    )
                )
                    return invalid();
                return Ok(undefined);
            }

            const source = sources[event.id];
            if (!source) return invalid();
            const { file, jobId } = source;
            let job = jobs[jobId];
            if (job.status === UploadJobStatus.Complete || job.status === UploadJobStatus.Error)
                return invalid();

            if (event.type === UploadEventType.Queued) {
                if (job.progress.phase !== UploadPhase.Receiving) return invalid();
                job = {
                    ...job,
                    status: UploadJobStatus.Queued,
                    progress: { phase: UploadPhase.Preparing, completed: 0, total: file.size }
                };
            }
            if (event.type === UploadEventType.Progress) {
                const previous = job.progress;
                const progress = event.progress;
                if (progress.phase === UploadPhase.Receiving) return invalid();
                if (
                    progress.phase === UploadPhase.Preparing &&
                    (progress.total !== file.size || previous.phase === UploadPhase.Uploading)
                )
                    return invalid();
                if (
                    progress.phase === UploadPhase.Uploading &&
                    previous.phase === UploadPhase.Uploading &&
                    (progress.total !== previous.total ||
                        progress.completed < previous.completed ||
                        progress.reused < previous.reused)
                )
                    return invalid();

                job = { ...job, status: UploadJobStatus.Active, progress };
            }
            if (event.type === UploadEventType.Chunk) {
                const chunk = { ...event.chunk, email };
                const saved = confirmed[jobId];
                const first = saved.values().next().value;
                if (
                    job.progress.phase !== UploadPhase.Uploading ||
                    saved.has(chunk.chunkIndex) ||
                    (first && first.fileHash !== chunk.fileHash) ||
                    (chunk.chunkIndex === 0 && chunk.originalName !== file.name)
                )
                    return invalid();

                saved.set(chunk.chunkIndex, chunk);
                onChunk(chunk);
                return Ok(undefined);
            }
            if (event.type === UploadEventType.FileComplete) {
                const progress = job.progress;
                const chunks = [...confirmed[jobId].values()].sort(
                    (a, b) => a.chunkIndex - b.chunkIndex
                );
                if (
                    progress.phase !== UploadPhase.Uploading ||
                    progress.completed + progress.reused !== progress.total ||
                    chunks.length === 0 ||
                    chunks.reduce((sum, chunk) => sum + chunk.size, 0) !== file.size ||
                    chunks.some(
                        (chunk, index) =>
                            chunk.chunkIndex !== index ||
                            chunk.isLast !== (index === chunks.length - 1)
                    )
                )
                    return invalid();

                job = { ...job, status: UploadJobStatus.Complete, result: event.result };
            }
            if (event.type === UploadEventType.FileError)
                job = { ...job, status: UploadJobStatus.Error, message: event.error };

            jobs[jobId] = job;
            onJob(job);
            return Ok(undefined);
        };

        return uploadRequest(form, handle);
    });
}

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
): AsyncResult<void, Error> {
    return schemaResult(ConcurrentWorkersSchema, workers, 'Invalid concurrent worker count.')
        .andThenAsync((concurrency) =>
            apiJson(
                '/api/files',
                fileRequest(item, FileActionKind.Delete, token, concurrency),
                'Delete failed'
            )
        )
        .andThen((data) => schemaResult(FileDeleteResponseSchema, data, 'Delete failed'))
        .andThen(({ deleted, error }) => {
            for (const chunk of deleted) {
                const known = item.chunks.find(
                    (current) => current.mediaKey === chunk.mediaKey && current.sha1 === chunk.sha1
                );
                if (!known) return Err(new Error('Invalid delete response.'));
                onDeleted(known);
            }

            return error ? Err(new Error(error)) : Ok(undefined);
        });
}

export function downloadFile(item: FileGroup, token: string): AsyncResult<Blob, Error> {
    return Ok(undefined).andThenAsync(async () => {
        if (!item.complete || item.chunkCount === null)
            return Err(new Error('Load the remaining chunks before downloading.'));

        return request(
            '/api/files',
            fileRequest(item, FileActionKind.Download, token, 1),
            'Download failed'
        ).andThenAsync(async (response) => {
            try {
                const file = await response.blob();
                return Ok(file);
            } catch {
                return Err(new Error('Could not receive the downloaded file.'));
            }
        });
    });
}
