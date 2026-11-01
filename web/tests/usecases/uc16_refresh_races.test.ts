import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { DriveController } from '#browser/drive/index.svelte';
import { readLibraryPage, readLibrarySnapshot } from '@madkarmaa/phodrive-core/browser/library';
import * as filesApi from '#browser/files';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@madkarmaa/phodrive-core/browser/library', () => ({
    readLibraryPage: vi.fn(),
    readLibrarySnapshot: vi.fn()
}));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
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

test('a newer library load ignores the stale response and unlocks refresh', async () => {
    const stalePage = deferred<Page>();
    const currentPage = deferred<Page>();
    vi.mocked(readLibraryPage)
        .mockReturnValueOnce(Ok(undefined).andThenAsync(() => stalePage.promise))
        .mockReturnValueOnce(Ok(undefined).andThenAsync(() => currentPage.promise));

    const drive = new DriveController('test@example.com');
    drive.initialize();
    drive.ready = false;

    const staleLoad = drive.library.load();
    expect(drive.library.loading).toBe(true);
    const currentLoad = drive.library.load();
    await vi.waitFor(() => expect(readLibraryPage).toHaveBeenCalledTimes(2));

    currentPage.resolve(Ok({ items: [chunk('current')], nextPageToken: '' }));
    await currentLoad;

    stalePage.resolve(Ok({ items: [chunk('stale')], nextPageToken: '' }));
    await staleLoad;
    await vi.waitFor(() => expect(drive.library.loading).toBe(false));

    expect(drive.library.chunks.map(({ mediaKey, email }) => [mediaKey, email])).toEqual([
        ['current', 'test@example.com']
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

    const drive = new DriveController('test@example.com');
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
    const drive = new DriveController('test@example.com');
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
