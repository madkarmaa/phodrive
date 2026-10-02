import { afterEach, expect, test, vi } from 'vitest';
import { access } from 'node:fs/promises';
import { Err, Ok } from 'results-ts';
import { readLibraryPage } from '$browser/library';
import { UploadEventSchema, UploadEventType, UploadStatus, type RemoteBmp } from '$lib/models';
import { decodeSplitBmp } from '$server/bmp';
import { uploadBmp } from '$server/photos';
import { receiveUpload } from '$server/upload-input';
import { uploadStream } from '$server/upload-stream';
import { removeTemporaryDirectory } from '$server/temporary-files';

vi.mock('$server/photos', () => ({ uploadBmp: vi.fn() }));

const directories: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) await removeTemporaryDirectory(directory);
});

test('leaving an upload settles the active operation, cleans temporary files, and keeps confirmed chunks discoverable', async () => {
    const form = new FormData();
    form.set('email', 'test@example.com');
    form.set('token', 'aas_et/test');
    form.set('workers', '1');
    form.append('file', new File(['first'], 'first.bin'));
    form.append('file', new File(['pending'], 'pending.bin'));

    const received = await receiveUpload(
        new Request('http://localhost/api/upload', { method: 'POST', body: form })
    );
    const input = received.unwrap();
    directories.push(input.directory);

    const confirmed: RemoteBmp[] = [];
    let activeSettled = false;
    let secondUploadStarted = false;
    let releaseSecondUpload: () => void = () => {};
    const secondUploadGate = new Promise<void>((resolve) => {
        releaseSecondUpload = resolve;
    });

    vi.mocked(uploadBmp).mockImplementation((_email, _token, name, bmp) =>
        Ok(undefined).andThenAsync(async () => {
            const header = decodeSplitBmp(bmp).unwrap().header;
            if (name.startsWith('pending.bin.')) {
                secondUploadStarted = true;
                await secondUploadGate;
                activeSettled = true;
                return Err({
                    code: 'REQUEST_FAILED',
                    message: 'Upload transfer failed (HTTP 429)'
                } as const);
            }

            confirmed.push({
                mediaKey: name,
                sha1: '1'.repeat(40),
                fileHash: header.fileHash,
                fileId: header.fileId,
                chunkIndex: header.chunkIndex,
                isLast: header.flags === 1,
                originalName: header.fileName ?? 'first.bin',
                size: header.payloadSize,
                at: 1
            });

            return Ok({ status: UploadStatus.Uploaded, mediaKey: name, sha1: '1'.repeat(40) });
        })
    );

    const response = uploadStream(input);
    const body = response.body;
    expect(body).not.toBeNull();
    if (!body) throw new Error('Upload stream has no response body.');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let foundConfirmedChunk = false;

    while (!foundConfirmedChunk) {
        const next = await reader.read();
        expect(next.done).toBe(false);
        if (next.done) break;

        const line = decoder
            .decode(next.value)
            .split('\n')
            .find((current) => current.startsWith('data: '));
        if (!line) continue;

        const eventValue: unknown = JSON.parse(line.slice(6));
        const event = UploadEventSchema.safeParse(eventValue);
        expect(event.success).toBe(true);
        if (!event.success) continue;
        foundConfirmedChunk = event.data.type === UploadEventType.Chunk;
    }

    expect(foundConfirmedChunk).toBe(true);
    await vi.waitFor(() => expect(secondUploadStarted).toBe(true));
    await reader.cancel();

    await access(input.directory);
    expect(activeSettled).toBe(false);

    releaseSecondUpload();
    await vi.waitFor(() => expect(activeSettled).toBe(true));
    await vi.waitFor(async () => {
        await expect(access(input.directory)).rejects.toThrow();
    });

    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ items: confirmed, nextPageToken: '' }));
    const library = await readLibraryPage('test@example.com', 'aas_et/test');

    expect(library.unwrap().items.map((chunk) => chunk.mediaKey)).toEqual([confirmed[0].mediaKey]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
