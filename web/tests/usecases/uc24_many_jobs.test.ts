import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';
import {
    FileActionKind,
    ThemeMode,
    UploadJobStatus,
    UploadStatus
} from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { CONCURRENT_WORKERS_KEY } from '#browser/storage';

const { storage, tab } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value)
    };
    const tab = Object.assign(new EventTarget(), { localStorage: storage });
    vi.stubGlobal('window', tab);
    vi.stubGlobal('document', {
        hidden: false,
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage, tab };
});

const OWNER = 'owner@example.com';

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    vi.restoreAllMocks();
    storage.clear();
    storage.setItem(CONCURRENT_WORKERS_KEY, '1');
});

afterAll(() => vi.unstubAllGlobals());

function fromOtherTab(key: string, value: string): void {
    storage.setItem(key, value);
    const event = Object.assign(new Event('storage'), { key, newValue: value });
    tab.dispatchEvent(event);
}

function uploadedChunk(name: string): UploadedChunk {
    return {
        email: OWNER,
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: 12,
        at: 1,
        mediaKey: `key-${name}`,
        sha1: 'b'.repeat(40)
    };
}

test('large queue stays single-flight and takes the current worker preference on retry', async () => {
    const largeSelection = Array.from(
        { length: 80 },
        (_, index) => new File([new Uint8Array(64 * 1024)], `photo-${index}.bin`)
    );
    const calls: { names: string[]; email: string; workers: number }[] = [];
    const gates: (() => void)[] = [];
    let attempt = 0;
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, email, workers, onJob) => {
            calls.push({ names: files.map((file) => file.name), email, workers });
            const gate = new Promise<void>((resolve) => gates.push(resolve));
            const submitted = filesApi.createUploadJobs(files);
            const currentAttempt = ++attempt;

            return Ok(undefined).andThenAsync(async () => {
                await gate;
                for (const job of submitted) {
                    if (currentAttempt === 1 && job.id === 0) {
                        onJob({ ...job, status: UploadJobStatus.Error, message: 'Retry me' });
                        continue;
                    }

                    onJob({
                        ...job,
                        status: UploadJobStatus.Complete,
                        result: {
                            status: UploadStatus.Uploaded,
                            mediaKey: `key-${job.name}`,
                            sha1: 'c'.repeat(40)
                        }
                    });
                }

                return Ok(undefined);
            });
        });
    const deletion = vi.spyOn(filesApi, 'deleteFile');
    const download = vi.spyOn(filesApi, 'downloadFile');
    const library = vi
        .spyOn(libraryApi, 'readLibraryPage')
        .mockReturnValue(
            Ok({ items: [], nextPageToken: '' }).andThenAsync(async (page) => Ok(page))
        );
    const drive = new DriveController(OWNER);
    drive.initialize();
    drive.library.chunks = [uploadedChunk('existing.bin')];

    const firstUpload = drive.upload(largeSelection);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(calls[0]).toEqual({
        names: largeSelection.map((file) => file.name),
        email: OWNER,
        workers: 1
    });

    await drive.upload([new File(['overlap'], 'overlap.bin')]);
    await drive.retryUpload(0);
    const existingFile = drive.library.files[0];
    if (!existingFile) throw new Error('Expected a synthetic file group.');
    await drive.actOnFile(existingFile, FileActionKind.Delete);
    await drive.actOnFile(existingFile, FileActionKind.Download);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(deletion).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();

    fromOtherTab(CONCURRENT_WORKERS_KEY, '32');
    await vi.waitFor(() => expect(drive.settings.concurrentWorkers).toBe(32));
    gates[0]();
    await firstUpload;
    expect(drive.uploadJobs.filter((job) => job.status === UploadJobStatus.Error)).toHaveLength(1);

    const retry = drive.retryUpload(0);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await drive.retryUpload(0);
    expect(calls[1]).toEqual({ names: ['photo-0.bin'], email: OWNER, workers: 32 });

    gates[1]();
    await retry;

    expect(calls).toHaveLength(2);
    expect(drive.uploadJobs.every((job) => job.status === UploadJobStatus.Complete)).toBe(true);
    expect(deletion).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(library).not.toHaveBeenCalled();
});
