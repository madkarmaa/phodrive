import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { UploadStatus } from '@madkarmaa/phodrive-core/models';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import * as photos from '@madkarmaa/phodrive-core/server/photos';
import { uploadForm, TEST_ACCOUNT } from '../../../core/tests/helpers/upload';

afterEach(() => vi.restoreAllMocks());

test('leaving a stream lets an already started commit settle without retaining input files', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
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
