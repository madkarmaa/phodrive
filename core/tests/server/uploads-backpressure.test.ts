import { afterEach, expect, test, vi } from 'vitest';
import { UploadEventType, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { createHash } from 'node:crypto';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { uploadForm, TEST_ACCOUNT } from '../helpers/upload';

afterEach(() => vi.restoreAllMocks());

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
    const received = await receiveUpload(request, TEST_ACCOUNT);
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

test('paused downstream progress is coalesced rather than retaining every event', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
    const input = received.unwrap();
    const uploads = await import('@madkarmaa/phodrive-core/server/upload');
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
