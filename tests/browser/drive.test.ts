import { ThemeMode, UploadJobStatus, UploadStatus } from '$lib/models';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { DriveController } from '$browser/drive.svelte';
import * as filesApi from '$browser/files';

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

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/test' }));
});

afterAll(() => vi.unstubAllGlobals());

test('retry keeps the original job ID and sends only its file, preserving other outcomes', async () => {
    const sources = [
        new File(['first'], 'complete.bin'),
        new File(['second'], 'failed-one.bin'),
        new File(['third'], 'failed-two.bin')
    ];
    let attempt = 0;
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _token, _workers, onJob) => {
            attempt++;

            for (const job of filesApi.createUploadJobs(files)) {
                const failed = attempt === 1 && job.id > 0;
                onJob({
                    ...job,
                    status: failed ? UploadJobStatus.Error : UploadJobStatus.Complete,
                    message: failed ? 'Upload start failed' : '',
                    result: failed
                        ? null
                        : {
                              status:
                                  attempt === 1
                                      ? UploadStatus.Uploaded
                                      : UploadStatus.AlreadyExists,
                              mediaKey: job.name,
                              sha1: '0'.repeat(40)
                          }
                });
            }

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController();
    drive.initialize();

    await drive.upload(sources);
    const completed = drive.uploadJobs[0];
    const otherFailure = drive.uploadJobs[1];

    await drive.retryUpload(2);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][0]).toEqual([sources[2]]);
    expect(drive.uploadJobs[0]).toEqual(completed);
    expect(drive.uploadJobs[1]).toEqual(otherFailure);
    expect(drive.uploadJobs[2]).toMatchObject({
        id: 2,
        name: sources[2].name,
        status: UploadJobStatus.Complete,
        message: '',
        result: { status: UploadStatus.AlreadyExists }
    });

    await drive.retryUpload(0);
    await drive.retryUpload(-1);
    drive.busy = true;
    await drive.retryUpload(1);
    drive.busy = false;
    drive.libraryLoading = true;
    await drive.retryUpload(1);

    expect(upload).toHaveBeenCalledTimes(2);
});
