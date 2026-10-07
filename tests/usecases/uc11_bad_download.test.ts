import { afterEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { downloadFile } from '$server/files';
import { downloadBmp } from '$server/photos';
import { bmpResponse, downloadFixture } from '../helpers/download';

vi.mock('$server/photos', () => ({ downloadBmp: vi.fn(), moveToTrash: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function setup() {
    const original = Buffer.from('original file bytes');
    const fixture = downloadFixture(original, 'sample.bin', [
        original.subarray(0, 8),
        original.subarray(8)
    ]);
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        Ok(bmpResponse(fixture.bmps[Number(key.slice(-1))])).andThenAsync(async (response) =>
            Ok(response)
        )
    );
    return fixture;
}

test('incomplete groups return an error and a failed later chunk aborts the download body', async () => {
    const { input, bmps } = setup();
    const incomplete = await downloadFile({ ...input, chunks: input.chunks.slice(1) });
    expect(incomplete.isErr()).toBe(true);
    expect(incomplete.unwrapErr().message).toContain('remaining');
    expect(downloadBmp).not.toHaveBeenCalled();

    const failure = { code: 'REQUEST_FAILED', message: 'remote chunk unavailable' } as const;
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        key === 'chunk-1'
            ? Err(failure).andThenAsync(async () => Ok(new Response()))
            : Ok(bmpResponse(bmps[0])).andThenAsync(async (response) => Ok(response))
    );
    const failed = await downloadFile(input);
    await expect(failed.unwrap().arrayBuffer()).rejects.toEqual(failure);
});

test('shuffled valid chunks stream in order; mismatched metadata and damaged bytes fail cleanly', async () => {
    const { input, bmps, original } = setup();
    const shuffled = await downloadFile({ ...input, chunks: input.chunks.toReversed() });
    const bytes = await shuffled.unwrap().arrayBuffer();
    expect(Buffer.from(bytes)).toEqual(original);

    const wrongIndex = await downloadFile({
        ...input,
        chunks: input.chunks.map((chunk) =>
            chunk.chunkIndex === 1 ? { ...chunk, chunkIndex: 2 } : chunk
        )
    });
    expect(wrongIndex.isErr()).toBe(true);

    bmps[1][bmps[1].length - 1] ^= 1;
    const corrupted = await downloadFile(input);
    await expect(corrupted.unwrap().arrayBuffer()).rejects.toMatchObject({
        message: 'Downloaded BMP is invalid or damaged'
    });
});
