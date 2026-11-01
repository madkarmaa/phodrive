import { Err, Ok, type Result } from 'results-ts';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { UploadEventType, UploadJobStatus, type UploadEvent } from '../../models';
import {
    checkChunk,
    completeJob,
    finished,
    invalidProgress,
    queueJob,
    updateProgress,
    type UploadJob,
    type UploadSource
} from './job-state';

export { createUploadJobs, type UploadJob, type UploadSource } from './job-state';

type FileEvent = Exclude<UploadEvent, { type: UploadEventType.Error | UploadEventType.Complete }>;

/** Server IDs index submitted files; local job IDs also include rejected selections. */
export function createUploadEventHandler(
    sources: UploadSource[],
    jobs: UploadJob[],
    email: string,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk, jobId: number) => void
): (event: UploadEvent) => Result<void, ApplicationError> {
    const confirmed = jobs.map(() => new Map<number, UploadedChunk>());

    function publish(job: UploadJob): void {
        jobs[job.id] = job;
        onJob(job);
    }

    function handleFileEvent(event: FileEvent): Result<void, ApplicationError> {
        const source = sources[event.id];
        if (!source) return invalidProgress();

        const { file, jobId } = source;
        const job = jobs[jobId];
        if (finished(job)) return invalidProgress();

        switch (event.type) {
            case UploadEventType.Queued:
                return queueJob(job, file).map(publish);

            case UploadEventType.Progress:
                return updateProgress(job, file, event.progress).map(publish);

            case UploadEventType.Chunk: {
                const chunk = { ...event.chunk, email };

                return checkChunk(job, file, confirmed[jobId], chunk).map(() => {
                    confirmed[jobId].set(chunk.chunkIndex, chunk);
                    onChunk(chunk, jobId);
                });
            }

            case UploadEventType.FileComplete:
                return completeJob(job, file, confirmed[jobId], event.result).map(publish);

            case UploadEventType.FileError:
                publish({ ...job, status: UploadJobStatus.Error, message: event.error });
                return Ok(undefined);
        }
    }

    return (event) => {
        if (event.type === UploadEventType.Error)
            return Err({ code: 'UPLOAD_FAILED', message: event.error } as const);
        if (event.type === UploadEventType.Complete)
            return jobs.every(finished) ? Ok(undefined) : invalidProgress();

        return handleFileEvent(event);
    };
}
