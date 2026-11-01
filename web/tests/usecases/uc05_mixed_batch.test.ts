import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import { beforeEach, expect, test, vi } from 'vitest';
import { DriveController } from '#browser/drive/index.svelte';
import { createUploadJobs } from '#browser/files';
import { browserUploadResponse } from '../../../core/tests/helpers/upload';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
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
    const drive = new DriveController('test@example.com');
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
    expect(drive.library.chunks).toHaveLength(3);
    expect(new Set(drive.library.chunks.map((chunk) => chunk.fileHash)).size).toBe(3);
    expect(requests).toHaveBeenCalledTimes(3);
    expect(createUploadJobs(files).map((job) => job.id)).toEqual([0, 1, 2, 3]);
});
