import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { receiveUpload } from '#server/upload/input';
import { encodeUploadBmp } from '#server/upload/bmp';
import { uploadFiles, planUpload } from '#server/upload';
import { uploadStream } from '#server/upload/stream';
import { decodeSplitBmp, MAX_CHUNK_PAYLOAD_BYTES } from '#server/bmp';
import { UploadEventType, UploadStatus, UploadPhase, type UploadEvent } from '#lib/models';
import { uploadForm, photosUploadHarness } from '../helpers/upload';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, open: vi.fn(actual.open), mkdtemp: vi.fn(actual.mkdtemp) };
});

afterEach(() => vi.restoreAllMocks());

test('multipart ingestion and BMP transfer stream without allocating files on disk', async () => {
    const fixture = uploadForm();
    const open = vi.spyOn(fs, 'open').mockRejectedValue(new Error('ENOSPC'));
    const mkdtemp = vi.spyOn(fs, 'mkdtemp').mockRejectedValue(new Error('ENOSPC'));
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    const harness = photosUploadHarness();
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => events.push(event), harness.fetcher);
    expect(uploaded.isOk()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(harness.counts).toMatchObject({ transfers: 1, commits: 1 });
    const bmp = harness.stored.get(fixture.metadata.sha1)!;
    expect(decodeSplitBmp(bmp).unwrap().payload).toEqual(Buffer.from([0, 255, 13, 10, 42]));
    expect(events.some((event) => event.type === UploadEventType.Chunk)).toBe(true);
    await input.cancel();
});

test('encoder has bounded blocks and demand-driven ingress, independent of payload size', async () => {
    const original = Buffer.alloc(2_000_000, 42);
    const fixture = uploadForm(original);
    const serialized = fixture.request();
    const headers = new Headers(serialized.headers);
    const serializedBytes = await serialized.arrayBuffer();
    const wire = new Uint8Array(serializedBytes);
    let offset = 0;
    let readAhead = 0;
    const ingress = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (offset === wire.length) {
                    controller.close();
                    return;
                }
                const next = wire.subarray(offset, offset + 16 * 1024);
                offset += next.length;
                readAhead = offset;
                controller.enqueue(next);
            }
        },
        { highWaterMark: 0 }
    );
    const init = { method: 'POST', headers, body: ingress, duplex: 'half' as const };
    const request = new Request(serialized.url, init);
    const received = await receiveUpload(request);
    const input = received.unwrap();
    let blocks = 0;
    let bytes = 0;
    const encoded = encodeUploadBmp(input);
    const reader = encoded.body.getReader();
    const prefix = await reader.read();
    expect(prefix.value).toEqual(fixture.prefix.prefix);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pausedAt = readAhead;
    expect(pausedAt).toBeLessThan(256 * 1024);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readAhead).toBe(pausedAt);
    const hash = createHash('sha1').update(prefix.value!);
    while (true) {
        const next = await reader.read();
        if (next.done) break;
        expect(next.value.length).toBeLessThanOrEqual(64 * 1024);
        hash.update(next.value);
        bytes += next.value.length;
        blocks++;
    }
    expect(blocks).toBeGreaterThan(30);
    expect(bytes + prefix.value!.length).toBe(input.bmp.totalSize);
    expect(hash.digest('hex')).toBe(fixture.metadata.sha1);
    const verified = await encoded.verified;
    expect(verified.isOk()).toBe(true);
    await input.cancel();
});

test.each(['hash', 'short', 'long'] as const)(
    'invalid %s is never committed to Google',
    async (damage) => {
        const fixture = uploadForm();
        if (damage === 'hash') fixture.metadata.sha1 = 'a'.repeat(40);
        fixture.form.set('metadata', JSON.stringify(fixture.metadata));
        if (damage === 'short')
            fixture.form.set('chunk', new Blob([Uint8Array.of(1)]), 'chunk.bin');
        if (damage === 'long') fixture.form.set('chunk', new Blob([Buffer.alloc(6)]), 'chunk.bin');
        const received = await receiveUpload(fixture.request());
        const harness = photosUploadHarness();
        const uploaded = await uploadFiles(received.unwrap(), () => {}, harness.fetcher);
        expect(uploaded.isErr()).toBe(true);
        expect(harness.counts.commits).toBe(0);
        await received.unwrap().cancel();
    }
);

test('deduplication still validates the complete incoming split without a Google transfer', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request());
    const harness = photosUploadHarness({ duplicate: true });
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(
        received.unwrap(),
        (event) => events.push(event),
        harness.fetcher
    );
    expect(uploaded.isOk()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 0, commits: 0 });
    expect(events.find((event) => event.type === UploadEventType.FileComplete)).toMatchObject({
        result: { status: 'already exists' }
    });
    await received.unwrap().cancel();
});

test('uncertain commits can be resolved by a stable SHA-1 lookup on retry', async () => {
    const fixture = uploadForm();
    const harness = photosUploadHarness({ failCommit: true });
    const first = await receiveUpload(fixture.request());
    const failed = await uploadFiles(first.unwrap(), () => {}, harness.fetcher);
    expect(failed.unwrapErr().code).toBe('COMMIT_OUTCOME_UNCERTAIN');
    await first.unwrap().cancel();
    const second = await receiveUpload(fixture.request());
    const retried = await uploadFiles(second.unwrap(), () => {}, harness.fetcher);
    expect(retried.isOk()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 1, commits: 1 });
    await second.unwrap().cancel();
});

test('metadata-only preparation can describe a 500 GB source without opening or allocating that file', async () => {
    const size = 500_000_000_000;
    const plan = planUpload({ name: '500gb.bin', size, fileHash: 'a'.repeat(64) }).unwrap();
    expect(plan.headers).toHaveLength(Math.ceil(size / MAX_CHUNK_PAYLOAD_BYTES));
    expect(plan.headers.reduce((sum, header) => sum + header.payloadSize, 0)).toBe(size);
    expect(plan.headers.at(-1)?.flags).toBe(1);
    const fixture = uploadForm(new Uint8Array(), '500gb.bin', { fileSize: size });
    const received = await receiveUpload(fixture.request());
    expect(received.unwrap().header.payloadSize).toBe(MAX_CHUNK_PAYLOAD_BYTES);
    expect(received.unwrap().bmp.prefix.length).toBeLessThan(512);
    await received.unwrap().cancel();
});

test('paused downstream progress is coalesced rather than retaining every event', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    const uploads = await import('#server/upload');
    let finished = false;
    vi.spyOn(uploads, 'uploadFiles').mockImplementation((_input, emit) =>
        encodeUploadBmp(input)
            .drain()
            .map(() => {
                for (let completed = 0; completed <= 10_000; completed++) {
                    emit({
                        type: UploadEventType.Progress,
                        id: 0,
                        progress: {
                            phase: UploadPhase.Uploading,
                            completed,
                            reused: 0,
                            total: 10_000
                        }
                    });
                }
                emit({
                    type: UploadEventType.FileComplete,
                    id: 0,
                    result: {
                        status: UploadStatus.Uploaded,
                        mediaKey: 'key',
                        sha1: input.sha1
                    }
                });
                finished = true;
            })
    );
    const response = uploadStream(input);
    await vi.waitFor(() => expect(finished).toBe(true));
    const text = await response.text();
    expect(text.match(/data:/g)).toHaveLength(4);
    expect(text).toContain('"completed":10000');
    expect(text).toContain('file-complete');
    expect(text).toContain('"type":"complete"');
});

test('request cancellation closes unfinished multipart ingress and produces no confirmation', async () => {
    const fixture = uploadForm(Buffer.alloc(1_000_000));
    const abort = new AbortController();
    const request = new Request('http://localhost/api/upload', {
        method: 'POST',
        body: fixture.form,
        signal: abort.signal
    });
    const received = await receiveUpload(request);
    const source = encodeUploadBmp(received.unwrap());
    const reader = source.body.getReader();
    await reader.read();
    abort.abort();
    await expect(reader.read()).rejects.toBeDefined();
    const verified = await source.verified;
    expect(verified.isErr()).toBe(true);
    await received.unwrap().cancel();
});
