import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type UploadEvent,
    type UploadFile
} from '#lib/models';
import { SERVER_ERRORS, type ServerError } from '#server/errors';
import { planChunks, type UploadPlan } from '#lib/upload';
import { chunkFileName, fileIdentity } from '#server/chunks';
import { photosFetchWithProgress, type Fetcher } from '#server/fetcher';
import { uploadBmpStream } from '#server/photos';
import { encodeUploadBmp } from '#server/upload/bmp';
import type { ReceivedUpload } from '#server/upload/input';

const PROGRESS_INTERVAL_MS = 100;

export function planUpload(file: UploadFile): Result<UploadPlan, ServerError> {
    if (
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !file.name ||
        /[\\/\r\n\0]/.test(file.name)
    )
        return Err(SERVER_ERRORS.INVALID_FILE_NAME_OR_SIZE);

    return planChunks(file, fileIdentity(file.name, file.fileHash));
}

/** One incoming split is encoded and forwarded directly, with no disk or whole-chunk buffer. */
export function uploadFiles(
    input: ReceivedUpload,
    emit: (event: UploadEvent) => void,
    fetcher?: Fetcher
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const source = encodeUploadBmp(input);
        let lastProgress = 0;
        const report = (completed: number, reused = 0, force = false) => {
            const now = performance.now();
            if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return;

            lastProgress = now;
            emit({
                type: UploadEventType.Progress,
                id: 0,
                progress: {
                    phase: UploadPhase.Uploading,
                    completed,
                    reused,
                    total: input.bmp.totalSize
                }
            });
        };
        report(0, 0, true);

        const uploaded = await uploadBmpStream(
            input.email,
            input.token,
            chunkFileName(
                input.file.name,
                input.file.fileHash,
                input.header.chunkIndex,
                input.chunkCount
            ),
            source,
            fetcher ?? photosFetchWithProgress((sent) => report(sent)),
            input.signal
        );
        if (uploaded.isErr()) return uploaded.map(() => undefined);

        uploaded.inspect((result) => {
            const reused = result.status === UploadStatus.AlreadyExists ? input.bmp.totalSize : 0;
            report(input.bmp.totalSize - reused, reused, true);
            emit({
                type: UploadEventType.Chunk,
                id: 0,
                chunk: {
                    fileHash: input.header.fileHash,
                    fileId: input.header.fileId,
                    chunkIndex: input.header.chunkIndex,
                    isLast: input.header.flags === 1,
                    originalName: input.header.fileName,
                    size: input.header.payloadSize,
                    at: Date.now(),
                    mediaKey: result.mediaKey,
                    sha1: result.sha1
                }
            });
            emit({ type: UploadEventType.FileComplete, id: 0, result });
        });

        return Ok(undefined);
    });
}
