import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { Err, Ok } from 'results-ts';
import { FileActionKind, type FileRequest, type RemoteBmp } from '$lib/models';
import { encodeSplitBmp } from '$server/bmp';
import { downloadFile } from '$server/files';
import { downloadBmp } from '$server/photos';
import * as temporary from '$server/temporary-files';

vi.mock('$server/photos', () => ({ downloadBmp: vi.fn(), moveToTrash: vi.fn() }));

const ORIGINAL = Buffer.from('original file bytes');
const FILE_HASH = createHash('sha256').update(ORIGINAL).digest('hex');
const directories: string[] = [];

beforeEach(() => {
    const createDirectory = temporary.createTemporaryDirectory;
    vi.spyOn(temporary, 'createTemporaryDirectory').mockImplementation(() =>
        createDirectory().inspect((directory) => directories.push(directory))
    );
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const directory of directories.splice(0))
        await temporary.removeTemporaryDirectory(directory);
});

function setup(): { input: FileRequest; bmps: Buffer[] } {
    const payloads = [ORIGINAL.subarray(0, 8), ORIGINAL.subarray(8)];
    const bmps = payloads.map((payload, index) =>
        Buffer.from(
            encodeSplitBmp(payload, {
                fileHash: FILE_HASH,
                fileId: FILE_HASH,
                chunkIndex: index,
                flags: index === 1 ? 1 : 0,
                payloadSize: payload.length,
                fileName: index === 0 ? 'sample.bin' : undefined
            }).unwrap()
        )
    );
    const chunks: RemoteBmp[] = bmps.map((bmp, index) => ({
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex: index,
        isLast: index === 1,
        originalName: index === 0 ? 'sample.bin' : undefined,
        size: payloads[index].length,
        at: 1,
        mediaKey: `part-${index}`,
        sha1: createHash('sha1').update(bmp).digest('hex')
    }));
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        Ok(bmps[Number(key.slice(-1))]).andThenAsync(async (bmp) => Ok(bmp))
    );

    return {
        input: {
            action: FileActionKind.Download,
            email: 'user@example.test',
            token: 'fake-token',
            name: 'sample.bin',
            fileHash: FILE_HASH,
            fileId: FILE_HASH,
            chunks,
            workers: 2
        },
        bmps
    };
}

async function expectTemporaryDirectoriesRemoved(): Promise<void> {
    for (const directory of directories) await expect(access(directory)).rejects.toThrow();
}

test('incomplete groups and a failed remote chunk return an error without a response', async () => {
    const { input } = setup();
    const incomplete = await downloadFile({ ...input, chunks: input.chunks.slice(1) });
    expect(incomplete.isErr()).toBe(true);
    expect(incomplete.unwrapErr().message).toContain('remaining');
    expect(downloadBmp).not.toHaveBeenCalled();

    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        key === 'part-1'
            ? Err(new Error('remote chunk unavailable')).andThenAsync(async () =>
                  Ok(Buffer.alloc(0))
              )
            : Ok(Buffer.alloc(0)).andThenAsync(async (bmp) => Ok(bmp))
    );
    const failed = await downloadFile(input);
    expect(failed.isErr()).toBe(true);
    expect(failed.unwrapErr()).toBeInstanceOf(Error);
    await expectTemporaryDirectoriesRemoved();
});

test('shuffled valid chunks reconstruct in order; mismatched metadata and damaged bytes fail cleanly', async () => {
    const { input, bmps } = setup();
    const shuffled = await downloadFile({ ...input, chunks: input.chunks.toReversed() });
    expect(Buffer.from(await shuffled.unwrap().arrayBuffer())).toEqual(ORIGINAL);
    await expectTemporaryDirectoriesRemoved();

    const wrongIndex = await downloadFile({
        ...input,
        chunks: input.chunks.map((chunk) =>
            chunk.chunkIndex === 1 ? { ...chunk, chunkIndex: 2 } : chunk
        )
    });
    expect(wrongIndex.isErr()).toBe(true);

    bmps[1][bmps[1].length - 1] ^= 1;
    const corrupted = await downloadFile(input);
    expect(corrupted.isErr()).toBe(true);
    expect(corrupted.unwrapErr().message).toMatch(/damaged|integrity|Invalid chunk|match|SHA-256/i);
    await expectTemporaryDirectoriesRemoved();
});
