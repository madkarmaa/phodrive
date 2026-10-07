import type { ApplicationError } from '$lib/errors';
import { UploadEventType, UploadEventSchema, type UploadEvent } from '$lib/models';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { EventSourceMessage } from 'eventsource-parser';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { schemaResult } from '$lib/validation';
import { request } from '$browser/api';

const UPLOAD_STREAM_ERROR = 'Upload connection ended before Google confirmed every file.';
const MAX_EVENT_CHARACTERS = 16 * 1024;

function parseEvent(data: string): Result<UploadEvent, ApplicationError> {
    let value: unknown;

    try {
        value = JSON.parse(data);
    } catch {
        return Err({
            code: 'INVALID_UPLOAD_PROGRESS',
            message: 'Invalid upload progress response.'
        } as const);
    }

    return schemaResult(UploadEventSchema, value, 'Invalid upload progress response.');
}

function readEvent(
    reader: ReadableStreamDefaultReader<EventSourceMessage>
): AsyncResult<UploadEvent, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let next: Awaited<ReturnType<typeof reader.read>>;

        try {
            next = await reader.read();
        } catch {
            return Err({
                code: 'UPLOAD_STREAM_INTERRUPTED',
                message: UPLOAD_STREAM_ERROR
            } as const);
        }
        if (next.done)
            return Err({
                code: 'UPLOAD_STREAM_INTERRUPTED',
                message: UPLOAD_STREAM_ERROR
            } as const);

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
            return Err({
                code: 'INVALID_UPLOAD_PROGRESS',
                message: 'Invalid upload progress response.'
            } as const);

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
