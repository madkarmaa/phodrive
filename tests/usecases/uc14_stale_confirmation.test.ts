import { ConfirmKind, FileSort, ThemeMode, type RemoteBmp } from '#lib/models';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { DriveController } from '#browser/drive/index.svelte';
import { BrowserPreferences } from '#browser/storage';
import * as filesApi from '#browser/files';
import * as libraryApi from '#browser/library';

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

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SHA1 = 'c'.repeat(40);
const accountValues: Record<string, string> = {
    [FIRST]: 'aas_et/first',
    [SECOND]: 'aas_et/second'
};

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
vi.mock('#browser/accounts', () => ({ validateAccount: vi.fn() }));
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
    storage.setItem('accounts', JSON.stringify(accountValues));
});

afterAll(() => vi.unstubAllGlobals());

test('confirming a file after switching accounts refuses the old account target', async () => {
    const drive = new DriveController();
    drive.initialize();
    const itemA = {
        email: FIRST,
        fileHash: HASH_A,
        fileId: HASH_A,
        name: 'alpha.bmp',
        at: 1,
        chunkCount: 1,
        chunks: [chunk(HASH_A, FIRST, 0, 'alpha-chunk')],
        complete: true
    };
    drive.library.chunks = [
        chunk(HASH_A, FIRST, 0, 'alpha-chunk'),
        chunk(HASH_B, SECOND, 0, 'beta-chunk')
    ];
    drive.confirmTarget = { kind: ConfirmKind.File, item: itemA };
    drive.confirmOpen = true;
    drive.selectAccount(SECOND);
    const deletion = vi
        .spyOn(filesApi, 'deleteFile')
        .mockReturnValue(Ok(undefined).andThenAsync(async () => Ok(undefined)));

    drive.confirmAction();
    await Promise.resolve();

    expect(deletion).not.toHaveBeenCalled();
});

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
    const drive = new DriveController();
    drive.initialize();

    const chunkZero = chunk(HASH_A, FIRST, 0, 'alpha-chunk-0');
    const chunkOne = {
        ...chunk(HASH_A, FIRST, 1, 'alpha-chunk-1'),
        isLast: true,
        originalName: undefined
    };
    drive.library.chunks = [chunkZero, chunkOne];
    drive.confirmTarget = {
        kind: ConfirmKind.File,
        item: {
            email: FIRST,
            fileHash: HASH_A,
            fileId: HASH_A,
            name: 'alpha.bmp',
            at: 1,
            chunkCount: 2,
            chunks: [chunkZero, chunkOne],
            complete: true
        }
    };
    drive.confirmOpen = true;
    await drive.library.refresh();

    expect(load).toHaveBeenCalled();
    drive.confirmAction();
    await Promise.resolve();

    expect(deletion).not.toHaveBeenCalled();
});
