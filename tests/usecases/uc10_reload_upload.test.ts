import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { UploadStatus } from '$lib/models';
import { receiveUpload } from '$server/upload-input';
import { uploadStream } from '$server/upload-stream';
import * as photos from '$server/photos';
import { uploadForm } from '../helpers/upload';

afterEach(() => vi.restoreAllMocks());

test('leaving a stream lets an already started commit settle without retaining input files', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    let started = false;
    let settled = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    vi.spyOn(photos, 'uploadBmpStream').mockImplementation((_email, _token, _name, source) =>
        source.drain().andThenAsync(async () => {
            started = true;
            await gate;
            settled = true;
            return Ok({
                status: UploadStatus.Uploaded,
                mediaKey: 'confirmed-key',
                sha1: source.sha1
            });
        })
    );
    const response = uploadStream(input);
    await vi.waitFor(() => expect(started).toBe(true));
    await response.body!.cancel();
    expect(settled).toBe(false);
    release();
    await vi.waitFor(() => expect(settled).toBe(true));
    expect('directory' in input).toBe(false);
});
