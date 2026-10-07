import { UploadJobStatus } from '$lib/models';
import { beforeEach, expect, test, vi } from 'vitest';
import { DriveController } from '$browser/drive.svelte';
import { createUploadJobs } from '$browser/files';
import { browserUploadResponse } from '../helpers/upload';

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

test('mixed tiny-file batch preserves local IDs across invalid names and rejects overlapping submit', async () => {
    const files = [
        new File(['a'], 'tiny.bin'),
        new File(['b'], 'invalid\nname.bin'),
        new File(['c'], 'tiny.bin'),
        new File(['d'], 'also-tiny.bin')
    ];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const requests = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        await gate;
        return browserUploadResponse(init);
    });
    const drive = new DriveController();
    drive.initialize();
    const first = drive.upload(files);
    expect(drive.busy).toBe(true);
    const duplicate = await drive.upload(files);
    await duplicate;
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(3));
    release();
    await first;

    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs.map((job) => [job.id, job.name, job.status])).toEqual([
        [0, 'tiny.bin', UploadJobStatus.Complete],
        [1, 'invalid\nname.bin', UploadJobStatus.Error],
        [2, 'tiny.bin', UploadJobStatus.Complete],
        [3, 'also-tiny.bin', UploadJobStatus.Complete]
    ]);
    expect(drive.uploads).toHaveLength(3);
    expect(new Set(drive.uploads.map((chunk) => chunk.fileHash)).size).toBe(3);
    expect(requests).toHaveBeenCalledTimes(3);
    expect(createUploadJobs(files).map((job) => job.id)).toEqual([0, 1, 2, 3]);
});
