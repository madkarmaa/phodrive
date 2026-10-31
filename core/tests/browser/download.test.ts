import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { downloadFile } from '@madkarmaa/phodrive-core/browser/files';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';

afterEach(() => vi.restoreAllMocks());

const PAYLOAD = Buffer.from('bytes the browser verifies and rebuilds itself');
const NAME = 'decoded.bin';
const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');
const FILE_ID = fileIdentity(NAME, FILE_HASH);
const BMP = encodeSplitBmp(PAYLOAD, {
    fileHash: FILE_HASH,
    fileId: FILE_ID,
    chunkIndex: 0,
    flags: 1,
    payloadSize: PAYLOAD.length,
    fileName: NAME
}).unwrap();

function group() {
    return groupChunks([
        {
            email: 'test@example.com',
            fileHash: FILE_HASH,
            fileId: FILE_ID,
            chunkIndex: 0,
            isLast: true,
            originalName: NAME,
            size: PAYLOAD.length,
            at: 1,
            mediaKey: 'media-key',
            sha1: createHash('sha1').update(BMP).digest('hex')
        }
    ])[0];
}

test('browser mode fetches raw chunks and rebuilds the original bytes', async () => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(Uint8Array.from(BMP)));

    const downloaded = await downloadFile(group(), ProcessingMode.Browser);
    const bytes = new Uint8Array(await downloaded.unwrap().arrayBuffer());

    expect(Buffer.from(bytes).equals(PAYLOAD)).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe('/api/chunk');
    expect(fetch.mock.calls[0][1]?.body).toBe(
        JSON.stringify({ mediaKey: 'media-key', sha1: group().chunks[0].sha1 })
    );
});

test('a damaged chunk fails the integrity check instead of returning bytes', async () => {
    const damaged = Uint8Array.from(BMP);
    damaged[BMP.length - PAYLOAD.length - 1] ^= 1;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(damaged));

    const downloaded = await downloadFile(group(), ProcessingMode.Browser);

    expect(downloaded.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
});

test('a truncated chunk is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(Uint8Array.from(BMP.subarray(0, BMP.length - 1)))
    );

    const downloaded = await downloadFile(group(), ProcessingMode.Browser);

    expect(downloaded.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
});

test('an incomplete file is refused before any chunk is fetched', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');

    const downloaded = await downloadFile({ ...group(), complete: false }, ProcessingMode.Browser);

    expect(downloaded.unwrapErr().code).toBe('INCOMPLETE_DOWNLOAD_CHUNKS');
    expect(fetch).not.toHaveBeenCalled();
});
