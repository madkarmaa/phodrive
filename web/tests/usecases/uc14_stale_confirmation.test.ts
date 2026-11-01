import { FileSort, ThemeMode, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { DriveController } from '#browser/drive/index.svelte';
import { BrowserPreferences } from '#browser/storage';
import * as filesApi from '#browser/files';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

const FIRST = 'first@example.com';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SHA1 = 'c'.repeat(40);

function chunk(
    fileHash: string,
    email: string,
    chunkIndex: number,
    mediaKey: string
): RemoteBmp & { email: string } {
    return {
        email,
        fileHash,
        fileId: fileHash,
        chunkIndex,
        isLast: true,
        originalName: `${fileHash === HASH_A ? 'alpha' : 'beta'}.bmp`,
        size: 10,
        at: 1,
        mediaKey,
        sha1: SHA1
    };
}

function preferences(): BrowserPreferences {
    const value = new BrowserPreferences({
        theme: ThemeMode.Auto,
        fileSort: FileSort.NameAscending,
        concurrentWorkers: 2,
        refreshIntervalSeconds: 0
    });
    return value;
}

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));
vi.mock('#browser/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#browser/storage')>();
    return {
        ...actual,
        createBrowserPreferences: vi.fn(() => Ok(preferences()))
    };
});

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

test('refresh removing a chunk invalidates the stale file confirmation', async () => {
    const refreshed = [chunk(HASH_A, FIRST, 0, 'alpha-chunk-0')];
    const load = vi
        .spyOn(libraryApi, 'readLibrarySnapshot')
        .mockReturnValue(
            Ok({ items: refreshed, nextPageToken: '', pages: 1 }).andThenAsync(async (value) =>
                Ok(value)
            )
        );
    const deletion = vi
        .spyOn(filesApi, 'deleteFile')
        .mockReturnValue(Ok(undefined).andThenAsync(async () => Ok(undefined)));
    const drive = new DriveController(FIRST);
    drive.initialize();

    const chunkZero = chunk(HASH_A, FIRST, 0, 'alpha-chunk-0');
    const chunkOne = {
        ...chunk(HASH_A, FIRST, 1, 'alpha-chunk-1'),
        isLast: true,
        originalName: undefined
    };
    drive.library.chunks = [chunkZero, chunkOne];
    drive.confirmTarget = {
        email: FIRST,
        fileHash: HASH_A,
        fileId: HASH_A,
        name: 'alpha.bmp',
        at: 1,
        chunkCount: 2,
        chunks: [chunkZero, chunkOne],
        complete: true
    };
    drive.confirmOpen = true;
    await drive.library.refresh();

    expect(load).toHaveBeenCalled();
    drive.confirmAction();
    await Promise.resolve();

    expect(deletion).not.toHaveBeenCalled();
});
