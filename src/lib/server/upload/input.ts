import Busboy, { type BusboyFileStream } from '@fastify/busboy';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadRequestSchema, type ChunkUploadRequest, type SplitHeader } from '$lib/models';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES } from '$lib/bmp/format';
import { chunkCount, chunkHeader } from '$lib/upload';
import { schemaResult } from '$lib/validation';
import { fileIdentity } from '$server/chunks';
import { SERVER_ERRORS, type ServerError } from '$server/errors';

const MAX_UPLOAD_FIELD_BYTES = 64 * 1024;
const MAX_UPLOAD_HEADER_BYTES = 16 * 1024;

export interface ReceivedUpload extends ChunkUploadRequest {
    header: SplitHeader;
    chunkCount: number;
    bmp: { prefix: Uint8Array<ArrayBuffer>; totalSize: number; paddingSize: number };
    payload: ReadableStream<Uint8Array>;
    finished: () => AsyncResult<void, ServerError>;
    cancel: () => AsyncResult<void, ServerError>;
    signal: AbortSignal;
}

function parseMetadata(text: string): Result<ChunkUploadRequest, ServerError> {
    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch {
        return Err(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);
    }

    return schemaResult(UploadRequestSchema, value, 'Invalid upload request.').mapErr(
        () => SERVER_ERRORS.INVALID_UPLOAD_REQUEST
    );
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

function payloadStream(stream: BusboyFileStream): ReadableStream<Uint8Array> {
    const iterator = stream[Symbol.asyncIterator]();

    return new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                let next: IteratorResult<unknown>;

                try {
                    next = await iterator.next();
                } catch {
                    controller.error(SERVER_ERRORS.FILE_RECEIVE_FAILED);

                    return;
                }
                if (next.done) {
                    controller.close();

                    return;
                }
                if (!(next.value instanceof Uint8Array)) {
                    controller.error(SERVER_ERRORS.FILE_RECEIVE_FAILED);

                    return;
                }

                controller.enqueue(next.value);
            },
            cancel() {
                stream.destroy();
            }
        },
        { highWaterMark: 0 }
    );
}

async function* requestBytes(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();

    try {
        while (true) {
            const next = await reader.read();
            if (next.done) return;

            yield next.value;
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** Read just the manifest, then expose the live multipart file with backpressure. */
export function receiveUpload(request: Request): AsyncResult<ReceivedUpload, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const contentType = request.headers.get('content-type');
        if (!request.body || !contentType?.startsWith('multipart/form-data'))
            return Err(SERVER_ERRORS.UPLOAD_INPUT_REQUIRED);

        let parser: InstanceType<typeof Busboy>;
        let source: Readable;

        try {
            parser = new Busboy({
                headers: { 'content-type': contentType },
                preservePath: true,
                limits: {
                    fields: 1,
                    files: 1,
                    parts: 2,
                    fieldSize: MAX_UPLOAD_FIELD_BYTES,
                    headerSize: MAX_UPLOAD_HEADER_BYTES,
                    fileSize: MAX_CHUNK_PAYLOAD_BYTES + 1
                }
            });
            source = Readable.from(requestBytes(request.body), {
                objectMode: false,
                highWaterMark: 64 * 1024
            });
        } catch {
            return Err(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);
        }

        let metadata: ChunkUploadRequest | null = null;
        let active: BusboyFileStream | null = null;
        let failure: ServerError | null = null;
        let receivedFile = false;
        let settle: (result: Result<ReceivedUpload, ServerError>) => void = () => {};
        const ready = new Promise<Result<ReceivedUpload, ServerError>>((resolve) => {
            settle = resolve;
        });
        const fail = (error: ServerError) => {
            failure ??= error;
            settle(Err(failure));
            active?.destroy();
            source.destroy();
            parser.destroy();
        };
        const onAbort = () => fail(SERVER_ERRORS.FILE_RECEIVE_FAILED);
        request.signal.addEventListener('abort', onAbort, { once: true });
        parser.on('field', (key, value, nameTruncated, valueTruncated) => {
            if (key !== 'metadata' || metadata || receivedFile || nameTruncated || valueTruncated) {
                fail(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);

                return;
            }

            parseMetadata(value).match({
                Ok: (input) => {
                    metadata = input;
                },
                Err: fail
            });
        });
        parser.on('fieldsLimit', () => fail(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));
        parser.on('filesLimit', () => fail(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));
        parser.on('partsLimit', () => fail(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));
        parser.on('file', (key, stream) => {
            if (key !== 'chunk' || !metadata || receivedFile || failure) {
                stream.resume();
                fail(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);

                return;
            }

            receivedFile = true;
            active = stream;
            stream.on('error', () => fail(SERVER_ERRORS.FILE_RECEIVE_FAILED));
            stream.on('limit', () => fail(SERVER_ERRORS.FILE_TOO_LARGE));

            const input = metadata;
            chunkMetadata(input).match({
                Err: fail,
                Ok: (chunk) => {
                    const payload = payloadStream(stream);
                    settle(
                        Ok({
                            ...input,
                            ...chunk,
                            payload,
                            signal: request.signal,
                            finished: () => Ok(undefined).andThenAsync(async () => await completed),
                            cancel: () =>
                                Ok(undefined).andThenAsync(async () => {
                                    active?.destroy();
                                    source.destroy();
                                    parser.destroy();
                                    await completed;

                                    return Ok(undefined);
                                })
                        })
                    );
                }
            });
        });

        const completed = pipeline(source, parser)
            .then((): Result<void, ServerError> =>
                failure
                    ? Err(failure)
                    : receivedFile
                      ? Ok(undefined)
                      : Err(SERVER_ERRORS.FILES_REQUIRED)
            )
            .catch((): Result<void, ServerError> =>
                Err(failure ?? SERVER_ERRORS.FILE_RECEIVE_FAILED)
            )
            .then((result) => {
                request.signal.removeEventListener('abort', onAbort);
                result.inspectErr((error) => settle(Err(error)));
                if (!receivedFile) settle(Err(SERVER_ERRORS.FILES_REQUIRED));

                return result;
            });
        if (request.signal.aborted) onAbort();

        return await ready;
    });
}
