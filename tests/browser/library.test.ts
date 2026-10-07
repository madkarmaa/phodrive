import { afterEach, expect, test, vi } from 'vitest';
import { readLibrarySnapshot } from '#browser/library';
import type { RemoteBmp } from '#lib/models';

afterEach(() => vi.restoreAllMocks());

function remoteFile(mediaKey: string): RemoteBmp {
    return {
        mediaKey,
        fileHash: '0'.repeat(64),
        fileId: '0'.repeat(64),
        sha1: '0'.repeat(40),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1
    };
}

test('refresh reads the loaded pagination depth and stops when the library ends', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('new-upload')], nextPageToken: 'page-two' })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('existing-file')], nextPageToken: '' })
    );

    const refreshed = await readLibrarySnapshot('test@example.com', 'aas_et/test', 3);

    expect(refreshed.unwrap().items.map((item) => item.mediaKey)).toEqual([
        'new-upload',
        'existing-file'
    ]);
    expect(refreshed.unwrap().pages).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
        JSON.stringify({ email: 'test@example.com', token: 'aas_et/test', pageToken: 'page-two' })
    );
});

test('a failed later page rejects the refresh instead of returning a partial replacement', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('new-upload')], nextPageToken: 'page-two' })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ error: 'Library unavailable' }, { status: 503 })
    );

    const refreshed = await readLibrarySnapshot('test@example.com', 'aas_et/test', 2);

    expect(refreshed.unwrapErr().message).toBe('Library unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
