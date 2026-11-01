import { UploadJobStatus, UploadEventType, ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { afterEach, expect, vi, test } from 'vitest';
import { createHash } from 'node:crypto';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { uploadFiles, type UploadJob } from '#browser/files';
import { HASH_BLOCK_BYTES, hashFile } from '@madkarmaa/phodrive-core/browser/upload/hash';
import { browserUploadResponse } from '../../../core/tests/helpers/upload';
import { PAYLOAD } from '../helpers/files';

/** Chunk confirmations that disagree with what the browser sent. */
const DAMAGED_CHUNKS = {
    sha1: { sha1: 'a'.repeat(40) },
    index: { chunkIndex: 2 },
    name: { originalName: 'wrong.bin' }
};

afterEach(() => vi.restoreAllMocks());

/** Upload in browser mode, keeping each job's latest state and every confirmed chunk. */
async function upload(files: File[], workers: number) {
    const jobs = new Map<number, UploadJob>();
    const saved: UploadedChunk[] = [];
    const result = await uploadFiles(
        files,
        'test@example.com',
        workers,
        (job) => jobs.set(job.id, job),
        (chunk) => saved.push(chunk),
        ProcessingMode.Browser
    );

    return { result, jobs, saved };
}

function statuses(jobs: Map<number, UploadJob>) {
    return [...jobs.values()].map((job) => job.status);
}

test('browser hashes incrementally and posts raw slices with stable verified BMP checksums', async () => {
    const files = [new File([PAYLOAD], 'proof.bin'), new File([PAYLOAD], 'other.bin')];
    const reads = files.map((file) => vi.spyOn(file, 'arrayBuffer'));
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => browserUploadResponse(init));

    const { result, jobs, saved } = await upload(files, 2);

    expect(result.isOk()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reads.every((read) => read.mock.calls.length === 0)).toBe(true);
    expect(saved.map((chunk) => chunk.originalName).sort()).toEqual(['other.bin', 'proof.bin']);
    expect(new Set(saved.map((chunk) => chunk.fileId)).size).toBe(2);
    expect(statuses(jobs).every((status) => status === UploadJobStatus.Complete)).toBe(true);
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

    const { result, jobs } = await upload(files, 2);

    expect(result.isOk()).toBe(true);
    expect(peak).toBe(2);
    expect(jobs.get(1)).toMatchObject({
        status: UploadJobStatus.Error,
        message: 'synthetic failure'
    });
    expect(statuses(jobs).filter((status) => status === UploadJobStatus.Complete)).toHaveLength(3);
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
                        ? { ...event, chunk: { ...event.chunk, ...DAMAGED_CHUNKS[damage] } }
                        : event
                );
            })
        );

        const { jobs, saved } = await upload([new File([PAYLOAD], 'proof.bin')], 1);

        expect(jobs.get(0)?.status).toBe(UploadJobStatus.Error);
        expect(saved).toHaveLength(0);
    }
);

test('selection validates names and worker count, preserving empty files', async () => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => browserUploadResponse(init, true));

    const { result, jobs } = await upload([new File([], 'bad/path'), new File([], 'empty.bin')], 1);

    expect(result.isOk()).toBe(true);
    expect(jobs.get(0)?.status).toBe(UploadJobStatus.Error);
    expect(jobs.get(1)?.status).toBe(UploadJobStatus.Complete);
    expect(fetch).toHaveBeenCalledOnce();

    const invalid = await upload([new File([], 'proof.bin')], 0);

    expect(invalid.result.isErr()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
});
