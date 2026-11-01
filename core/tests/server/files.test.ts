import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { downloadFile, deleteFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp, moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { asyncOk, serveBmps } from '../helpers/photos-mock';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

beforeEach(() => {
    vi.mocked(moveToTrash).mockImplementation(() => asyncOk(undefined));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function fixture() {
    const data = downloadFixture();
    serveBmps(data.bmps);

    return data;
}

test('server streams ordered raw bytes without allocating temporary storage', async () => {
    const { input, original } = fixture();
    const result = await downloadFile({ ...input, chunks: input.chunks.toReversed() });
    const response = result.unwrap();
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.has('content-length')).toBe(false);
    expect(downloadBmp).toHaveBeenCalledTimes(1);

    const bytes = await response.arrayBuffer();
    expect(Buffer.from(bytes)).toEqual(Buffer.from(original));
    expect(downloadBmp).toHaveBeenCalledTimes(2);
});

test.each([1, 2, 7, 129, 65_536])(
    'headers and payloads split across %i-byte network blocks restore Unicode filenames',
    async (blockSize) => {
        const original = Buffer.from([0, 255, 13, 10, 42]);
        const { input, bmps } = downloadFixture(original, '写真 🎉.bin');
        serveBmps(bmps, blockSize);
        const downloaded = await downloadFile(input);
        const bytes = await downloaded.unwrap().arrayBuffer();
        expect(Buffer.from(bytes)).toEqual(original);
    }
);

test('a zero-byte last chunk still verifies its BMP and the complete file hash', async () => {
    const original = Buffer.from([0, 255, 42]);
    const { input, bmps } = downloadFixture(original, 'trailing-empty.bin', [
        original,
        new Uint8Array()
    ]);
    serveBmps(bmps, 256);
    const downloaded = await downloadFile(input);
    const bytes = await downloaded.unwrap().arrayBuffer();
    expect(Buffer.from(bytes)).toEqual(original);
    expect(downloadBmp).toHaveBeenCalledTimes(2);
});

test('oversized requested headers are rejected before any network allocation', async () => {
    const { input } = fixture();
    const name = 'a'.repeat(65_536);
    const downloaded = await downloadFile({
        ...input,
        name,
        chunks: input.chunks.map((chunk) =>
            chunk.chunkIndex === 0 ? { ...chunk, originalName: name } : chunk
        )
    });
    expect(downloaded.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_CHUNK_METADATA);
    expect(downloadBmp).not.toHaveBeenCalled();
});

test('incomplete and empty groups fail before contacting Photos; incorrect first metadata cancels its body', async () => {
    const { input, bmps } = fixture();
    for (const chunks of [[], input.chunks.slice(0, 1)]) {
        const incomplete = await downloadFile({ ...input, chunks });
        expect(incomplete.unwrapErr()).toEqual(SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS);
    }
    expect(downloadBmp).not.toHaveBeenCalled();

    const cancelled = vi.fn();
    vi.mocked(downloadBmp).mockImplementation(() =>
        asyncOk(bmpResponse(bmps[0], 1024, { onCancel: cancelled }))
    );
    const wrongSize = await downloadFile({
        ...input,
        chunks: input.chunks.map((chunk) => ({ ...chunk, size: 99 }))
    });
    expect(wrongSize.unwrapErr()).toEqual(SERVER_ERRORS.DOWNLOAD_CHUNK_MISMATCH);
    expect(cancelled).toHaveBeenCalledOnce();
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
            return sha1 === input.chunks[0].sha1
                ? Err({ code: 'REQUEST_FAILED', message: 'Delete failed' } as const)
                : Ok(undefined);
        })
    );
    const chunks = Array.from({ length: 5 }, (_, index) => ({
        ...input.chunks[index % 2],
        chunkIndex: index,
        mediaKey: `chunk-${index}`
    }));
    const result = await deleteFile({ ...input, action: FileActionKind.Delete, chunks });
    expect(result.unwrap().deleted).toHaveLength(2);
    expect(result.unwrap().error).toBe('Delete failed');
    expect(attempted).toBe(chunks.length);
    expect(peak).toBe(input.workers);
    expect(active).toBe(0);
});
