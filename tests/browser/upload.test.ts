import { afterEach, expect, vi, test } from 'vitest';
import { uploadRequest } from '$browser/upload';
import type { UploadEvent } from '$lib/models';

const COMPLETE: UploadEvent = {
    type: 'complete',
    result: { status: 'uploaded', mediaKey: 'test-media', sha1: '0'.repeat(40) }
};
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

test('progress arrives before commit and fragmented SSE frames are parsed incrementally', async () => {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const progress: number[] = [];
    let confirmed = false;
    serve(stream.readable);

    const uploading = uploadRequest(new FormData(), 100, (sent) => progress.push(sent)).map(
        (result) => {
            confirmed = true;
            return result;
        }
    );
    // Keep the operation pending while the response stream remains open.
    const pending = Promise.resolve(uploading);
    const partial = frame({ type: 'progress', sent: 25, total: 100 });
    await writer.write(partial.slice(0, 7));
    await writer.write(partial.slice(7));
    await vi.waitFor(() => expect(progress).toEqual([25]));
    expect(confirmed).toBe(false);

    await writer.write(frame({ type: 'progress', sent: 100, total: 100 }));
    await vi.waitFor(() => expect(progress).toEqual([25, 100]));
    expect(confirmed).toBe(false);

    await writer.write(frame(COMPLETE));
    const result = await pending;
    expect(result.unwrap().status).toBe('uploaded');
    expect(confirmed).toBe(true);
});

test('upload streams reject malformed, regressing, truncated, and mismatched progress', async () => {
    const invalidBodies: BodyInit[] = [
        'data: invalid-json\n\n',
        'data: {"type":"progress","sent":101,"total":100}\n\n',
        frame({ type: 'progress', sent: 1, total: 99 }),
        new Blob([
            frame({ type: 'progress', sent: 50, total: 100 }),
            frame({ type: 'progress', sent: 25, total: 100 })
        ]),
        frame({ type: 'progress', sent: 100, total: 100 }),
        frame(COMPLETE)
    ];

    for (const body of invalidBodies) {
        serve(body);
        const result = await uploadRequest(new FormData(), 100, () => {});
        expect(result.isErr()).toBe(true);
    }
});

test('a streamed Google failure retains its safe error, and duplicate reuse sends no fictitious bytes', async () => {
    serve(frame({ type: 'error', error: 'Upload transfer failed (HTTP 429)' }));
    const failed = await uploadRequest(new FormData(), 100, () => {});
    expect(failed.unwrapErr().message).toContain('429');

    const sent: number[] = [];
    serve(
        frame({
            type: 'complete',
            result: { status: 'already exists', mediaKey: 'test-media', sha1: '0'.repeat(40) }
        })
    );
    const duplicate = await uploadRequest(new FormData(), 100, (bytes) => sent.push(bytes));
    expect(duplicate.unwrap().status).toBe('already exists');
    expect(sent).toEqual([]);
});
