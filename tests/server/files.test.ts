import { SERVER_ERRORS } from '$server/errors';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Err, Ok } from 'results-ts';
import { downloadFile, deleteFile } from '$server/files';
import { downloadBmp, moveToTrash } from '$server/photos';
import { decodeSplitHeader } from '$server/bmp';
import * as temporary from '$server/temporary-files';
import { FileActionKind } from '$lib/models';
import { bmpResponse, downloadFixture } from '../helpers/download';

vi.mock('$server/photos', () => ({ downloadBmp: vi.fn(), moveToTrash: vi.fn() }));

beforeEach(() => {
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function fixture() {
    const data = downloadFixture();
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        Ok(bmpResponse(data.bmps[Number(key.slice(-1))])).andThenAsync(async (response) =>
            Ok(response)
        )
    );
    return data;
}

test('server streams ordered raw bytes without allocating temporary storage', async () => {
    const { input, original } = fixture();
    const storage = vi.spyOn(temporary, 'createTemporaryDirectory');
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
    expect(storage).not.toHaveBeenCalled();
});

test.each([1, 2, 7, 129, 65_536])(
    'headers and payloads split across %i-byte network blocks restore Unicode filenames',
    async (blockSize) => {
        const original = Buffer.from([0, 255, 13, 10, 42]);
        const { input, bmps } = downloadFixture(original, '写真 🎉.bin');
        vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
            Ok(bmpResponse(bmps[Number(key.slice(-1))], blockSize)).andThenAsync(async (response) =>
                Ok(response)
            )
        );
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
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        Ok(bmpResponse(bmps[Number(key.slice(-1))], 256)).andThenAsync(async (response) =>
            Ok(response)
        )
    );
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

test('first bytes arrive before a full photo is read; a slow consumer prevents read-ahead', async () => {
    const original = Buffer.alloc(2_000_000, 0x2a);
    const { input, bmps } = downloadFixture(original, 'large.bin', [original]);
    let received = 0;
    const cancelled = vi.fn();
    let signal: AbortSignal | undefined;
    vi.mocked(downloadBmp).mockImplementation(
        (_email, _token, _key, _sha1, _fetcher, transferSignal) => {
            signal = transferSignal;
            return Ok(
                bmpResponse(bmps[0], 1024, {
                    onRead: (bytes) => {
                        received += bytes;
                    },
                    onCancel: cancelled
                })
            ).andThenAsync(async (response) => Ok(response));
        }
    );

    const result = await downloadFile(input);
    const body = result.unwrap().body!;
    expect(received).toBe(1024);
    const reader = body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value!.length).toBeGreaterThan(0);
    expect(received).toBe(1024);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toBe(1024);

    await reader.cancel();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
    expect(downloadBmp).toHaveBeenCalledOnce();
});

test('cancellation before reading cancels the first upstream body without requesting later chunks', async () => {
    const { input, bmps } = fixture();
    const cancelled = vi.fn();
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(bmpResponse(bmps[0], 256, { onCancel: cancelled })).andThenAsync(async (response) =>
            Ok(response)
        )
    );
    const downloaded = await downloadFile(input);
    await downloaded.unwrap().body!.cancel();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(downloadBmp).toHaveBeenCalledOnce();
});

test('request abort errors a pending downstream read and cancels the upstream body', async () => {
    const original = Buffer.alloc(2000, 1);
    const { input, bmps } = downloadFixture(original, 'abort.bin', [original]);
    const offset = decodeSplitHeader(bmps[0], bmps[0].length).unwrap().payloadOffset;
    const cancelled = vi.fn();
    const abort = new AbortController();
    let first = true;
    const response = new Response(
        new ReadableStream<Uint8Array>(
            {
                pull(controller) {
                    if (!first) return;
                    first = false;
                    controller.enqueue(bmps[0].subarray(0, offset));
                },
                cancel: cancelled
            },
            { highWaterMark: 0 }
        ),
        { headers: { 'content-type': 'image/bmp' } }
    );
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(response).andThenAsync(async (value) => Ok(value))
    );

    const downloaded = await downloadFile(input, abort.signal);
    const reader = downloaded.unwrap().body!.getReader();
    const pending = reader.read();
    abort.abort();
    await expect(pending).rejects.toEqual(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
    expect(cancelled).toHaveBeenCalledOnce();
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
        Ok(bmpResponse(bmps[0], 1024, { onCancel: cancelled })).andThenAsync(async (response) =>
            Ok(response)
        )
    );
    const wrongSize = await downloadFile({
        ...input,
        chunks: input.chunks.map((chunk) => ({ ...chunk, size: 99 }))
    });
    expect(wrongSize.unwrapErr()).toEqual(SERVER_ERRORS.DOWNLOAD_CHUNK_MISMATCH);
    expect(cancelled).toHaveBeenCalledOnce();
});

test.each(['padding', 'sha1', 'sha256', 'truncated', 'extra', 'header'] as const)(
    'stream completion fails on %s corruption',
    async (damage) => {
        const { input, bmps } = fixture();
        const cancelled = vi.fn();
        const decoded = decodeSplitHeader(bmps[1], bmps[1].length).unwrap();
        let expected:
            | typeof SERVER_ERRORS.INVALID_DOWNLOADED_BMP
            | typeof SERVER_ERRORS.DOWNLOAD_INTEGRITY_FAILED
            | typeof SERVER_ERRORS.FILE_INTEGRITY_FAILED = SERVER_ERRORS.INVALID_DOWNLOADED_BMP;
        if (damage === 'padding') bmps[1][bmps[1].length - 1] = 1;
        if (damage === 'sha1' || damage === 'sha256') {
            bmps[1][decoded.payloadOffset] ^= 1;
            expected =
                damage === 'sha1'
                    ? SERVER_ERRORS.DOWNLOAD_INTEGRITY_FAILED
                    : SERVER_ERRORS.FILE_INTEGRITY_FAILED;
            if (damage === 'sha256')
                input.chunks[1].sha1 = createHash('sha1').update(bmps[1]).digest('hex');
        }
        if (damage === 'truncated') bmps[1] = bmps[1].subarray(0, bmps[1].length - 1);
        if (damage === 'extra') bmps[1] = Buffer.concat([bmps[1], Buffer.from([0])]);
        if (damage === 'header') bmps[1][0] = 0;
        vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
            Ok(bmpResponse(bmps[Number(key.slice(-1))], 256, { onCancel: cancelled })).andThenAsync(
                async (response) => Ok(response)
            )
        );

        const downloaded = await downloadFile(input);
        await expect(downloaded.unwrap().arrayBuffer()).rejects.toEqual(expected);
        if (damage === 'padding' || damage === 'extra' || damage === 'header')
            expect(cancelled).toHaveBeenCalledOnce();
    }
);

test('a later Photos failure errors the response after earlier bytes have arrived', async () => {
    const { input, bmps } = fixture();
    const failure = { code: 'REQUEST_FAILED', message: 'Download failed' } as const;
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        key === 'chunk-1'
            ? Err(failure).andThenAsync(async () => Ok(new Response()))
            : Ok(bmpResponse(bmps[0])).andThenAsync(async (response) => Ok(response))
    );
    const downloaded = await downloadFile(input);
    const reader = downloaded.unwrap().body!.getReader();
    const first = await reader.read();
    expect(first.value).toEqual(Uint8Array.from([0, 255, 13]));
    expect(downloadBmp).toHaveBeenCalledOnce();
    await expect(reader.read()).rejects.toEqual(failure);
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
