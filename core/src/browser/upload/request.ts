import type { ApplicationError } from '../../errors';
import {
    UploadEventType,
    UploadEventSchema,
    type SplitHeader,
    type UploadChunk,
    type UploadEvent
} from '../../models';
import { encodeSplitPrefix } from '../../bmp/format';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { EventSourceMessage } from 'eventsource-parser';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { schemaResult } from '../../validation';
import { request } from '../api';

export const INVALID_UPLOAD_PROGRESS = {
    code: 'INVALID_UPLOAD_PROGRESS',
    message: 'Invalid upload progress response.'
} as const satisfies ApplicationError;

const UPLOAD_STREAM_INTERRUPTED = {
    code: 'UPLOAD_STREAM_INTERRUPTED',
    message: 'Upload connection ended before Google confirmed every file.'
} as const satisfies ApplicationError;
const MAX_EVENT_CHARACTERS = 16 * 1024;

/** One planned chunk: its metadata, its slice of the original file, and its split header. */
export interface TransportChunk {
    metadata: UploadChunk;
    payload: Blob;
    header: SplitHeader;
}

/**
 * Delivers one chunk and reports the server's upload events until completion or failure.
 * Transports supply the Google account themselves, so chunk metadata never carries credentials.
 */
export type ChunkTransport = (
    chunk: TransportChunk,
    onEvent: (event: UploadEvent) => Result<void, ApplicationError>
) => AsyncResult<void, ApplicationError>;

function parseEvent(data: string): Result<UploadEvent, ApplicationError> {
    let value: unknown;

    try {
        value = JSON.parse(data);
    } catch {
        return Err(INVALID_UPLOAD_PROGRESS);
    }

    return schemaResult(UploadEventSchema, value, INVALID_UPLOAD_PROGRESS.message).mapErr(
        () => INVALID_UPLOAD_PROGRESS
    );
}

function readEvent(
    reader: ReadableStreamDefaultReader<EventSourceMessage>
): AsyncResult<UploadEvent, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let next: Awaited<ReturnType<typeof reader.read>>;

        try {
            next = await reader.read();
        } catch {
            return Err(UPLOAD_STREAM_INTERRUPTED);
        }
        if (next.done) return Err(UPLOAD_STREAM_INTERRUPTED);

        return parseEvent(next.value.data);
    });
}

function readUploadResponse(
    response: Response,
    onEvent: (event: UploadEvent) => Result<void, ApplicationError>
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (
            !response.body ||
            !response.headers.get('content-type')?.startsWith('text/event-stream')
        )
            return Err(INVALID_UPLOAD_PROGRESS);

        const reader = response.body
            .pipeThrough(new TextDecoderStream())
            .pipeThrough(
                new EventSourceParserStream({
                    onError: 'terminate',
                    maxBufferSize: MAX_EVENT_CHARACTERS
                })
            )
            .getReader();

        try {
            while (true) {
                const received = await readEvent(reader);

                const handled = received.andThen((event) => {
                    if (event.type === UploadEventType.Error)
                        return Err({ code: 'UPLOAD_FAILED', message: event.error } as const);

                    return onEvent(event).map(() => event.type === UploadEventType.Complete);
                });
                const terminal = handled.match<Result<void, ApplicationError> | null>({
                    Ok: (complete) => (complete ? Ok(undefined) : null),
                    Err: (error) => Err(error)
                });
                if (terminal) return terminal;
            }
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    });
}

export function uploadRequest(
    form: FormData,
    onEvent: (event: UploadEvent) => Result<void, ApplicationError>
): AsyncResult<void, ApplicationError> {
    return request('/api/upload', { method: 'POST', body: form }, 'Upload failed').andThenAsync(
        (response) => readUploadResponse(response, onEvent)
    );
}

/** The finished BMP is assembled lazily from the file slice, so it is never copied in memory. */
function encodeChunk(payload: Blob, header: SplitHeader): Result<Blob, ApplicationError> {
    return encodeSplitPrefix(header).map(
        ({ prefix, paddingSize }) => new Blob([prefix, payload, new Uint8Array(paddingSize)])
    );
}

/** Send a finished BMP to the same-origin Phodrive API, which relays it to Google as it arrives. */
export const httpChunkTransport: ChunkTransport = ({ metadata, payload, header }, onEvent) =>
    encodeChunk(payload, header).andThenAsync((bmp) => {
        const form = new FormData();
        form.set('metadata', JSON.stringify(metadata));
        form.set('chunk', bmp, 'chunk.bmp');

        return uploadRequest(form, onEvent);
    });

/** Send a whole file for the server to hash, split, encode, and upload. */
export function uploadFileRequest(
    file: File,
    workers: number,
    onEvent: (event: UploadEvent) => Result<void, ApplicationError>
): AsyncResult<void, ApplicationError> {
    const form = new FormData();
    form.set('metadata', JSON.stringify({ name: file.name, size: file.size, workers }));
    form.set('file', file, file.name);

    return uploadRequest(form, onEvent);
}
