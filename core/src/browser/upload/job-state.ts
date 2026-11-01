import { Err, Ok, type Result } from 'results-ts';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import {
    UploadJobStatus,
    UploadPhase,
    type UploadProgress,
    type UploadResponse
} from '../../models';
import { INVALID_UPLOAD_PROGRESS } from './request';

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

export function invalidProgress(): Result<never, ApplicationError> {
    return Err(INVALID_UPLOAD_PROGRESS);
}

export function updateProgress(
    job: UploadJob,
    file: File,
    progress: UploadProgress
): Result<UploadJob, ApplicationError> {
    const previous = job.progress;
    // Only a server that splits files itself reports receiving them, before it prepares them.
    if (
        progress.phase === UploadPhase.Receiving &&
        (previous.phase !== UploadPhase.Receiving ||
            progress.total !== file.size ||
            progress.completed < previous.completed)
    )
        return invalidProgress();
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

export function completeJob(
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

export function finished(job: UploadJob): boolean {
    return job.status === UploadJobStatus.Complete || job.status === UploadJobStatus.Error;
}

/** Only a file the server is still receiving can be queued for preparation. */
export function queueJob(job: UploadJob, file: File): Result<UploadJob, ApplicationError> {
    if (job.progress.phase !== UploadPhase.Receiving) return invalidProgress();

    return Ok({
        ...job,
        status: UploadJobStatus.Queued,
        progress: { phase: UploadPhase.Preparing, completed: 0, total: file.size }
    });
}

/** A chunk is confirmed once, while uploading, and belongs to the same file as earlier ones. */
export function checkChunk(
    job: UploadJob,
    file: File,
    saved: Map<number, UploadedChunk>,
    chunk: UploadedChunk
): Result<void, ApplicationError> {
    const first = saved.values().next().value;
    const sameFile = !first || (first.fileHash === chunk.fileHash && first.fileId === chunk.fileId);
    const named = chunk.chunkIndex !== 0 || chunk.originalName === file.name;
    const valid =
        job.progress.phase === UploadPhase.Uploading &&
        !saved.has(chunk.chunkIndex) &&
        sameFile &&
        named;

    return valid ? Ok(undefined) : invalidProgress();
}
