import type { ApplicationError } from '$lib/errors';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import type { AsyncResult } from 'results-ts';
import { readLibrarySnapshot } from '$browser/library';
import * as api from '$browser/api';
import { DriveController } from '$browser/drive/index.svelte';
import {
    ThemeMode,
    LibraryResponseSchema,
    type LibraryResponse,
    type RemoteBmp
} from '$lib/models';

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
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });
    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('$browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/test' }));
});
afterAll(() => vi.unstubAllGlobals());

function remoteFile(mediaKey: string, chunkIndex = 0): RemoteBmp {
    return {
        mediaKey,
        fileHash: '0'.repeat(64),
        fileId: '0'.repeat(64),
        sha1: '0'.repeat(40),
        chunkIndex,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1
    };
}

function page(items: RemoteBmp[], nextPageToken: string): LibraryResponse {
    return LibraryResponseSchema.parse({ items, nextPageToken });
}

function apiResult(response: LibraryResponse): AsyncResult<unknown, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => Ok(response));
}

test('snapshot returns an error when Google Photos repeats a page token', async () => {
    const apiJson = vi.spyOn(api, 'apiJson').mockImplementation(() => apiResult(page([], '')));
    apiJson.mockReturnValueOnce(
        apiResult(page([remoteFile('part-1', 1), remoteFile('part-0')], 'repeat-token'))
    );
    apiJson.mockReturnValueOnce(
        apiResult(page([remoteFile('part-1', 1), remoteFile('part-2', 2)], 'repeat-token'))
    );

    const snapshot = await readLibrarySnapshot('test@example.com', 'aas_et/test', 12);

    expect(snapshot.isErr()).toBe(true);
    expect(snapshot.unwrapErr().message).toContain('repeated a library page');
    expect(apiJson).toHaveBeenCalledTimes(2);
});

test('snapshot deduplicates media keys across pages while retaining chunk order', async () => {
    const apiJson = vi.spyOn(api, 'apiJson').mockImplementation(() => apiResult(page([], '')));
    apiJson.mockReturnValueOnce(
        apiResult(page([remoteFile('part-1', 1), remoteFile('part-0')], 'page-two'))
    );
    apiJson.mockReturnValueOnce(
        apiResult(page([remoteFile('part-1', 1), remoteFile('part-2', 2)], ''))
    );

    const snapshot = await readLibrarySnapshot('test@example.com', 'aas_et/test', 10);

    if (snapshot.isErr()) throw snapshot.unwrapErr();
    expect(snapshot.unwrap().items.map(({ mediaKey }) => mediaKey)).toEqual([
        'part-1',
        'part-0',
        'part-2'
    ]);
    expect(snapshot.unwrap().pages).toBe(2);
    expect(apiJson).toHaveBeenCalledTimes(2);
});

test('empty pages with new page tokens are followed until the library ends', async () => {
    const apiJson = vi.spyOn(api, 'apiJson').mockImplementation(() => apiResult(page([], '')));
    apiJson.mockReturnValueOnce(apiResult(page([], 'empty-page-two')));
    apiJson.mockReturnValueOnce(apiResult(page([remoteFile('last-item')], '')));

    const snapshot = await readLibrarySnapshot('test@example.com', 'aas_et/test', 10);

    if (snapshot.isErr()) throw snapshot.unwrapErr();
    expect(snapshot.unwrap().items.map(({ mediaKey }) => mediaKey)).toEqual(['last-item']);
    expect(snapshot.unwrap().pages).toBe(2);
    expect(apiJson).toHaveBeenCalledTimes(2);
});

test('load more deduplicates chunks and disables further loading after a cyclic token', async () => {
    const apiJson = vi.spyOn(api, 'apiJson').mockImplementation(() => apiResult(page([], '')));
    const drive = new DriveController();
    drive.initialize();
    await new Promise((resolve) => setTimeout(resolve, 0));
    apiJson.mockClear();
    apiJson.mockImplementation(() => apiResult(page([], '')));
    apiJson.mockReturnValueOnce(apiResult(page([remoteFile('part-0')], 'page-two')));
    apiJson.mockReturnValueOnce(
        apiResult(page([remoteFile('part-0'), remoteFile('part-1', 1)], 'page-two'))
    );

    await drive.library.load();
    await drive.library.load(false);
    expect(drive.feedbackMessage).toContain('repeated a library page');
    expect(drive.library.nextPageToken).toBe('');
    await drive.library.load(false);

    expect(drive.library.chunks.map(({ mediaKey }) => mediaKey)).toEqual(['part-0', 'part-1']);
    expect(apiJson).toHaveBeenCalledTimes(2);
});
