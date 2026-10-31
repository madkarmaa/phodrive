import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    ChunkFormat,
    FileNameSchema,
    FileSizeSchema,
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type UploadEvent,
    type UploadFile
} from '../../models';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { planChunks, type UploadPlan } from '../../upload';
import { chunkFileName, fileIdentity } from '../chunks';
import { photosFetchWithProgress, type Fetcher } from '../fetcher';
import { uploadBmpStream } from '../photos/index';
import { encodeUploadBmp, relayUploadBmp } from './bmp';
import type { ReceivedUpload } from './input';

const PROGRESS_INTERVAL_MS = 100;

export function planUpload(file: UploadFile): Result<UploadPlan, ServerError> {
    const valid =
        FileNameSchema.safeParse(file.name).success && FileSizeSchema.safeParse(file.size).success;
    if (!valid) return Err(SERVER_ERRORS.INVALID_FILE_NAME_OR_SIZE);

    return planChunks(file, fileIdentity(file.name, file.fileHash));
}

/** Encode and forward one incoming chunk without disk storage or a whole-chunk buffer. */
export function uploadFiles(
    input: ReceivedUpload,
    emit: (event: UploadEvent) => void,
    fetcher?: Fetcher
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const source =
            input.format === ChunkFormat.Bmp ? relayUploadBmp(input) : encodeUploadBmp(input);
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

        return uploaded.map((result) => {
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
    });
}
