import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ThemeMode, UploadEventType, UploadJobStatus, UploadRequestSchema } from '#lib/models';
import { browserUploadResponse } from '../helpers/upload';
import { DriveController } from '#browser/drive/index.svelte';

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
vi.mock('#browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/test' }));
});
afterAll(() => vi.unstubAllGlobals());

test('truncated batch marks only unfinished work failed; retry submits that file and keeps confirmed chunks', async () => {
    const files = [new File(['first'], 'complete.bin'), new File(['retry'], 'retry.bin')];
    let retryAttempts = 0;
    const metadata: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
        const json = init.body.get('metadata');
        if (typeof json !== 'string') throw new Error('Missing upload metadata');
        const request = UploadRequestSchema.parse(JSON.parse(json));
        if (request.file.name === 'complete.bin') return browserUploadResponse(init);
        expect(request.file.name).toBe('retry.bin');
        metadata.push(json);
        retryAttempts++;
        return browserUploadResponse(init, retryAttempts > 1, (events) =>
            retryAttempts === 1
                ? events.filter(
                      (event) =>
                          event.type !== UploadEventType.FileComplete &&
                          event.type !== UploadEventType.Complete
                  )
                : events
        );
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
    const partial = drive.library.chunks.find((chunk) => chunk.originalName === 'retry.bin');
    expect(partial).toBeDefined();

    const completedBeforeRetry = drive.uploadJobs[0];
    await drive.retryUpload(1);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs[0]).toEqual(completedBeforeRetry);
    expect(drive.uploadJobs[1]).toMatchObject({
        id: 1,
        name: 'retry.bin',
        status: UploadJobStatus.Complete
    });
    expect(metadata[1]).toBe(metadata[0]);
    expect(drive.library.chunks).toHaveLength(2);
    expect(drive.library.chunks.find((chunk) => chunk.originalName === 'retry.bin')?.fileId).toBe(
        partial?.fileId
    );
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
