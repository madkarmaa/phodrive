import { afterEach, expect, test, vi } from 'vitest';
import { UploadEventType, type UploadEvent } from '@madkarmaa/phodrive-core/models';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { uploadFiles } from '@madkarmaa/phodrive-core/server/upload';
import { decodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { uploadForm, photosUploadHarness, TEST_ACCOUNT } from '../helpers/upload';
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
    const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
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

test.each(['hash', 'short', 'long'] as const)(
    'invalid %s is never committed to Google',
    async (damage) => {
        const fixture = uploadForm();
        if (damage === 'hash') fixture.metadata.sha1 = 'a'.repeat(40);
        fixture.form.set('metadata', JSON.stringify(fixture.metadata));
        if (damage === 'short')
            fixture.form.set('chunk', new Blob([Uint8Array.of(1)]), 'chunk.bin');
        if (damage === 'long') fixture.form.set('chunk', new Blob([Buffer.alloc(6)]), 'chunk.bin');
        const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
        const harness = photosUploadHarness();
        const uploaded = await uploadFiles(received.unwrap(), () => {}, harness.fetcher);
        expect(uploaded.isErr()).toBe(true);
        expect(harness.counts.commits).toBe(0);
        await received.unwrap().cancel();
    }
);

test('request cancellation closes unfinished multipart ingress and produces no confirmation', async () => {
    const fixture = uploadForm(Buffer.alloc(1_000_000));
    const abort = new AbortController();
    const request = new Request('http://localhost/api/upload', {
        method: 'POST',
        body: fixture.form,
        signal: abort.signal
    });
    const received = await receiveUpload(request, TEST_ACCOUNT);
    const source = encodeUploadBmp(received.unwrap());
    const reader = source.body.getReader();
    await reader.read();
    abort.abort();
    await expect(reader.read()).rejects.toBeDefined();
    const verified = await source.verified;
    expect(verified.isErr()).toBe(true);
    await received.unwrap().cancel();
});
