import { afterEach, expect, test, vi } from 'vitest';
import { UploadJobStatus } from '#lib/models';
import { uploadFiles, type UploadJob } from '#browser/files';
import { decodeSplitBmp, encodeSplitBmp } from '#server/bmp';
import { receiveUpload } from '#server/upload/input';
import { encodeUploadBmp } from '#server/upload/bmp';
import { uploadForm, browserUploadResponse } from '../helpers/upload';

afterEach(() => vi.restoreAllMocks());

test('empty files preserve Unicode, emoji, combining marks, dotfiles, extensionless and long names without spooling', async () => {
    const names = [
        'résumé.png',
        'family-👩‍👩‍👧‍👦.jpg',
        'cafe\u0301.txt',
        '.gitignore',
        'LICENSE',
        `${'long-name-'.repeat(400)}.bin`
    ];
    for (const name of names) {
        const fixture = uploadForm(new Uint8Array(), name);
        const received = await receiveUpload(fixture.request());
        const input = received.unwrap();
        const bmp = encodeUploadBmp(input);
        const drained = await bmp.drain();
        expect(drained.isOk()).toBe(true);
        expect(input.header.fileName).toBe(name);
        const encoded = encodeSplitBmp(new Uint8Array(), input.header).unwrap();
        expect(decodeSplitBmp(encoded).unwrap().header.fileName).toBe(name);
        await input.cancel();
    }
});

test('invalid selected paths and newline names fail while valid empty-file uploads finish', async () => {
    const valid = ['.profile', 'README', 'cafe\u0301.txt', 'emoji-🚀'];
    const invalid = ['folder/file.txt', 'folder\\file.txt', 'line\nbreak.txt', 'line\rbreak.txt'];
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => browserUploadResponse(init));
    const jobs = new Map<number, UploadJob>();
    const uploaded = await uploadFiles(
        [...invalid, ...valid].map((name) => new File([], name)),
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.set(job.id, job),
        () => {}
    );
    expect(uploaded.isOk()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(valid.length);
    expect([...jobs.values()].filter((job) => job.status === UploadJobStatus.Error)).toHaveLength(
        invalid.length
    );
    expect(
        [...jobs.values()].filter((job) => job.status === UploadJobStatus.Complete)
    ).toHaveLength(valid.length);
});
