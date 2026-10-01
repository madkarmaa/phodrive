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
import { chunkFileName } from '$server/chunks';
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
    const headers: SplitHeader[] = [];
    const sizes: number[] = [];
    for (let index = 0; index < count; index++) {
        const header: SplitHeader = {
            fileHash: file.fileHash,
            chunkIndex: index,
            flags: index === count - 1 ? 1 : 0,
            payloadSize: Math.min(
                MAX_CHUNK_PAYLOAD_BYTES,
                file.size - index * MAX_CHUNK_PAYLOAD_BYTES
            ),
            fileName: index === 0 ? file.name : undefined
        };
        const projected = splitBmpByteLength(header);
        const failure = projected.match({
            Ok: (size) => {
                sizes.push(size);
                return null;
            },
            Err: (error) => error
        });
        if (failure) return Err(failure);

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

function uploadFile(
    file: ReceivedFile,
    id: number,
    email: string,
    token: string,
    emit: (event: UploadEvent) => void,
    limit: LimitFunction,
    fetcher?: Fetcher
): AsyncResult<UploadResponse, Error> {
    return planUpload(file).andThenAsync(async ({ headers, sizes }) => {
        let failure: Error | null = null;
        let completed = 0;
        let reused = 0;
        let uploadedAny = false;
        const total = sizes.reduce((sum, size) => sum + size, 0);
        const sentByChunk = headers.map(() => 0);
        let lastUpdate = 0;
        const report = (force = false) => {
            const now = performance.now();
            if (!force && lastUpdate && now - lastUpdate < PROGRESS_INTERVAL_MS) return;

            lastUpdate = now;
            emit({
                type: UploadEventType.Progress,
                id,
                progress: { phase: UploadPhase.Uploading, completed, total, reused }
            });
        };
        report(true);

        const upload = (
            header: SplitHeader
        ): Result<UploadResponse, Error> | AsyncResult<UploadResponse, Error> => {
            // After failure, leave queued ranges unread and settle every active Google operation.
            if (failure) return Err(failure);

            const index = header.chunkIndex;
            return uploadChunk(
                file,
                header,
                headers.length,
                email,
                token,
                (sent) => {
                    completed += sent - sentByChunk[index];
                    sentByChunk[index] = sent;
                    report(sent === sizes[index]);
                },
                fetcher
            )
                .map((response) => {
                    uploadedAny ||= response.status === UploadStatus.Uploaded;
                    if (response.status === UploadStatus.AlreadyExists) reused += sizes[index];
                    if (
                        response.status === UploadStatus.Uploaded &&
                        sentByChunk[index] < sizes[index]
                    ) {
                        completed += sizes[index] - sentByChunk[index];
                        sentByChunk[index] = sizes[index];
                    }

                    emit({
                        type: UploadEventType.Chunk,
                        id,
                        chunk: {
                            fileHash: file.fileHash,
                            chunkIndex: index,
                            isLast: header.flags === 1,
                            originalName: header.fileName,
                            size: header.payloadSize,
                            at: Date.now(),
                            mediaKey: response.mediaKey,
                            sha1: response.sha1
                        }
                    });
                    report(true);
                    return response;
                })
                .mapErr((error) => {
                    failure ??= error;
                    return error;
                });
        };

        const responses = await limit.map(headers, upload);
        let final: Result<UploadResponse | null, Error> = Ok(null);
        for (const response of responses) final = final.andThen(() => response);

        return final.andThen((last) => {
            if (!last) return Err(new Error('No chunks were uploaded.'));

            return Ok({
                ...last,
                status: uploadedAny ? UploadStatus.Uploaded : UploadStatus.AlreadyExists
            });
        });
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
            const uploaded = await uploadFile(
                file,
                id,
                input.email,
                input.token,
                emit,
                chunkLimit,
                fetcher
            );
            uploaded.match({
                Ok: (result) => emit({ type: UploadEventType.FileComplete, id, result }),
                Err: (error) => emit({ type: UploadEventType.FileError, id, error: error.message })
            });
        });

        return Ok(undefined);
    });
}
