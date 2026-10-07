import { UploadEventType, UploadPhase, type UploadEvent } from '#lib/models';
import { afterEach, expect, vi, test } from 'vitest';
import { Ok } from 'results-ts';
import { uploadRequest } from '#browser/upload/request';

const encoder = new TextEncoder();
afterEach(() => vi.restoreAllMocks());

function frame(event: UploadEvent): Uint8Array<ArrayBuffer> {
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function serve(body: BodyInit) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    );
}

test('fragmented progress arrives while the selection remains unconfirmed', async () => {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const progress: number[] = [];
    let confirmed = false;
    serve(stream.readable);

    const uploading = uploadRequest(new FormData(), (event) => {
        if (
            event.type === UploadEventType.Progress &&
            event.progress.phase === UploadPhase.Uploading
        )
            progress.push(event.progress.completed);
        return Ok(undefined);
    }).map(() => {
        confirmed = true;
    });
    const pending = Promise.resolve(uploading);
    const partial = frame({
        type: UploadEventType.Progress,
        id: 0,
        progress: { phase: UploadPhase.Uploading, completed: 25, total: 100, reused: 0 }
    });
    await writer.write(partial.slice(0, 7));
    await writer.write(partial.slice(7));
    await vi.waitFor(() => expect(progress).toEqual([25]));
    expect(confirmed).toBe(false);

    await writer.write(
        frame({
            type: UploadEventType.Progress,
            id: 0,
            progress: { phase: UploadPhase.Uploading, completed: 100, total: 100, reused: 0 }
        })
    );
    await vi.waitFor(() => expect(progress).toEqual([25, 100]));
    expect(confirmed).toBe(false);

    await writer.write(frame({ type: UploadEventType.Complete }));
    const result = await pending;
    expect(result.isOk()).toBe(true);
    expect(confirmed).toBe(true);
});

test('upload streams reject malformed, oversized, and truncated events', async () => {
    const invalidBodies: BodyInit[] = [
        'data: invalid-json\n\n',
        'data: {"type":"progress","id":0,"progress":{"phase":"uploading","completed":101,"total":100,"reused":0}}\n\n',
        'data: {"type":"progress","sent":1,"total":100}\n\n',
        `data: ${'x'.repeat(20_000)}\n\n`,
        frame({
            type: UploadEventType.Progress,
            id: 0,
            progress: { phase: UploadPhase.Uploading, completed: 100, total: 100, reused: 0 }
        })
    ];

    for (const body of invalidBodies) {
        serve(body);
        const result = await uploadRequest(new FormData(), () => Ok(undefined));
        expect(result.isErr()).toBe(true);
    }
});

test('server errors preserve their safe message', async () => {
    serve(frame({ type: UploadEventType.Error, error: 'Upload transfer failed (HTTP 429)' }));
    const failed = await uploadRequest(new FormData(), () => Ok(undefined));
    expect(failed.unwrapErr()).toEqual({
        code: 'UPLOAD_FAILED',
        message: 'Upload transfer failed (HTTP 429)'
    });
});

test('upload event decoding preserves split UTF8, BOM and CRLF across byte boundaries', async () => {
    const error = 'Photos failed: 📷 café';
    const bytes = encoder.encode(
        `\uFEFFdata: ${JSON.stringify({ type: UploadEventType.Error, error })}\r\n\r\n`
    );
    let offset = 0;
    let cancelled = false;
    serve(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset));
            },
            cancel() {
                cancelled = true;
            }
        })
    );
    const failed = await uploadRequest(new FormData(), () => Ok(undefined));
    expect(failed.unwrapErr()).toEqual({ code: 'UPLOAD_FAILED', message: error });
    await vi.waitFor(() => expect(cancelled).toBe(true));
});
