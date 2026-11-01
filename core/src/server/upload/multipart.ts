import type { BusboyFileStream } from '@fastify/busboy';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { openParser, payloadStream, type Parser } from './multipart-streams';

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

/** Read just the metadata field, then expose the live multipart file with backpressure. */
export function receiveMultipartFile<T>(
    request: Request,
    options: MultipartFileOptions<T>
): AsyncResult<ReceivedMultipartFile<T>, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const body = request.body;
        const contentType = request.headers.get('content-type');
        if (!body || !contentType?.startsWith('multipart/form-data'))
            return Err(SERVER_ERRORS.UPLOAD_INPUT_REQUIRED);

        return await openParser(body, contentType, options.maxFileBytes).andThenAsync(
            ({ parser, source }) => readParts(request, parser, source, options)
        );
    });
}

/** Resolves once the file part starts, or with the first failure before it. */
function readParts<T>(
    request: Request,
    parser: Parser,
    source: Readable,
    { fileField, parseMetadata }: MultipartFileOptions<T>
): AsyncResult<ReceivedMultipartFile<T>, ServerError> {
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
        .catch((): Result<void, ServerError> => Err(failure ?? SERVER_ERRORS.FILE_RECEIVE_FAILED))
        .then((result) => {
            request.signal.removeEventListener('abort', onAbort);
            result.inspectErr((error) => settle(Err(error)));
            if (!receivedFile) settle(Err(SERVER_ERRORS.FILES_REQUIRED));

            return result;
        });
    if (request.signal.aborted) onAbort();

    return Ok(undefined).and(ready);
}
