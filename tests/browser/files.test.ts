import { FileRequestSchema, UploadJobStatus, UploadEventType, type RemoteBmp } from '$lib/models';
import { afterEach, expect, vi, test } from 'vitest';
import { createHash } from 'node:crypto';
import { groupChunks, type UploadedChunk } from '$lib/files';
import {
    downloadFile,
    uploadFiles,
    deleteFile,
    saveDownloadedFile,
    type UploadJob
} from '$browser/files';
import { HASH_BLOCK_BYTES, hashFile } from '$browser/upload/hash';
import { browserUploadResponse } from '../helpers/upload';

const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);
const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');
afterEach(() => vi.restoreAllMocks());
function chunk(name = 'proof.bin'): RemoteBmp {
    return {
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: PAYLOAD.length,
        at: 1,
        mediaKey: name,
        sha1: '0'.repeat(40)
    };
}

test('browser hashes incrementally and posts raw slices with stable verified BMP checksums', async () => {
    const files = [new File([PAYLOAD], 'proof.bin'), new File([PAYLOAD], 'other.bin')];
    const reads = files.map((file) => vi.spyOn(file, 'arrayBuffer'));
    const saved: UploadedChunk[] = [];
    const jobs = new Map<number, UploadJob>();
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => browserUploadResponse(init));
    const uploaded = await uploadFiles(
        files,
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.set(job.id, job),
        (chunk) => saved.push(chunk)
    );
    expect(uploaded.isOk()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reads.every((read) => read.mock.calls.length === 0)).toBe(true);
    expect(saved.map((chunk) => chunk.originalName).sort()).toEqual(['other.bin', 'proof.bin']);
    expect(new Set(saved.map((chunk) => chunk.fileId)).size).toBe(2);
    expect([...jobs.values()].every((job) => job.status === UploadJobStatus.Complete)).toBe(true);
});

test('full-file hashing reads at most 1 MiB at once and retries reuse the immutable file hash', async () => {
    const file = new File([Buffer.alloc(3_000_000, 42)], 'bounded.bin');
    const full = vi
        .spyOn(file, 'arrayBuffer')
        .mockRejectedValue(new Error('whole file allocation prohibited'));
    const slices = vi.spyOn(file, 'slice');
    const first = await hashFile(file, () => {});
    expect(first.unwrap()).toBe(
        createHash('sha256').update(Buffer.alloc(3_000_000, 42)).digest('hex')
    );
    expect(slices).toHaveBeenCalledTimes(3);
    expect(slices.mock.calls.every(([start, end]) => end! - start! <= HASH_BLOCK_BYTES)).toBe(true);
    const second = await hashFile(file, () => {});
    expect(second.unwrap()).toBe(first.unwrap());
    expect(slices).toHaveBeenCalledTimes(3);
    expect(full).not.toHaveBeenCalled();
});

test('global transfer pool respects workers and mixed failures preserve other files', async () => {
    let active = 0;
    let peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        if (init?.body instanceof FormData && String(init.body.get('metadata')).includes('bad.bin'))
            return new Response(JSON.stringify({ error: 'synthetic failure' }), { status: 503 });
        return browserUploadResponse(init);
    });
    const files = ['a.bin', 'bad.bin', 'c.bin', 'd.bin'].map((name) => new File([PAYLOAD], name));
    const jobs = new Map<number, UploadJob>();
    const result = await uploadFiles(
        files,
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.set(job.id, job),
        () => {}
    );
    expect(result.isOk()).toBe(true);
    expect(peak).toBe(2);
    expect(jobs.get(1)).toMatchObject({
        status: UploadJobStatus.Error,
        message: 'synthetic failure'
    });
    expect(
        [...jobs.values()].filter((job) => job.status === UploadJobStatus.Complete)
    ).toHaveLength(3);
});

test.each(['sha1', 'index', 'name', 'missing'] as const)(
    'invalid %s chunk confirmation cannot complete a browser job',
    async (damage) => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
            browserUploadResponse(init, false, (events) => {
                if (damage === 'missing')
                    return events.filter((event) => event.type !== UploadEventType.Chunk);
                return events.map((event) =>
                    event.type === UploadEventType.Chunk
                        ? {
                              ...event,
                              chunk: {
                                  ...event.chunk,
                                  ...(damage === 'sha1'
                                      ? { sha1: 'a'.repeat(40) }
                                      : damage === 'index'
                                        ? { chunkIndex: 2 }
                                        : { originalName: 'wrong.bin' })
                              }
                          }
                        : event
                );
            })
        );
        const jobs: UploadJob[] = [];
        const saved: UploadedChunk[] = [];
        await uploadFiles(
            [new File([PAYLOAD], 'proof.bin')],
            'test@example.com',
            'aas_et/test',
            1,
            (job) => jobs.push(job),
            (chunk) => saved.push(chunk)
        );
        expect(jobs.at(-1)?.status).toBe(UploadJobStatus.Error);
        expect(saved).toHaveLength(0);
    }
);

test('selection validates names and worker count, preserving empty files', async () => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => browserUploadResponse(init, true));
    const jobs = new Map<number, UploadJob>();
    const uploaded = await uploadFiles(
        [new File([], 'bad/path'), new File([], 'empty.bin')],
        'test@example.com',
        'aas_et/test',
        1,
        (job) => jobs.set(job.id, job),
        () => {}
    );
    expect(uploaded.isOk()).toBe(true);
    expect(jobs.get(0)?.status).toBe(UploadJobStatus.Error);
    expect(jobs.get(1)?.status).toBe(UploadJobStatus.Complete);
    expect(fetch).toHaveBeenCalledOnce();
    const invalid = await uploadFiles(
        [new File([], 'proof.bin')],
        'test@example.com',
        'aas_et/test',
        0,
        () => {},
        () => {}
    );
    expect(invalid.isErr()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
});

test('download asks for one reconstructed file and preserves its original bytes', async () => {
    const group = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON');
        const request = FileRequestSchema.parse(JSON.parse(init.body));
        expect(request.action).toBe('download');
        expect(request.chunks).toHaveLength(1);
        return new Response(PAYLOAD);
    });
    const downloaded = await downloadFile(group, 'aas_et/test');
    const recovered = await downloaded.unwrap().arrayBuffer();
    expect(new Uint8Array(recovered)).toEqual(PAYLOAD);
    const incomplete = await downloadFile({ ...group, complete: false }, 'aas_et/test');
    expect(incomplete.isErr()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('batch deletion reports confirmed chunks even when the server returns partial failure', async () => {
    const group = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const removed: UploadedChunk[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON');
        const request = FileRequestSchema.parse(JSON.parse(init.body));
        expect(request.action).toBe('delete');
        expect(request.workers).toBe(2);
        return Response.json({ deleted: [chunk()], error: 'One chunk failed' });
    });
    const result = await deleteFile(group, 'aas_et/test', (item) => removed.push(item), 2);
    expect(result.unwrapErr().message).toBe('One chunk failed');
    expect(removed).toEqual(group.chunks);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('an interrupted download body returns a receive error instead of a partial Blob', async () => {
    const group = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
            new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(Uint8Array.of(1, 2, 3));
                        controller.error(new Error('synthetic late integrity failure'));
                    }
                })
            )
    );

    const downloaded = await downloadFile(group, 'aas_et/test');
    expect(downloaded.unwrapErr()).toEqual({
        code: 'DOWNLOAD_RECEIVE_FAILED',
        message: 'Could not receive the downloaded file.'
    });
});

test('a failed browser click still releases the downloaded blob URL', () => {
    vi.useFakeTimers();
    const url = 'blob:download-cleanup';
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(url);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', {
        createElement: () => ({
            click: () => {
                throw new Error('browser rejected download');
            }
        })
    });

    try {
        const saved = saveDownloadedFile(new Blob(['payload']), 'original.bin');

        expect(saved.unwrapErr().code).toBe('DOWNLOAD_SAVE_FAILED');
        vi.runAllTimers();
        expect(revoke).toHaveBeenCalledWith(url);
    } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    }
});
