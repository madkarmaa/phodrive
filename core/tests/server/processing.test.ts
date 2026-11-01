import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { uploadFiles as uploadFromBrowser } from '@madkarmaa/phodrive-core/browser/upload';
import type { UploadJob } from '@madkarmaa/phodrive-core/browser/upload/jobs';
import {
    ChunkFormat,
    ProcessingMode,
    UploadEventType,
    UploadJobStatus,
    type UploadEvent
} from '@madkarmaa/phodrive-core/models';
import { decodeSplitBmp, encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { uploadFiles } from '@madkarmaa/phodrive-core/server/upload';
import { fileUploadStream, receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { TEST_ACCOUNT, uploadForm } from '../helpers/upload';
import { photosUploadHarness } from '../helpers/photos-harness';

afterEach(() => vi.restoreAllMocks());

const PAYLOAD = Buffer.from('a whole file the server splits and encodes itself');

function bmpRequest(bmp: Uint8Array) {
    const fixture = uploadForm(PAYLOAD);
    const form = new FormData();
    form.set('metadata', JSON.stringify(fixture.metadata));
    form.set('chunk', new Blob([Uint8Array.from(bmp)]), 'chunk.bmp');

    return {
        fixture,
        request: new Request('http://localhost/api/upload', { method: 'POST', body: form })
    };
}

function fileRequest(payload: Uint8Array, size = payload.length) {
    const form = new FormData();
    form.set('metadata', JSON.stringify({ name: 'whole.bin', size, workers: 2 }));
    form.set('file', new Blob([Uint8Array.from(payload)]), 'whole.bin');

    return new Request('http://localhost/api/upload', { method: 'POST', body: form });
}

function events(text: string): UploadEvent[] {
    return text
        .split('\n\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice('data: '.length)));
}

async function spoolDirectories() {
    const entries = await readdir(tmpdir());

    return entries.filter((entry) => entry.startsWith('phodrive-upload-')).length;
}

test('a browser-encoded BMP is relayed to Google byte for byte', async () => {
    const encoded = encodeSplitBmp(PAYLOAD, uploadForm(PAYLOAD).header).unwrap();
    const { request } = bmpRequest(encoded);
    const harness = photosUploadHarness();

    const received = await receiveUpload(request, TEST_ACCOUNT, ChunkFormat.Bmp);
    const input = received.unwrap();
    const emitted: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => emitted.push(event), harness.fetcher);
    await input.cancel();

    expect(uploaded.isOk()).toBe(true);
    const [stored] = [...harness.stored.values()];
    expect(Buffer.from(stored).equals(Buffer.from(encoded))).toBe(true);
    expect(emitted.some((event) => event.type === UploadEventType.FileComplete)).toBe(true);
});

test('a relayed BMP shorter than its metadata declares is never committed', async () => {
    const encoded = encodeSplitBmp(PAYLOAD, uploadForm(PAYLOAD).header).unwrap();
    const { request } = bmpRequest(encoded.subarray(0, encoded.length - 1));
    const harness = photosUploadHarness();

    const received = await receiveUpload(request, TEST_ACCOUNT, ChunkFormat.Bmp);
    const input = received.unwrap();
    const uploaded = await uploadFiles(input, () => {}, harness.fetcher);
    await input.cancel();

    expect(uploaded.isErr()).toBe(true);
    expect(harness.counts.commits).toBe(0);
});

test('the server spools a whole file, uploads its chunks, and removes the spool', async () => {
    const harness = photosUploadHarness();
    const before = await spoolDirectories();

    const received = await receiveFileUpload(fileRequest(PAYLOAD));
    const response = fileUploadStream(received.unwrap(), TEST_ACCOUNT, harness.fetcher);
    const reported = events(await response.text());

    const types = reported.map((event) => event.type);
    expect(types).toContain(UploadEventType.Chunk);
    expect(types).toContain(UploadEventType.FileComplete);
    expect(types.at(-1)).toBe(UploadEventType.Complete);
    expect(
        reported.some(
            (event) =>
                event.type === UploadEventType.Progress && event.progress.phase === 'receiving'
        )
    ).toBe(true);

    const [stored] = [...harness.stored.values()];
    expect(Buffer.from(decodeSplitBmp(stored).unwrap().payload).equals(PAYLOAD)).toBe(true);
    expect(await spoolDirectories()).toBe(before);
});

test('a whole file shorter than declared fails before anything is uploaded', async () => {
    const harness = photosUploadHarness();

    const received = await receiveFileUpload(fileRequest(PAYLOAD, PAYLOAD.length + 10));
    const response = fileUploadStream(received.unwrap(), TEST_ACCOUNT, harness.fetcher);
    const reported = events(await response.text());

    expect(reported.at(-1)).toMatchObject({ type: UploadEventType.Error });
    expect(harness.counts.transfers).toBe(0);
});

test('browsers in server mode send whole files and track the server-reported progress', async () => {
    const harness = photosUploadHarness();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const received = await receiveFileUpload(new Request(`http://localhost${url}`, init));

        return received.match({
            Ok: (file) => fileUploadStream(file, TEST_ACCOUNT, harness.fetcher),
            Err: (error) => Response.json({ error: error.message }, { status: 400 })
        });
    });
    const jobs = new Map<number, UploadJob>();
    const saved: UploadedChunk[] = [];

    const uploaded = await uploadFromBrowser(
        [new File([PAYLOAD], 'whole.bin')],
        'test@example.com',
        2,
        (job) => jobs.set(job.id, job),
        (chunk) => saved.push(chunk),
        ProcessingMode.Server
    );

    expect(uploaded.isOk()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(jobs.get(0)?.status).toBe(UploadJobStatus.Complete);
    expect(saved).toHaveLength(1);
    expect(saved[0].fileHash).toBe(createHash('sha256').update(PAYLOAD).digest('hex'));
});
