import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { Err, Ok } from 'results-ts';
import { downloadFile, deleteFile } from '$server/files';
import { downloadBmp, moveToTrash } from '$server/photos';
import { encodeSplitBmp } from '$server/bmp';
import * as temporary from '$server/temporary-files';
import { FileActionKind, type FileRequest, type RemoteBmp } from '$lib/models';

vi.mock('$server/photos', () => ({ downloadBmp: vi.fn(), moveToTrash: vi.fn() }));
const PAYLOAD = Buffer.from([0, 255, 13, 10, 42]);
const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');
const directories: string[] = [];

beforeEach(() => {
    const createDirectory = temporary.createTemporaryDirectory;
    vi.spyOn(temporary, 'createTemporaryDirectory').mockImplementation(() =>
        createDirectory().inspect((directory) => directories.push(directory))
    );
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});
afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const directory of directories.splice(0))
        await temporary.removeTemporaryDirectory(directory);
});

function fixture(): { input: FileRequest; bmps: Buffer[] } {
    const payloads = [PAYLOAD.subarray(0, 3), PAYLOAD.subarray(3)];
    const bmps = payloads.map((payload, index) =>
        Buffer.from(
            encodeSplitBmp(payload, {
                fileHash: FILE_HASH,
                fileId: FILE_HASH,
                chunkIndex: index,
                flags: index === 1 ? 1 : 0,
                payloadSize: payload.length,
                fileName: index === 0 ? 'proof.bin' : undefined
            }).unwrap()
        )
    );
    const chunks: RemoteBmp[] = bmps.map((bmp, index) => ({
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex: index,
        isLast: index === 1,
        originalName: index === 0 ? 'proof.bin' : undefined,
        size: payloads[index].length,
        at: 1,
        mediaKey: `chunk-${index}`,
        sha1: createHash('sha1').update(bmp).digest('hex')
    }));
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        Ok(bmps[Number(key.slice(-1))]).andThenAsync(async (bmp) => Ok(bmp))
    );
    return {
        input: {
            action: FileActionKind.Download,
            email: 'test@example.com',
            token: 'aas_et/test',
            name: 'proof.bin',
            fileHash: FILE_HASH,
            fileId: FILE_HASH,
            chunks,
            workers: 2
        },
        bmps
    };
}

async function expectCleaned() {
    for (const directory of directories) await expect(access(directory)).rejects.toThrow();
}

test('server downloads, orders, decodes and verifies the original file before returning raw bytes', async () => {
    const { input } = fixture();
    const result = await downloadFile({ ...input, chunks: input.chunks.toReversed() });
    const response = result.unwrap();
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    const bytes = await response.arrayBuffer();
    expect(Buffer.from(bytes)).toEqual(PAYLOAD);
    expect(downloadBmp).toHaveBeenCalledTimes(2);
    await expectCleaned();
});

test('server refuses incomplete groups before downloading and rejects metadata, padding, and whole-file corruption', async () => {
    const { input, bmps } = fixture();
    const incomplete = await downloadFile({ ...input, chunks: input.chunks.slice(0, 1) });
    expect(incomplete.unwrapErr().message).toContain('remaining');
    expect(downloadBmp).not.toHaveBeenCalled();

    const wrongSize = await downloadFile({
        ...input,
        chunks: input.chunks.map((chunk) => ({ ...chunk, size: 99 }))
    });
    expect(wrongSize.unwrapErr().message).toContain('match');
    await expectCleaned();

    bmps[0][bmps[0].length - 1] = 1;
    const damaged = await downloadFile(input);
    expect(damaged.isErr()).toBe(true);
    await expectCleaned();

    bmps[0][bmps[0].length - 1] = 0;
    // Metadata remains valid, but a payload byte changes the complete file hash.
    const metadataBytes = bmps[0].indexOf(Buffer.from('proof.bin')) + 'proof.bin'.length;
    bmps[0][metadataBytes] ^= 1;
    const corrupted = await downloadFile(input);
    expect(corrupted.unwrapErr().message).toContain('SHA-256');
    await expectCleaned();
});

test('temporary output is removed on cancelled downloads and upstream failures', async () => {
    const { input } = fixture();
    const downloaded = await downloadFile(input);
    await downloaded.unwrap().body?.cancel();
    await expectCleaned();
    vi.mocked(downloadBmp).mockImplementation(() =>
        Err(new Error('Download failed')).andThenAsync(async () => Ok(Buffer.alloc(0)))
    );
    const failed = await downloadFile(input);
    expect(failed.isErr()).toBe(true);
    await expectCleaned();
});

test('download cleanup failure takes precedence over an upstream failure', async () => {
    const { input } = fixture();
    vi.mocked(downloadBmp).mockImplementation(() =>
        Err(new Error('Download failed')).andThenAsync(async () => Ok(Buffer.alloc(0)))
    );
    const remove = vi
        .spyOn(temporary, 'removeTemporaryDirectory')
        .mockImplementation(() =>
            Err(new Error('Could not remove temporary file storage.')).andThenAsync(async () =>
                Ok(undefined)
            )
        );

    const failed = await downloadFile(input);
    expect(failed.unwrapErr().message).toBe('Could not remove temporary file storage.');
    expect(remove).toHaveBeenCalledWith(directories[0]);
});

test('server deletion bounds workers, attempts all known chunks and preserves partial confirmation', async () => {
    const { input } = fixture();
    let active = 0;
    let peak = 0;
    let attempted = 0;
    vi.mocked(moveToTrash).mockImplementation((_email, _token, sha1) =>
        Ok(undefined).andThenAsync(async () => {
            active++;
            attempted++;
            peak = Math.max(peak, active);
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
            active--;
            return sha1 === input.chunks[0].sha1 ? Err(new Error('Delete failed')) : Ok(undefined);
        })
    );
    const chunks = Array.from({ length: 5 }, (_, index) => ({
        ...input.chunks[index % 2],
        chunkIndex: index,
        mediaKey: `chunk-${index}`
    }));
    const result = await deleteFile({ ...input, action: FileActionKind.Delete, chunks });
    expect(result.unwrap().deleted).toHaveLength(2);
    expect(result.unwrap().error).toBeTruthy();
    expect(attempted).toBe(chunks.length);
    expect(peak).toBe(input.workers);
    expect(active).toBe(0);
});
