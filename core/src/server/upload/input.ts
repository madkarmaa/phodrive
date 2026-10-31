import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    ChunkFormat,
    UploadChunkSchema,
    UploadRequestSchema,
    type Account,
    type ChunkUploadRequest,
    type SplitHeader
} from '../../models';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES, MAX_PHOTOS_BMP_BYTES } from '../../bmp/format';
import { chunkCount, chunkHeader } from '../../upload';
import { schemaResult } from '../../validation';
import { fileIdentity } from '../chunks';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { receiveMultipartFile } from './multipart';

export interface ReceivedUpload extends ChunkUploadRequest {
    /** Payload uploads are encoded here; BMP uploads are relayed to Google as they arrive. */
    format: ChunkFormat;
    header: SplitHeader;
    chunkCount: number;
    bmp: { prefix: Uint8Array<ArrayBuffer>; totalSize: number; paddingSize: number };
    payload: ReadableStream<Uint8Array>;
    finished: () => AsyncResult<void, ServerError>;
    cancel: () => AsyncResult<void, ServerError>;
    signal: AbortSignal;
}

function chunkMetadata(input: ChunkUploadRequest) {
    const count = chunkCount(input.file.size);
    if (input.chunkIndex >= count) return Err(SERVER_ERRORS.INVALID_CHUNK_METADATA);

    const header = chunkHeader(
        input.file,
        fileIdentity(input.file.name, input.file.fileHash),
        input.chunkIndex
    );

    return encodeSplitPrefix(header).map((bmp) => ({ header, bmp, chunkCount: count }));
}

/** Accept a chunk from the same process, such as a local file slice, without multipart parsing. */
export function receiveChunk(
    metadata: ChunkUploadRequest,
    payload: ReadableStream<Uint8Array>,
    signal: AbortSignal
): Result<ReceivedUpload, ServerError> {
    return schemaResult(UploadRequestSchema, metadata, 'Invalid upload request.')
        .mapErr(() => SERVER_ERRORS.INVALID_UPLOAD_REQUEST)
        .andThen((input) =>
            chunkMetadata(input).map((chunk) => ({
                ...input,
                ...chunk,
                format: ChunkFormat.Payload,
                payload,
                signal,
                finished: () => Ok(undefined).andThenAsync(async () => Ok(undefined)),
                cancel: () =>
                    Ok(undefined).andThenAsync(async () => {
                        if (!payload.locked) await payload.cancel().catch(() => {});

                        return Ok(undefined);
                    })
            }))
        );
}

/**
 * Read a chunk's metadata, then expose its live multipart file with backpressure. Browsers send
 * only chunk metadata; the account comes from the server's own session.
 */
export function receiveUpload(
    request: Request,
    account: Account,
    format: ChunkFormat = ChunkFormat.Payload
): AsyncResult<ReceivedUpload, ServerError> {
    const maxBytes = format === ChunkFormat.Bmp ? MAX_PHOTOS_BMP_BYTES : MAX_CHUNK_PAYLOAD_BYTES;

    return receiveMultipartFile(request, {
        fileField: 'chunk',
        maxFileBytes: maxBytes + 1,
        parseMetadata: (value) =>
            schemaResult(UploadChunkSchema, value, 'Invalid upload request.')
                .map((chunk): ChunkUploadRequest => ({ ...account, ...chunk }))
                .mapErr(() => SERVER_ERRORS.INVALID_UPLOAD_REQUEST)
    }).andThenAsync(async (received): Promise<Result<ReceivedUpload, ServerError>> => {
        const chunk = chunkMetadata(received.metadata);

        if (chunk.isErr()) {
            await received.cancel();

            return chunk;
        }

        return chunk.map((metadata) => ({
            ...received.metadata,
            ...metadata,
            format,
            payload: received.payload,
            signal: received.signal,
            finished: received.finished,
            cancel: received.cancel
        }));
    });
}
