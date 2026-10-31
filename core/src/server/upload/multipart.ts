import { Busboy, type BusboyFileStream } from '@fastify/busboy';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';

const MAX_UPLOAD_FIELD_BYTES = 64 * 1024;
const MAX_UPLOAD_HEADER_BYTES = 16 * 1024;

/** A JSON `metadata` field followed by one live file part, read with backpressure. */
export interface ReceivedMultipartFile<T> {
    metadata: T;
    payload: ReadableStream<Uint8Array>;
    finished: () => AsyncResult<void, ServerError>;
    cancel: () => AsyncResult<void, ServerError>;
    signal: AbortSignal;
}

export interface MultipartFileOptions<T> {
    /** Form field name of the file part. */
    fileField: string;
    /** Larger file parts fail with FILE_TOO_LARGE. */
    maxFileBytes: number;
    parseMetadata: (value: unknown) => Result<T, ServerError>;
}

function parseJson<T>(
    text: string,
    parse: (value: unknown) => Result<T, ServerError>
): Result<T, ServerError> {
    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch {
        return Err(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);
    }

    return parse(value);
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

/** Read just the metadata field, then expose the live multipart file with backpressure. */
export function receiveMultipartFile<T>(
    request: Request,
    { fileField, maxFileBytes, parseMetadata }: MultipartFileOptions<T>
): AsyncResult<ReceivedMultipartFile<T>, ServerError> {
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
                    fileSize: maxFileBytes
                }
            });
            source = Readable.from(requestBytes(request.body), {
                objectMode: false,
                highWaterMark: 64 * 1024
            });
        } catch {
            return Err(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);
        }

        let metadata: T | null = null;
        let active: BusboyFileStream | null = null;
        let failure: ServerError | null = null;
        let receivedFile = false;
        let settle: (result: Result<ReceivedMultipartFile<T>, ServerError>) => void = () => {};
        const ready = new Promise<Result<ReceivedMultipartFile<T>, ServerError>>((resolve) => {
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

            parseJson(value, parseMetadata).match({
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
            if (key !== fileField || !metadata || receivedFile || failure) {
                stream.resume();
                fail(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);

                return;
            }

            receivedFile = true;
            active = stream;
            stream.on('error', () => fail(SERVER_ERRORS.FILE_RECEIVE_FAILED));
            stream.on('limit', () => fail(SERVER_ERRORS.FILE_TOO_LARGE));

            settle(
                Ok({
                    metadata,
                    payload: payloadStream(stream),
                    signal: request.signal,
                    finished: () => Ok(undefined).and(completed),
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
