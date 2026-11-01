import type pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../../errors';
import { UploadEventType, UploadPhase, UploadStatus, type UploadEvent } from '../../models';
import { planChunks, type UploadPlan } from '../../upload';
import { uploadChunk } from './chunk';
import { hashFile, uploadIdentity } from './hash';
import type { ChunkTransport } from './request';

const PROGRESS_INTERVAL_MS = 100;

type EventHandler = (event: UploadEvent) => Result<void, ApplicationError>;

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

/** Hash the whole file, reporting progress at most every interval, then plan its chunks. */
export function prepareFile(
    file: File,
    id: number,
    handle: EventHandler
): AsyncResult<UploadPlan, ApplicationError> {
    let lastProgress = 0;
    const onHashed = (completed: number) => {
        const now = performance.now();
        if (completed !== file.size && now - lastProgress < PROGRESS_INTERVAL_MS) return;

        lastProgress = now;
        handle({
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Preparing, completed, total: file.size }
        });
    };

    return hashFile(file, onHashed)
        .andThenAsync((fileHash) =>
            uploadIdentity(file.name, fileHash).map((fileId) => ({ fileHash, fileId }))
        )
        .andThen(({ fileHash, fileId }) =>
            planChunks({ name: file.name, size: file.size, fileHash }, fileId)
        );
}

/** Combined progress of every chunk of one file, reported under the file's ID. */
function fileProgress({ headers, sizes }: UploadPlan, id: number, handle: EventHandler) {
    const total = sum(sizes);
    const sent = headers.map(() => 0);
    const reused = headers.map(() => 0);
    const report = () =>
        handle({
            type: UploadEventType.Progress,
            id,
            progress: {
                phase: UploadPhase.Uploading,
                completed: sum(sent),
                reused: sum(reused),
                total
            }
        });

    return {
        report,
        update: (chunkIndex: number, completed: number, existing: number) => {
            sent[chunkIndex] = completed;
            reused[chunkIndex] = existing;
            report();
        }
    };
}

/**
 * Upload a planned file's chunks through the shared pool. Once one chunk fails, chunks that have
 * not started are skipped and the file is reported as failed.
 */
export function uploadPlannedFile(
    { file, id }: { file: File; id: number },
    plan: UploadPlan,
    email: string,
    transport: ChunkTransport,
    chunkLimit: ReturnType<typeof pLimit>,
    handle: EventHandler
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const progress = fileProgress(plan, id, handle);
        let failure: ApplicationError | null = null;
        let uploadedAny = false;
        progress.report();

        const results = await chunkLimit.map(plan.headers, async (header) => {
            if (failure) return Err(failure);

            const result = await uploadChunk(
                file,
                header,
                email,
                transport,
                (completed, existing) => progress.update(header.chunkIndex, completed, existing),
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
            handle({ type: UploadEventType.FileError, id, error: 'No chunks were uploaded.' });

            return Ok(undefined);
        }

        const status = uploadedAny ? UploadStatus.Uploaded : UploadStatus.AlreadyExists;
        last.inspect((result) =>
            handle({ type: UploadEventType.FileComplete, id, result: { ...result, status } })
        );

        return Ok(undefined);
    });
}
