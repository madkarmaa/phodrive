import { UploadEventType, UploadJobStatus, UploadPhase, UploadStatus } from '$lib/models';
import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { DriveController } from '$browser/drive.svelte';
import { createUploadJobs } from '$browser/files';
import type { UploadEvent } from '$lib/models';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, value);
        }
    };
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        documentElement: { getAttribute: () => 'auto', setAttribute: vi.fn() }
    });
    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('$browser/automatic-refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/synthetic' }));
});

function successfulEvents(id: number, file: File): UploadEvent[] {
    const wireSize = 3126;
    const fileHash = id.toString(16).padStart(64, '0');
    return [
        { type: UploadEventType.Queued, id },
        {
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Preparing, completed: 0, total: file.size }
        },
        {
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Uploading, completed: 0, reused: 0, total: wireSize }
        },
        {
            type: UploadEventType.Chunk,
            id,
            chunk: {
                fileHash,
                chunkIndex: 0,
                isLast: true,
                originalName: file.name,
                size: file.size,
                at: 1,
                mediaKey: `server-${id}`,
                sha1: '0'.repeat(40)
            }
        },
        {
            type: UploadEventType.Progress,
            id,
            progress: {
                phase: UploadPhase.Uploading,
                completed: wireSize,
                reused: 0,
                total: wireSize
            }
        },
        {
            type: UploadEventType.FileComplete,
            id,
            result: {
                status: UploadStatus.Uploaded,
                mediaKey: `server-${id}`,
                sha1: '0'.repeat(40)
            }
        }
    ];
}

test('mixed tiny-file batch preserves local IDs across invalid names and rejects overlapping submit', async () => {
    const files = [
        new File(['a'], 'tiny.bin'),
        new File(['b'], 'invalid\nname.bin'),
        new File(['c'], 'tiny.bin'),
        new File(['d'], 'also-tiny.bin')
    ];
    let finishRequest: (() => void) | undefined;
    const requests = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
        expect(init.body.getAll('file')).toHaveLength(3);
        const submitted = init.body
            .getAll('file')
            .filter((file): file is File => file instanceof File);
        expect(submitted.map((file) => file.name)).toEqual([
            'tiny.bin',
            'tiny.bin',
            'also-tiny.bin'
        ]);
        const events = submitted.flatMap((file, id) => successfulEvents(id, file));
        events.push({ type: UploadEventType.Complete });
        const pending = new Promise<Response>((resolve) => {
            finishRequest = () =>
                resolve(
                    new Response(
                        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
                        { headers: { 'content-type': 'text/event-stream' } }
                    )
                );
        });
        return pending;
    });
    const drive = new DriveController();
    drive.initialize();
    const first = drive.upload(files);
    expect(drive.busy).toBe(true);
    const duplicate = await drive.upload(files);
    await duplicate;
    expect(requests).toHaveBeenCalledTimes(1);
    finishRequest?.();
    await first;

    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs.map((job) => [job.id, job.name, job.status])).toEqual([
        [0, 'tiny.bin', UploadJobStatus.Complete],
        [1, 'invalid\nname.bin', UploadJobStatus.Error],
        [2, 'tiny.bin', UploadJobStatus.Complete],
        [3, 'also-tiny.bin', UploadJobStatus.Complete]
    ]);
    expect(drive.uploads.map((chunk) => chunk.mediaKey)).toEqual([
        'server-2',
        'server-1',
        'server-0'
    ]);
    expect(createUploadJobs(files).map((job) => job.id)).toEqual([0, 1, 2, 3]);
});
