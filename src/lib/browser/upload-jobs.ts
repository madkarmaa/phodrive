import type { ApplicationError } from '$lib/errors';
import {
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    type UploadEvent,
    type UploadProgress,
    type UploadResponse
} from '$lib/models';
import type { UploadedChunk } from '$lib/file-groups';
import { Err, Ok, type Result } from 'results-ts';

export interface UploadJob {
    id: number;
    name: string;
    status: UploadJobStatus;
    progress: UploadProgress;
    message: string;
    result: UploadResponse | null;
}

export interface UploadSource {
    file: File;
    jobId: number;
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

function invalidProgress(): Result<never, ApplicationError> {
    return Err({
        code: 'INVALID_UPLOAD_PROGRESS',
        message: 'Invalid upload progress response.'
    } as const);
}

function updateProgress(
    job: UploadJob,
    file: File,
    progress: UploadProgress
): Result<UploadJob, ApplicationError> {
    const previous = job.progress;
    if (progress.phase === UploadPhase.Receiving) return invalidProgress();
    if (
        progress.phase === UploadPhase.Preparing &&
        (progress.total !== file.size || previous.phase === UploadPhase.Uploading)
    )
        return invalidProgress();
    if (
        progress.phase === UploadPhase.Uploading &&
        previous.phase === UploadPhase.Uploading &&
        (progress.total !== previous.total ||
            progress.completed < previous.completed ||
            progress.reused < previous.reused)
    )
        return invalidProgress();

    return Ok({ ...job, status: UploadJobStatus.Active, progress });
}

function completeJob(
    job: UploadJob,
    file: File,
    confirmed: Map<number, UploadedChunk>,
    result: UploadResponse
): Result<UploadJob, ApplicationError> {
    const progress = job.progress;
    const chunks = [...confirmed.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
    if (
        progress.phase !== UploadPhase.Uploading ||
        progress.completed + progress.reused !== progress.total ||
        chunks.length === 0 ||
        chunks.reduce((sum, chunk) => sum + chunk.size, 0) !== file.size ||
        chunks.some(
            (chunk, index) =>
                chunk.chunkIndex !== index || chunk.isLast !== (index === chunks.length - 1)
        )
    )
        return invalidProgress();

    return Ok({ ...job, status: UploadJobStatus.Complete, result });
}

/** Server IDs index submitted files; local job IDs also include rejected selections. */
export function createUploadEventHandler(
    sources: UploadSource[],
    jobs: UploadJob[],
    email: string,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void
): (event: UploadEvent) => Result<void, ApplicationError> {
    const confirmed = jobs.map(() => new Map<number, UploadedChunk>());

    function publish(job: UploadJob): void {
        jobs[job.id] = job;
        onJob(job);
    }

    return (event) => {
        if (event.type === UploadEventType.Error)
            return Err({ code: 'UPLOAD_FAILED', message: event.error } as const);
        if (event.type === UploadEventType.Complete) {
            const unfinished = jobs.some(
                (job) =>
                    job.status !== UploadJobStatus.Complete && job.status !== UploadJobStatus.Error
            );
            return unfinished ? invalidProgress() : Ok(undefined);
        }

        const source = sources[event.id];
        if (!source) return invalidProgress();

        const { file, jobId } = source;
        const job = jobs[jobId];
        if (job.status === UploadJobStatus.Complete || job.status === UploadJobStatus.Error)
            return invalidProgress();

        switch (event.type) {
            case UploadEventType.Queued:
                if (job.progress.phase !== UploadPhase.Receiving) return invalidProgress();
                publish({
                    ...job,
                    status: UploadJobStatus.Queued,
                    progress: { phase: UploadPhase.Preparing, completed: 0, total: file.size }
                });
                return Ok(undefined);

            case UploadEventType.Progress:
                return updateProgress(job, file, event.progress).map(publish);

            case UploadEventType.Chunk: {
                const chunk = { ...event.chunk, email };
                const saved = confirmed[jobId];
                const first = saved.values().next().value;
                if (
                    job.progress.phase !== UploadPhase.Uploading ||
                    saved.has(chunk.chunkIndex) ||
                    (first &&
                        (first.fileHash !== chunk.fileHash || first.fileId !== chunk.fileId)) ||
                    (chunk.chunkIndex === 0 && chunk.originalName !== file.name)
                )
                    return invalidProgress();

                saved.set(chunk.chunkIndex, chunk);
                onChunk(chunk);
                return Ok(undefined);
            }

            case UploadEventType.FileComplete:
                return completeJob(job, file, confirmed[jobId], event.result).map(publish);

            case UploadEventType.FileError:
                publish({ ...job, status: UploadJobStatus.Error, message: event.error });
                return Ok(undefined);
        }
    };
}
