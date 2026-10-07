import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { ThemeMode } from '#lib/models';
import { DriveController } from '#browser/drive/index.svelte';
import { readLibraryPage, readLibrarySnapshot } from '#browser/library';
import * as filesApi from '#browser/files';

const { storage } = vi.hoisted(() => {
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

    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        hidden: false,
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('#browser/library', () => ({ readLibraryPage: vi.fn(), readLibrarySnapshot: vi.fn() }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    storage.setItem(
        'accounts',
        JSON.stringify({
            'first@example.com': 'aas_et/first-fake',
            'second@example.com': 'aas_et/second-fake'
        })
    );
    storage.setItem('selectedAccount', JSON.stringify('first@example.com'));
});

afterAll(() => vi.unstubAllGlobals());

type Page = Awaited<ReturnType<typeof readLibraryPage>>;
type Snapshot = Awaited<ReturnType<typeof readLibrarySnapshot>>;

function deferred<T>() {
    let resolve: ((value: T) => void) | undefined;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve: (value: T) => resolve?.(value) };
}

function chunk(mediaKey: string) {
    return {
        mediaKey,
        sha1: '1'.repeat(40),
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: `${mediaKey}.bin`,
        size: 1,
        at: 1
    };
}

test('switching accounts during pending library requests ignores stale responses and unlocks refresh', async () => {
    const firstAccountPage = deferred<Page>();
    const secondAccountPage = deferred<Page>();
    vi.mocked(readLibraryPage)
        .mockReturnValueOnce(Ok(undefined).andThenAsync(() => firstAccountPage.promise))
        .mockReturnValueOnce(Ok(undefined).andThenAsync(() => secondAccountPage.promise));

    const drive = new DriveController();
    drive.initialize();
    drive.ready = false;

    const firstLoad = drive.library.load();
    expect(drive.library.loading).toBe(true);
    drive.selectAccount('second@example.com');
    const secondLoad = drive.library.load();
    await vi.waitFor(() => expect(readLibraryPage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(readLibraryPage).mock.calls.map(([email]) => email)).toEqual([
        'first@example.com',
        'second@example.com'
    ]);

    secondAccountPage.resolve(Ok({ items: [chunk('second-current')], nextPageToken: '' }));
    await secondLoad;

    firstAccountPage.resolve(Ok({ items: [chunk('first-stale')], nextPageToken: '' }));
    await firstLoad;
    await vi.waitFor(() => expect(drive.library.loading).toBe(false));

    expect(drive.selectedEmail).toBe('second@example.com');
    expect(drive.library.chunks.map(({ mediaKey, email }) => [mediaKey, email])).toEqual([
        ['second-current', 'second@example.com']
    ]);
});

test('manual refresh replaces completed initial data and clears the loading state', async () => {
    const initialPage = deferred<Page>();
    const firstRefresh = deferred<Snapshot>();
    vi.mocked(readLibraryPage).mockReturnValueOnce(
        Ok(undefined).andThenAsync(() => initialPage.promise)
    );
    vi.mocked(readLibrarySnapshot).mockReturnValueOnce(
        Ok(undefined).andThenAsync(() => firstRefresh.promise)
    );

    const drive = new DriveController();
    drive.initialize();
    drive.ready = false;

    drive.ready = true;
    const initialLoad = drive.library.load();
    initialPage.resolve(Ok({ items: [chunk('initial')], nextPageToken: '' }));
    await initialLoad;
    expect(drive.library.loading).toBe(false);

    const olderRefresh = drive.library.refresh();
    expect(drive.library.loading).toBe(true);
    firstRefresh.resolve(Ok({ items: [chunk('refreshed')], nextPageToken: '', pages: 1 }));
    await olderRefresh;

    expect(drive.library.loading).toBe(false);
    expect(drive.library.chunks.map(({ mediaKey }) => mediaKey)).toEqual(['refreshed']);
    expect(drive.feedbackMessage).toBe('');
});

test('file selection during refresh shows feedback and can be submitted again after refresh', async () => {
    const pendingRefresh = deferred<Snapshot>();
    vi.mocked(readLibrarySnapshot).mockReturnValueOnce(
        Ok(undefined).andThenAsync(() => pendingRefresh.promise)
    );
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation(() => Ok(undefined).andThenAsync(async () => Ok(undefined)));
    const drive = new DriveController();
    drive.initialize();
    drive.ready = false;

    const previousJobs = filesApi.createUploadJobs([new File(['existing'], 'existing.txt')]);
    drive.uploadJobs = previousJobs;
    const files = [new File(['selected'], 'selected.txt')];

    const refresh = drive.library.refresh();
    expect(drive.library.loading).toBe(true);
    await drive.upload(files);

    expect(upload).not.toHaveBeenCalled();
    expect(drive.uploadJobs).toEqual(previousJobs);
    expect(drive.uploadPanelOpen).toBe(false);
    expect(drive.busy).toBe(false);
    expect(drive.feedbackMessage).toBe(
        'Files are refreshing. Wait for the refresh to finish, then select your files again.'
    );

    pendingRefresh.resolve(Ok({ items: [], nextPageToken: '', pages: 1 }));
    await refresh;
    expect(drive.library.loading).toBe(false);
    expect(drive.feedbackMessage).toContain('Files are refreshing.');

    await drive.upload(files);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toEqual(files);
    expect(drive.feedbackMessage).toBe('');
    expect(drive.uploadJobs[0].name).toBe('selected.txt');
});
