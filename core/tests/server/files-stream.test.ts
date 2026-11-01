import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Err, Ok } from 'results-ts';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { decodeSplitHeader } from '@madkarmaa/phodrive-core/server/bmp';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { asyncOk, serveBmps } from '../helpers/photos-mock';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function fixture() {
    const data = downloadFixture();
    serveBmps(data.bmps);

    return data;
}

test('first bytes arrive before a full photo is read; a slow consumer prevents read-ahead', async () => {
    const original = Buffer.alloc(2_000_000, 0x2a);
    const { input, bmps } = downloadFixture(original, 'large.bin', [original]);
    let received = 0;
    const cancelled = vi.fn();
    let signal: AbortSignal | undefined;
    vi.mocked(downloadBmp).mockImplementation(
        (_email, _token, _key, _sha1, _fetcher, transferSignal) => {
            signal = transferSignal;
            return asyncOk(
                bmpResponse(bmps[0], 1024, {
                    onRead: (bytes) => {
                        received += bytes;
                    },
                    onCancel: cancelled
                })
            );
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
        asyncOk(bmpResponse(bmps[0], 256, { onCancel: cancelled }))
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
    vi.mocked(downloadBmp).mockImplementation(() => asyncOk(response));

    const downloaded = await downloadFile(input, abort.signal);
    const reader = downloaded.unwrap().body!.getReader();
    const pending = reader.read();
    abort.abort();
    await expect(pending).rejects.toEqual(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
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
        serveBmps(bmps, 256, { onCancel: cancelled });

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
            : asyncOk(bmpResponse(bmps[0]))
    );
    const downloaded = await downloadFile(input);
    const reader = downloaded.unwrap().body!.getReader();
    const first = await reader.read();
    expect(first.value).toEqual(Uint8Array.from([0, 255, 13]));
    expect(downloadBmp).toHaveBeenCalledOnce();
    await expect(reader.read()).rejects.toEqual(failure);
});
