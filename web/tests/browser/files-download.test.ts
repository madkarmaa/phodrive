import { FileActionRequestSchema, ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { afterEach, expect, vi, test } from 'vitest';
import { groupChunks, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { downloadFile, deleteFile, saveDownloadedFile } from '#browser/files';
import { chunk, PAYLOAD } from '../helpers/files';

afterEach(() => vi.restoreAllMocks());

test('download asks for one reconstructed file and preserves its original bytes', async () => {
    const group = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON');
        const body: unknown = JSON.parse(init.body);
        expect(body).not.toHaveProperty('token');
        expect(init.body).not.toContain('test@example.com');
        const request = FileActionRequestSchema.parse(body);
        expect(request.action).toBe('download');
        expect(request.chunks).toHaveLength(1);
        return new Response(PAYLOAD);
    });
    const downloaded = await downloadFile(group, ProcessingMode.Server);
    const recovered = await downloaded.unwrap().arrayBuffer();
    expect(new Uint8Array(recovered)).toEqual(PAYLOAD);
    const incomplete = await downloadFile({ ...group, complete: false }, ProcessingMode.Server);
    expect(incomplete.isErr()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('batch deletion reports confirmed chunks even when the server returns partial failure', async () => {
    const group = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const removed: UploadedChunk[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON');
        const request = FileActionRequestSchema.parse(JSON.parse(init.body));
        expect(request.action).toBe('delete');
        expect(request.workers).toBe(2);
        return Response.json({ deleted: [chunk()], error: 'One chunk failed' });
    });
    const result = await deleteFile(group, (item) => removed.push(item), 2);
    expect(result.unwrapErr().message).toBe('One chunk failed');
    expect(removed).toEqual(group.chunks);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('an interrupted download body returns a receive error instead of a partial Blob', async () => {
    const group = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
            new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(Uint8Array.of(1, 2, 3));
                        controller.error(new Error('synthetic late integrity failure'));
                    }
                })
            )
    );

    const downloaded = await downloadFile(group, ProcessingMode.Server);
    expect(downloaded.unwrapErr()).toEqual({
        code: 'DOWNLOAD_RECEIVE_FAILED',
        message: 'Could not receive the downloaded file.'
    });
});

test('a failed browser click still releases the downloaded blob URL', () => {
    vi.useFakeTimers();
    const url = 'blob:download-cleanup';
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(url);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', {
        createElement: () => ({
            click: () => {
                throw new Error('browser rejected download');
            }
        })
    });

    try {
        const saved = saveDownloadedFile(new Blob(['payload']), 'original.bin');

        expect(saved.unwrapErr().code).toBe('DOWNLOAD_SAVE_FAILED');
        vi.runAllTimers();
        expect(revoke).toHaveBeenCalledWith(url);
    } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    }
});
