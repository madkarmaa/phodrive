import {
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type SplitHeader,
    type UploadEvent,
    type UploadResponse
} from '$lib/models';
import pLimit, { type LimitFunction } from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { encodeSplitBmp, MAX_CHUNK_PAYLOAD_BYTES, splitBmpByteLength } from '$server/bmp';
import { chunkFileName, fileIdentity } from '$server/chunks';
import { readFileRange } from '$server/temporary-files';
import { photosFetchWithProgress, type Fetcher } from '$server/fetcher';
import { uploadBmp } from '$server/photos';
import type { ReceivedFile, ReceivedUpload } from '$server/upload-input';

const PROGRESS_INTERVAL_MS = 100;
type UploadPlan = { headers: SplitHeader[]; sizes: number[] };

export function planUpload(file: ReceivedFile): Result<UploadPlan, Error> {
    if (
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !file.name ||
        /[\\/\r\n\0]/.test(file.name)
    )
        return Err(new Error('Invalid file name or size.'));

    const count = Math.max(1, Math.ceil(file.size / MAX_CHUNK_PAYLOAD_BYTES));
    const fileId = fileIdentity(file.name, file.fileHash);
    const headers: SplitHeader[] = [];
    const sizes: number[] = [];
    for (let index = 0; index < count; index++) {
        const header: SplitHeader = {
            fileHash: file.fileHash,
            fileId,
            chunkIndex: index,
            flags: index === count - 1 ? 1 : 0,
            payloadSize: Math.min(
                MAX_CHUNK_PAYLOAD_BYTES,
                file.size - index * MAX_CHUNK_PAYLOAD_BYTES
            ),
            fileName: index === 0 ? file.name : undefined
        };
        const projected = splitBmpByteLength(header);
        if (projected.isErr()) return projected;

        projected.inspect((size) => sizes.push(size));
        headers.push(header);
    }

    return Ok({ headers, sizes });
}

function uploadChunk(
    file: ReceivedFile,
    header: SplitHeader,
    count: number,
    email: string,
    token: string,
    onProgress: (sent: number) => void,
    fetcher?: Fetcher
): AsyncResult<UploadResponse, Error> {
    return readFileRange(file.path, header.chunkIndex * MAX_CHUNK_PAYLOAD_BYTES, header.payloadSize)
        .andThen((payload) => encodeSplitBmp(payload, header))
        .andThenAsync((bmp) =>
            uploadBmp(
                email,
                token,
                chunkFileName(file.name, file.fileHash, header.chunkIndex, count),
                Buffer.from(bmp.buffer, bmp.byteOffset, bmp.byteLength),
                fetcher ?? photosFetchWithProgress(onProgress)
            )
        );
}

/** Keep wire bytes and reused bytes separate; only confirmed chunks can finish a job. */
function createProgressReporter(plan: UploadPlan, id: number, emit: (event: UploadEvent) => void) {
    const total = plan.sizes.reduce((sum, size) => sum + size, 0);
    const sentByChunk = plan.headers.map(() => 0);
    let completed = 0;
    let reused = 0;
    let lastUpdate = 0;

    function report(force = false) {
        const now = performance.now();
        if (!force && lastUpdate && now - lastUpdate < PROGRESS_INTERVAL_MS) return;

        lastUpdate = now;
        emit({
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Uploading, completed, total, reused }
        });
    }

    function sent(index: number, bytes: number) {
        completed += bytes - sentByChunk[index];
        sentByChunk[index] = bytes;
        report(bytes === plan.sizes[index]);
    }

    function confirm(index: number, status: UploadStatus) {
        if (status === UploadStatus.AlreadyExists) reused += plan.sizes[index];
        if (status === UploadStatus.Uploaded && sentByChunk[index] < plan.sizes[index]) {
            completed += plan.sizes[index] - sentByChunk[index];
            sentByChunk[index] = plan.sizes[index];
        }
    }

    return { report, sent, confirm };
}

function uploadPlannedFile(
    file: ReceivedFile,
    plan: UploadPlan,
    id: number,
    input: ReceivedUpload,
    emit: (event: UploadEvent) => void,
    limit: LimitFunction,
    fetcher?: Fetcher
): AsyncResult<UploadResponse, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const progress = createProgressReporter(plan, id, emit);
        let failure: Error | null = null;
        let uploadedAny = false;
        progress.report(true);

        const responses = await limit.map(plan.headers, async (header) => {
            // Leave queued ranges unread after failure; settle every active Google operation.
            if (failure) return Err(failure);

            const index = header.chunkIndex;
            const uploaded = await uploadChunk(
                file,
                header,
                plan.headers.length,
                input.email,
                input.token,
                (sent) => progress.sent(index, sent),
                fetcher
            );

            uploaded.match({
                Ok: (response) => {
                    uploadedAny ||= response.status === UploadStatus.Uploaded;
                    progress.confirm(index, response.status);
                    emit({
                        type: UploadEventType.Chunk,
                        id,
                        chunk: {
                            fileHash: file.fileHash,
                            fileId: header.fileId,
                            chunkIndex: index,
                            isLast: header.flags === 1,
                            originalName: header.fileName,
                            size: header.payloadSize,
                            at: Date.now(),
                            mediaKey: response.mediaKey,
                            sha1: response.sha1
                        }
                    });
                    progress.report(true);
                },
                Err: (error) => {
                    failure ??= error;
                }
            });

            return uploaded;
        });

        let last: Result<UploadResponse, Error> = Err(new Error('No chunks were uploaded.'));
        for (const response of responses) {
            if (response.isErr()) return response;
            last = response;
        }

        return last.map((response) => ({
            ...response,
            status: uploadedAny ? UploadStatus.Uploaded : UploadStatus.AlreadyExists
        }));
    });
}

/** A single transfer pool covers every file in the selection. */
export function uploadFiles(
    input: ReceivedUpload,
    emit: (event: UploadEvent) => void,
    fetcher?: Fetcher
): AsyncResult<void, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const chunkLimit = pLimit(input.workers);
        const fileLimit = pLimit(input.workers);
        for (const [id] of input.files.entries()) emit({ type: UploadEventType.Queued, id });

        await fileLimit.map(input.files, async (file, id) => {
            emit({
                type: UploadEventType.Progress,
                id,
                progress: { phase: UploadPhase.Preparing, completed: 0, total: file.size }
            });
            const uploaded = await planUpload(file).andThenAsync((plan) =>
                uploadPlannedFile(file, plan, id, input, emit, chunkLimit, fetcher)
            );
            uploaded.match({
                Ok: (result) => emit({ type: UploadEventType.FileComplete, id, result }),
                Err: (error) => emit({ type: UploadEventType.FileError, id, error: error.message })
            });
        });

        return Ok(undefined);
    });
}
