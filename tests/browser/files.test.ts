import { afterEach, expect, vi, test } from 'vitest';
import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { encodeSplitBmp, decodeSplitBmp, MAX_CHUNK_PAYLOAD_BYTES } from '$lib/bmp';
import { DEFAULT_CONCURRENT_WORKERS, FileRequestSchema, type UploadResponse } from '$lib/models';
import { groupChunks, type UploadedChunk } from '$lib/file-groups';
import {
    checkFileSize,
    downloadFile,
    uploadFiles,
    deleteFile,
    type UploadProgress,
    type UploadJob
} from '$browser/files';

const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);
const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');
afterEach(() => vi.restoreAllMocks());

function uploadOne(
    file: File,
    onProgress: (progress: UploadProgress) => void,
    onChunk: (chunk: UploadedChunk) => void
): AsyncResult<UploadResponse, Error> {
    let final: UploadJob | null = null;
    let previousProgress: UploadProgress | null = null;

    return uploadFiles(
        [file],
        'test@example.com',
        'aas_et/test',
        DEFAULT_CONCURRENT_WORKERS,
        (job) => {
            final = job;
            if (previousProgress && job.progress !== previousProgress) onProgress(job.progress);
            previousProgress = job.progress;
        },
        onChunk
    ).andThen(() => {
        if (!final?.result) return Err(new Error(final?.message || 'No upload result.'));

        return Ok(final.result);
    });
}

function chunk(fileHash = FILE_HASH): UploadedChunk {
    return {
        email: 'test@example.com',
        fileHash,
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: PAYLOAD.length,
        at: 1,
        mediaKey: 'test-media',
        sha1: '0'.repeat(40)
    };
}

function bmp(fileHash = FILE_HASH): Uint8Array<ArrayBuffer> {
    return encodeSplitBmp(PAYLOAD, {
        fileHash,
        chunkIndex: 0,
        flags: 1,
        payloadSize: PAYLOAD.length,
        fileName: 'proof.bin'
    }).unwrap();
}

function uploadResponse(total: number, result: UploadResponse): Response {
    const events =
        result.status === 'uploaded'
            ? [
                  { type: 'progress', sent: Math.floor(total / 2), total },
                  { type: 'progress', sent: total, total },
                  { type: 'complete', result }
              ]
            : [{ type: 'complete', result }];

    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' }
    });
}

test('browser download preserves bytes and refuses incomplete or corrupt groups', async () => {
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(bmp()));
    const group = groupChunks([chunk()])[0];
    const downloaded = await downloadFile(group, 'aas_et/test');
    const recovered = await downloaded.unwrap().arrayBuffer();

    expect(new Uint8Array(recovered)).toEqual(PAYLOAD);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const incomplete = await downloadFile({ ...group, complete: false }, 'aas_et/test');
    expect(incomplete.isErr()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const incorrectHash = 'f'.repeat(64);
    fetchMock.mockImplementation(async () => new Response(bmp(incorrectHash)));
    const corrupt = await downloadFile(groupChunks([chunk(incorrectHash)])[0], 'aas_et/test');
    expect(corrupt.unwrapErr().message).toContain('SHA-256');
});

test('file validation accepts empty files and rejects unsafe names before reading bytes', () => {
    expect(checkFileSize(new File([], 'empty.bin')).unwrap()).toBe(1);
    expect(checkFileSize(new File([PAYLOAD], 'unsafe\nname.bin')).isErr()).toBe(true);
});

test('upload reports live wire bytes while preserving the encoded payload', async () => {
    const progress: UploadProgress[] = [];
    const saved: UploadedChunk[] = [];
    const file = new File([PAYLOAD], 'proof.bin');
    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBeInstanceOf(FormData);

        if (!(init?.body instanceof FormData)) throw new Error('Expected an upload form');

        const uploadedFile = init.body.get('file');
        expect(uploadedFile).toBeInstanceOf(File);

        if (!(uploadedFile instanceof File)) throw new Error('Expected an uploaded file');

        const bytes = await uploadedFile.arrayBuffer();
        const decoded = decodeSplitBmp(new Uint8Array(bytes)).unwrap();
        expect(decoded.payload).toEqual(PAYLOAD);
        expect(decoded.header.fileHash).toBe(FILE_HASH);
        expect(decoded.header.fileName).toBe(file.name);

        return uploadResponse(bytes.byteLength, {
            status: 'uploaded',
            mediaKey: 'test-media',
            sha1: '0'.repeat(40)
        });
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const uploaded = await uploadOne(
        file,
        (value) => progress.push(value),
        (value) => saved.push(value)
    );

    expect(uploaded.unwrap().status).toBe('uploaded');
    expect(progress.filter((value) => value.phase === 'hashing')).toEqual([
        { phase: 'hashing', completed: 0, total: file.size },
        { phase: 'hashing', completed: file.size, total: file.size }
    ]);
    const transfers = progress.filter((value) => value.phase === 'uploading');
    const wireSize = bmp().byteLength;
    expect(transfers.map((value) => value.completed)).toEqual([
        0,
        Math.floor(wireSize / 2),
        wireSize,
        wireSize
    ]);
    expect(transfers.every((value) => value.total === wireSize && value.reused === 0)).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].originalName).toBe(file.name);
});

// Simulate large file slices without allocating hundreds of MB for scheduling tests.
class VirtualSplitFile extends File {
    constructor(
        private readonly count: number,
        name = 'parallel.bin',
        private readonly seed = 0
    ) {
        super([], name);
    }

    override get size() {
        return this.count * MAX_CHUNK_PAYLOAD_BYTES;
    }

    override slice(start = 0, _end?: number): Blob {
        return new Blob([Uint8Array.of(this.seed + Math.floor(start / MAX_CHUNK_PAYLOAD_BYTES))]);
    }
}

test('parallel byte progress remains monotonic and tracks confirmed duplicate reuse', async () => {
    const count = DEFAULT_CONCURRENT_WORKERS + 2;
    const saved: UploadedChunk[] = [];
    const progress: UploadProgress[] = [];
    let active = 0;
    let peak = 0;

    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!(init?.body instanceof FormData)) throw new Error('Expected an upload form');
        const file = init.body.get('file');
        if (!(file instanceof File)) throw new Error('Expected a BMP');

        const bytes = await file.arrayBuffer();
        const decoded = decodeSplitBmp(new Uint8Array(bytes)).unwrap();
        const index = decoded.header.chunkIndex;
        expect(decoded.header.flags).toBe(index === count - 1 ? 1 : 0);
        active++;
        peak = Math.max(peak, active);

        await new Promise<void>((resolve) => setTimeout(resolve, (count - index) * 4));
        active--;
        return uploadResponse(bytes.byteLength, {
            status: index === 0 ? 'uploaded' : 'already exists',
            mediaKey: `chunk-${index}`,
            sha1: '0'.repeat(40)
        });
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const result = await uploadOne(
        new VirtualSplitFile(count),
        (value) => progress.push(value),
        (value) => saved.push(value)
    );

    expect(result.unwrap().status).toBe('uploaded');
    expect(peak).toBe(DEFAULT_CONCURRENT_WORKERS);
    expect(active).toBe(0);
    expect(saved).toHaveLength(count);
    expect(saved[0].chunkIndex).not.toBe(0);
    const transfers = progress.filter((value) => value.phase === 'uploading');
    const completed = transfers.map((value) => value.completed + value.reused);
    expect(completed).toEqual([...completed].sort((a, b) => a - b));
    expect(transfers.at(-1)?.reused).toBeGreaterThan(0);
    expect(transfers.at(-1)?.completed).toBeGreaterThan(0);
});

test('upload failure leaves queued chunks unread and waits for active chunks to settle', async () => {
    const count = DEFAULT_CONCURRENT_WORKERS + 2;
    let started = 0;
    let finished = 0;
    const saved: UploadedChunk[] = [];

    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
        const file = init.body.get('file');
        if (!(file instanceof File)) throw new Error('Expected BMP');
        const index = started++;
        await new Promise<void>((resolve) => setTimeout(resolve, index === 0 ? 1 : 20));
        finished++;
        return index === 0
            ? Response.json({ error: 'Upload failed (HTTP 429)' }, { status: 400 })
            : uploadResponse(file.size, {
                  status: 'uploaded',
                  mediaKey: `chunk-${index}`,
                  sha1: '0'.repeat(40)
              });
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const result = await uploadOne(
        new VirtualSplitFile(count),
        () => {},
        (value) => saved.push(value)
    );

    expect(result.unwrapErr().message).toContain('429');
    expect(started).toBe(DEFAULT_CONCURRENT_WORKERS);
    expect(finished).toBe(started);
    expect(saved).toHaveLength(started - 1);
});

test('parallel deletion attempts all chunks and reports only confirmed removals after partial failure', async () => {
    const count = DEFAULT_CONCURRENT_WORKERS + 2;
    const chunks = Array.from({ length: count }, (_, index) => ({
        ...chunk(),
        chunkIndex: index,
        isLast: index === count - 1,
        originalName: index === 0 ? 'parallel.bin' : undefined,
        mediaKey: `chunk-${index}`
    }));
    const removed: UploadedChunk[] = [];
    let active = 0;
    let peak = 0;
    let attempted = 0;

    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a delete request');
        const body: unknown = JSON.parse(init.body);
        const request = FileRequestSchema.parse(body);
        attempted++;
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        active--;
        return request.mediaKey === 'chunk-0'
            ? Response.json({ error: 'Delete failed' }, { status: 400 })
            : Response.json({ deleted: true });
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const result = await deleteFile(
        groupChunks(chunks)[0],
        'aas_et/test',
        (value) => removed.push(value),
        DEFAULT_CONCURRENT_WORKERS
    );

    expect(result.isErr()).toBe(true);
    expect(attempted).toBe(count);
    expect(peak).toBe(DEFAULT_CONCURRENT_WORKERS);
    expect(active).toBe(0);
    expect(removed).toHaveLength(count - 1);
    expect(removed.some((value) => value.mediaKey === 'chunk-0')).toBe(false);
});

test.each([
    { workers: 2, fileCount: 3 },
    { workers: 16, fileCount: 6 }
])(
    'a whole selection shares $workers workers across split files',
    async ({ workers, fileCount }) => {
        const jobs = new Map<number, UploadJob>();
        const saved: UploadedChunk[] = [];
        const count = 3;
        let active = 0;
        let peak = 0;
        const sources = Array.from(
            { length: fileCount },
            (_, index) => new VirtualSplitFile(count, `file-${index}.bin`, index * 10)
        );

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
            if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
            const file = init.body.get('file');
            if (!(file instanceof File)) throw new Error('Expected BMP');

            const bytes = await file.arrayBuffer();
            const decoded = decodeSplitBmp(new Uint8Array(bytes)).unwrap();
            active++;
            peak = Math.max(peak, active);
            await new Promise<void>((resolve) =>
                setTimeout(resolve, (count - decoded.header.chunkIndex) * 4)
            );
            active--;

            return uploadResponse(file.size, {
                status: 'uploaded',
                mediaKey: file.name,
                sha1: '0'.repeat(40)
            });
        });

        const uploaded = await uploadFiles(
            sources,
            'test@example.com',
            'aas_et/test',
            workers,
            (job) => jobs.set(job.id, job),
            (chunk) => saved.push(chunk)
        );

        expect(uploaded.isOk()).toBe(true);
        expect(peak).toBe(workers);
        expect(active).toBe(0);
        expect(saved).toHaveLength(fileCount * count);
        expect([...jobs.values()].map((job) => job.status)).toEqual(
            Array.from({ length: fileCount }, () => 'complete')
        );
        expect(saved[0].chunkIndex).not.toBe(0);
    }
);

test('one failed file skips its queued splits while other files finish and active confirmations remain', async () => {
    const workers = 2;
    const failedFile = new VirtualSplitFile(4, 'failed.bin');
    const goodFile = new VirtualSplitFile(2, 'good.bin', 10);
    const reads = vi.spyOn(failedFile, 'slice');
    const jobs = new Map<number, UploadJob>();
    const saved: UploadedChunk[] = [];
    const attempted: string[] = [];
    let active = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
        const file = init.body.get('file');
        if (!(file instanceof File)) throw new Error('Expected BMP');

        const bytes = await file.arrayBuffer();
        const decoded = decodeSplitBmp(new Uint8Array(bytes)).unwrap();
        const fail = file.name.startsWith('failed.bin.') && decoded.header.chunkIndex === 0;
        attempted.push(file.name);
        active++;
        await new Promise<void>((resolve) => setTimeout(resolve, fail ? 1 : 20));
        active--;
        if (fail) return Response.json({ error: 'Upload failed (HTTP 429)' }, { status: 400 });

        return uploadResponse(file.size, {
            status: 'uploaded',
            mediaKey: file.name,
            sha1: '0'.repeat(40)
        });
    });

    const uploaded = await uploadFiles(
        [failedFile, goodFile],
        'test@example.com',
        'aas_et/test',
        workers,
        (job) => jobs.set(job.id, job),
        (chunk) => saved.push(chunk)
    );

    expect(uploaded.isOk()).toBe(true);
    expect(active).toBe(0);
    expect(jobs.get(0)?.status).toBe('error');
    expect(jobs.get(0)?.message).toContain('429');
    expect(jobs.get(1)?.status).toBe('complete');
    expect(attempted.filter((name) => name.startsWith('failed.bin.'))).toHaveLength(workers);
    const payloadReads = reads.mock.calls.filter(
        ([start = 0, end]) => end === start + MAX_CHUNK_PAYLOAD_BYTES
    );
    expect(payloadReads).toHaveLength(workers);
    expect(saved.filter((chunk) => chunk.mediaKey.startsWith('failed.bin.'))).toHaveLength(1);
    expect(saved.filter((chunk) => chunk.mediaKey.startsWith('good.bin.'))).toHaveLength(2);
});

test('invalid files never read bytes and invalid worker counts never schedule a selection', async () => {
    const invalidFile = new File([PAYLOAD], 'invalid\nname.bin');
    const reads = vi.spyOn(invalidFile, 'slice');
    const requests = vi.spyOn(globalThis, 'fetch');
    const jobs: UploadJob[] = [];

    const invalidSelection = await uploadFiles(
        [invalidFile],
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.push(job),
        () => {}
    );

    expect(invalidSelection.isOk()).toBe(true);
    expect(jobs.at(-1)?.status).toBe('error');
    expect(reads).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalled();

    const invalidWorkers = await uploadFiles(
        [new File([PAYLOAD], 'good.bin')],
        'test@example.com',
        'aas_et/test',
        0,
        () => {},
        () => {}
    );

    expect(invalidWorkers.isErr()).toBe(true);
    expect(requests).not.toHaveBeenCalled();
});
