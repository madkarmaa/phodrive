import {
    UploadStatus,
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    FileRequestSchema,
    type UploadEvent,
    type RemoteBmp
} from '$lib/models';
import { afterEach, expect, vi, test } from 'vitest';
import { createHash } from 'node:crypto';
import { groupChunks, type UploadedChunk } from '$lib/file-groups';
import { downloadFile, uploadFiles, deleteFile, type UploadJob } from '$browser/files';

const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);
const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');
const WIRE_BYTES = 3126;
afterEach(() => vi.restoreAllMocks());

function chunk(name = 'proof.bin'): RemoteBmp {
    return {
        fileHash: FILE_HASH,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: PAYLOAD.length,
        at: 1,
        mediaKey: name,
        sha1: '0'.repeat(40)
    };
}

function events(id = 0, name = 'proof.bin', duplicate = false): UploadEvent[] {
    return [
        { type: UploadEventType.Queued, id },
        {
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Preparing, completed: 0, total: PAYLOAD.length }
        },
        {
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Uploading, completed: 0, total: WIRE_BYTES, reused: 0 }
        },
        { type: UploadEventType.Chunk, id, chunk: chunk(name) },
        {
            type: UploadEventType.Progress,
            id,
            progress: {
                phase: UploadPhase.Uploading,
                completed: duplicate ? 0 : WIRE_BYTES,
                total: WIRE_BYTES,
                reused: duplicate ? WIRE_BYTES : 0
            }
        },
        {
            type: UploadEventType.FileComplete,
            id,
            result: {
                status: duplicate ? UploadStatus.AlreadyExists : UploadStatus.Uploaded,
                mediaKey: name,
                sha1: '0'.repeat(40)
            }
        }
    ];
}

function response(events: UploadEvent[]): Response {
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' }
    });
}

test('selection sends credentials, workers and original files once without reading or encoding', async () => {
    const files = [new File([PAYLOAD], 'proof.bin'), new File([PAYLOAD], 'other.bin')];
    const reads = files.map((file) => vi.spyOn(file, 'arrayBuffer'));
    const slices = files.map((file) => vi.spyOn(file, 'slice'));
    const saved: UploadedChunk[] = [];
    const jobs = new Map<number, UploadJob>();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
        expect(init.body.getAll('file')).toEqual(files);
        expect(init.body.get('email')).toBe('test@example.com');
        expect(init.body.get('token')).toBe('aas_et/test');
        expect(init.body.get('workers')).toBe('2');
        return response([
            ...events(),
            ...events(1, 'other.bin', true),
            { type: UploadEventType.Complete }
        ]);
    });

    const uploaded = await uploadFiles(
        files,
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.set(job.id, job),
        (value) => saved.push(value)
    );
    expect(uploaded.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const spy of [...reads, ...slices]) expect(spy).not.toHaveBeenCalled();
    expect([...jobs.values()].map((job) => job.status)).toEqual(['complete', 'complete']);
    expect(jobs.get(1)?.progress).toMatchObject({ completed: 0, reused: WIRE_BYTES });
    expect(saved).toHaveLength(2);
    expect(saved.every((item) => item.email === 'test@example.com')).toBe(true);
});

test('file failures retain confirmed chunks while independent files finish', async () => {
    const saved: UploadedChunk[] = [];
    const jobs = new Map<number, UploadJob>();
    const partial = events().slice(0, 4);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        response([
            ...partial,
            { type: UploadEventType.FileError, id: 0, error: 'Upload transfer failed (HTTP 429)' },
            ...events(1, 'good.bin'),
            { type: UploadEventType.Complete }
        ])
    );
    const result = await uploadFiles(
        [new File([PAYLOAD], 'proof.bin'), new File([PAYLOAD], 'good.bin')],
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.set(job.id, job),
        (item) => saved.push(item)
    );
    expect(result.isOk()).toBe(true);
    expect(jobs.get(0)).toMatchObject({
        status: UploadJobStatus.Error,
        message: expect.stringContaining('429')
    });
    expect(jobs.get(1)?.status).toBe('complete');
    expect(saved).toHaveLength(2);
});

test('job events reject regressing totals, unknown IDs, incomplete confirmations and premature batch completion', async () => {
    const cases: UploadEvent[][] = [
        [{ type: UploadEventType.Complete }],
        events(99),
        [
            ...events().slice(0, 3),
            {
                type: UploadEventType.Progress,
                id: 0,
                progress: { phase: UploadPhase.Uploading, completed: 0, reused: 0, total: 1 }
            }
        ],
        [
            ...events().slice(0, 3),
            {
                type: UploadEventType.Progress,
                id: 0,
                progress: {
                    phase: UploadPhase.Uploading,
                    completed: 10,
                    reused: 0,
                    total: WIRE_BYTES
                }
            },
            {
                type: UploadEventType.Progress,
                id: 0,
                progress: {
                    phase: UploadPhase.Uploading,
                    completed: 5,
                    reused: 0,
                    total: WIRE_BYTES
                }
            }
        ],
        events().filter((event) => event.type !== UploadEventType.Chunk),
        [...events(), ...events()],
        events().slice(0, 3)
    ];
    for (const invalid of cases) {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(invalid));
        const result = await uploadFiles(
            [new File([PAYLOAD], 'proof.bin')],
            'test@example.com',
            'aas_et/test',
            2,
            () => {},
            () => {}
        );
        expect(result.isErr()).toBe(true);
    }
});

test('invalid names and worker counts never read or schedule files', async () => {
    const invalid = new File([PAYLOAD], 'invalid\nname.bin');
    const reads = vi.spyOn(invalid, 'slice');
    const requests = vi.spyOn(globalThis, 'fetch');
    const jobs: UploadJob[] = [];
    const selected = await uploadFiles(
        [invalid],
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.push(job),
        () => {}
    );
    expect(selected.isOk()).toBe(true);
    expect(jobs.at(-1)?.status).toBe('error');
    const workers = await uploadFiles(
        [new File([PAYLOAD], 'proof.bin')],
        'test@example.com',
        'aas_et/test',
        0,
        () => {},
        () => {}
    );
    expect(workers.isErr()).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalled();
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
