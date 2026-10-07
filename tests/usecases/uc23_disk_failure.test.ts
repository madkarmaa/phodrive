import { open, mkdtemp, writeFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { downloadFile } from '#server/files';
import { downloadBmp } from '#server/photos';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { uploadForm } from '../helpers/upload';
import { encodeUploadBmp } from '#server/upload/bmp';
import { receiveUpload } from '#server/upload/input';

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return {
        ...actual,
        open: vi.fn().mockRejectedValue(new Error('ENOSPC')),
        mkdtemp: vi.fn().mockRejectedValue(new Error('ENOSPC')),
        writeFile: vi.fn().mockRejectedValue(new Error('ENOSPC'))
    };
});
vi.mock('#server/photos', () => ({ downloadBmp: vi.fn(), moveToTrash: vi.fn() }));
afterEach(() => vi.clearAllMocks());

test('uploads need no temporary storage even when all disk allocations would fail', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    const source = encodeUploadBmp(input);
    const drained = await source.drain();
    expect(drained.isOk()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    await input.cancel();
});

test('downloads need no temporary storage even when all disk allocations would fail', async () => {
    const { input, bmps, original } = downloadFixture();
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        Ok(bmpResponse(bmps[Number(key.slice(-1))])).andThenAsync(async (response) => Ok(response))
    );
    const downloaded = await downloadFile(input);
    const bytes = await downloaded.unwrap().arrayBuffer();
    expect(Buffer.from(bytes)).toEqual(Buffer.from(original));
    expect(open).not.toHaveBeenCalled();
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
});
