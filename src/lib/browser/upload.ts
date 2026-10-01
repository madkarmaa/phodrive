import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { EventSourceMessage } from 'eventsource-parser';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadEventSchema, type UploadEvent, type UploadResponse } from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import { request } from '$browser/api';

const UPLOAD_STREAM_ERROR = 'Upload connection ended before Google confirmed the file.';
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

function validateEvent(
    event: UploadEvent,
    sent: number,
    total: number
): Result<UploadEvent, Error> {
    if (event.type === 'error') return Err(new Error(event.error));
    if (event.type === 'complete' && event.result.status === 'uploaded' && sent !== total)
        return Err(new Error('Invalid upload progress response.'));
    if (event.type === 'complete') return Ok(event);
    if (event.total !== total || event.sent < sent)
        return Err(new Error('Invalid upload progress response.'));

    return Ok(event);
}

function readUploadResponse(
    response: Response,
    total: number,
    onProgress: (sent: number) => void
): AsyncResult<UploadResponse, Error> {
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
        let sent = 0;

        try {
            while (true) {
                const received = await readEvent(reader);
                const validated = received.andThen((event) => validateEvent(event, sent, total));
                const terminal = validated.match<Result<UploadResponse, Error> | null>({
                    Ok: (event) => {
                        if (event.type === 'complete') return Ok(event.result);
                        if (event.type === 'error') return Err(new Error(event.error));

                        sent = event.sent;
                        onProgress(sent);
                        return null;
                    },
                    Err: (error) => Err(error)
                });

                if (terminal) return terminal;
            }
        } finally {
            // Releasing/cancelling the response reader does not retry or cancel a Google commit.
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    });
}

export function uploadRequest(
    form: FormData,
    total: number,
    onProgress: (sent: number) => void
): AsyncResult<UploadResponse, Error> {
    return request('/api/upload', { method: 'POST', body: form }, 'Upload failed').andThenAsync(
        (response) => readUploadResponse(response, total, onProgress)
    );
}
