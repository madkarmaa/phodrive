import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileActionKind, ThemeMode, type RemoteBmp } from '$lib/models';
import { DriveController } from '$browser/drive.svelte';

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

afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ 'owner@example.com': 'aas_et/synthetic' }));
});

function remoteChunk(overrides: Partial<RemoteBmp> = {}): RemoteBmp {
    return {
        fileHash: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: false,
        originalName: 'archive.bin',
        size: 5,
        at: 1,
        mediaKey: 'shared-media-key',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

test('partial delete retains exact confirmations, retries remaining chunks, and preserves unrelated files', async () => {
    const first = remoteChunk();
    const remaining = remoteChunk({
        chunkIndex: 1,
        isLast: true,
        originalName: undefined,
        mediaKey: 'remaining-media-key',
        sha1: 'c'.repeat(40)
    });
    const unrelated = remoteChunk({
        fileHash: 'd'.repeat(64),
        isLast: true,
        originalName: 'other-account.bin'
    });
    const fetchBodies: unknown[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON delete request.');
        const body: unknown = JSON.parse(init.body);
        fetchBodies.push(body);

        if (fetchBodies.length === 1)
            return Response.json({ deleted: [first], error: 'One chunk failed' });

        return Response.json({ deleted: [remaining] });
    });

    const drive = new DriveController();
    drive.initialize();
    drive.uploads = [
        { ...first, email: 'owner@example.com' },
        { ...remaining, email: 'owner@example.com' },
        { ...unrelated, email: 'other@example.com' }
    ];

    const selected = drive.files.find((item) => item.fileHash === first.fileHash);
    if (!selected) throw new Error('Expected selected file group.');
    await drive.actOnFile(selected, FileActionKind.Delete);

    const afterPartial = drive.uploads;
    const retryGroup = drive.files.find((item) => item.fileHash === first.fileHash);
    if (!retryGroup) throw new Error('Expected remaining selected chunks to form a retry group.');
    await drive.actOnFile(retryGroup, FileActionKind.Delete);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchBodies).toMatchObject([
        { chunks: [{ mediaKey: 'shared-media-key' }, { mediaKey: 'remaining-media-key' }] },
        { chunks: [{ mediaKey: 'remaining-media-key' }] }
    ]);
    expect(afterPartial.map((item) => `${item.email}:${item.mediaKey}`)).toEqual([
        'owner@example.com:remaining-media-key',
        'other@example.com:shared-media-key'
    ]);
    expect(drive.uploads).toEqual([{ ...unrelated, email: 'other@example.com' }]);
    expect(drive.galleryMessage).toBe('');
});
