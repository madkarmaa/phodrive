import { UploadEventType, UploadEventSchema, type UploadEvent } from '$lib/models';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { EventSourceMessage } from 'eventsource-parser';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { schemaResult } from '$lib/schema-result';
import { request } from '$browser/api';

const UPLOAD_STREAM_ERROR = 'Upload connection ended before Google confirmed every file.';
const MAX_EVENT_CHARACTERS = 16 * 1024;

function parseEvent(data: string): Result<UploadEvent, Error> {
    let value: unknown;
    try {
        value = JSON.parse(data);
    } catch {
        return Err(new Error('Invalid upload progress response.'));
    }

    return schemaResult(UploadEventSchema, value, 'Invalid upload progress response.');
}

function readEvent(
    reader: ReadableStreamDefaultReader<EventSourceMessage>
): AsyncResult<UploadEvent, Error> {
    return Ok(undefined).andThenAsync(async () => {
        let next: Awaited<ReturnType<typeof reader.read>>;
        try {
            next = await reader.read();
        } catch {
            return Err(new Error(UPLOAD_STREAM_ERROR));
        }
        if (next.done) return Err(new Error(UPLOAD_STREAM_ERROR));

        return parseEvent(next.value.data);
    });
}

function readUploadResponse(
    response: Response,
    onEvent: (event: UploadEvent) => Result<void, Error>
): AsyncResult<void, Error> {
    return Ok(undefined).andThenAsync(async () => {
        if (
            !response.body ||
            !response.headers.get('content-type')?.startsWith('text/event-stream')
        )
            return Err(new Error('Invalid upload progress response.'));

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
                    if (event.type === UploadEventType.Error) return Err(new Error(event.error));

                    return onEvent(event).map(() => event.type === UploadEventType.Complete);
                });
                const terminal = handled.match<Result<void, Error> | null>({
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
    onEvent: (event: UploadEvent) => Result<void, Error>
): AsyncResult<void, Error> {
    return request('/api/upload', { method: 'POST', body: form }, 'Upload failed').andThenAsync(
        (response) => readUploadResponse(response, onEvent)
    );
}
