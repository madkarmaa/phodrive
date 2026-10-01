import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
    ThemeMode,
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    UploadStatus,
    type UploadEvent
} from '$lib/models';
import { DriveController } from '$browser/drive.svelte';

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
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('$browser/automatic-refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

const encoder = new TextEncoder();
const FILE_HASH = 'a'.repeat(64);
const WIRE_BYTES = 3126;

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/test' }));
});
afterAll(() => vi.unstubAllGlobals());

function frame(event: UploadEvent): Uint8Array<ArrayBuffer> {
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function completeFile(id: number, name: string, fileHash = 'a'.repeat(64)): UploadEvent[] {
    return [
        { type: UploadEventType.Queued, id },
        {
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Preparing, completed: 0, total: 5 }
        },
        {
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Uploading, completed: 0, total: WIRE_BYTES, reused: 0 }
        },
        {
            type: UploadEventType.Chunk,
            id,
            chunk: {
                fileHash,
                fileId: fileHash,
                chunkIndex: 0,
                isLast: true,
                originalName: name,
                size: 5,
                at: 1,
                mediaKey: name,
                sha1: '0'.repeat(40)
            }
        },
        {
            type: UploadEventType.Progress,
            id,
            progress: {
                phase: UploadPhase.Uploading,
                completed: WIRE_BYTES,
                total: WIRE_BYTES,
                reused: 0
            }
        },
        {
            type: UploadEventType.FileComplete,
            id,
            result: { status: UploadStatus.Uploaded, mediaKey: name, sha1: '0'.repeat(40) }
        }
    ];
}

function response(events: UploadEvent[]): Response {
    const body = events.map(frame);
    return new Response(new Blob(body), { headers: { 'content-type': 'text/event-stream' } });
}

test('truncated batch marks only unfinished work failed; retry submits that file and keeps confirmed chunks', async () => {
    const files = [new File(['first'], 'complete.bin'), new File(['retry'], 'retry.bin')];
    let attempt = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        attempt++;
        if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
        const submitted = init.body.getAll('file');

        if (attempt === 1) {
            expect(submitted).toHaveLength(2);
            return response([
                ...completeFile(0, 'complete.bin'),
                { type: UploadEventType.Queued, id: 1 },
                {
                    type: UploadEventType.Progress,
                    id: 1,
                    progress: { phase: UploadPhase.Preparing, completed: 0, total: 5 }
                },
                {
                    type: UploadEventType.Progress,
                    id: 1,
                    progress: {
                        phase: UploadPhase.Uploading,
                        completed: 0,
                        total: WIRE_BYTES,
                        reused: 0
                    }
                },
                {
                    type: UploadEventType.Chunk,
                    id: 1,
                    chunk: {
                        fileHash: 'b'.repeat(64),
                        fileId: 'b'.repeat(64),
                        chunkIndex: 0,
                        isLast: true,
                        originalName: 'retry.bin',
                        size: 5,
                        at: 2,
                        mediaKey: 'retry.bin-partial',
                        sha1: '1'.repeat(40)
                    }
                }
            ]);
        }

        expect(submitted).toHaveLength(1);
        const retryFile = submitted[0];
        if (!(retryFile instanceof File)) throw new Error('Expected retry File');
        expect(retryFile.name).toBe('retry.bin');
        return response([
            ...completeFile(0, 'retry.bin', 'b'.repeat(64)),
            { type: UploadEventType.Complete }
        ]);
    });

    const drive = new DriveController();
    drive.initialize();
    await drive.upload(files);

    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs.map((job) => job.status)).toEqual([
        UploadJobStatus.Complete,
        UploadJobStatus.Error
    ]);
    expect(drive.uploadJobs[1]?.message).toContain('connection ended');
    expect(drive.uploads.map((chunk) => chunk.mediaKey)).toContain('retry.bin-partial');

    const completedBeforeRetry = drive.uploadJobs[0];
    await drive.retryUpload(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs[0]).toEqual(completedBeforeRetry);
    expect(drive.uploadJobs[1]).toMatchObject({
        id: 1,
        name: 'retry.bin',
        status: UploadJobStatus.Complete
    });
    expect(drive.uploads.map((chunk) => chunk.mediaKey)).toContain('complete.bin');
    expect(drive.uploads.map((chunk) => chunk.mediaKey)).toContain('retry.bin');
});

test('fetch rejection becomes a retryable failed job and releases the busy state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('simulated offline'));
    const drive = new DriveController();
    drive.initialize();

    await drive.upload([new File(['payload'], 'offline.bin')]);

    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs[0]).toMatchObject({
        status: UploadJobStatus.Error,
        message: 'Upload failed'
    });
});
