import { createHash } from 'node:crypto';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { ThemeMode, UploadJobStatus, UploadStatus } from '#lib/models';
import type { UploadedChunk } from '#lib/files';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';
import { findBmpBySha1, uploadBmp } from '#server/photos';
import type { Fetcher } from '#server/fetcher';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, value);
        }
    };

    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/fake-test-token' }));
});

afterAll(() => vi.unstubAllGlobals());

function varint(value: number): Buffer {
    const result: number[] = [];
    let remaining = value;
    while (remaining > 127) {
        result.push((remaining & 127) | 128);
        remaining >>>= 7;
    }
    result.push(remaining);
    return Buffer.from(result);
}

function bytes(field: number, value: Uint8Array | string): Buffer {
    const body = Buffer.from(value);
    return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
}

function confirmedChunk(name: string, index: number): UploadedChunk {
    const fileHash = createHash('sha256').update(name).digest('hex');
    const bmp = Buffer.from(`confirmed-${name}-${index}`);

    return {
        email: 'test@example.com',
        fileHash,
        fileId: fileHash,
        chunkIndex: index,
        isLast: true,
        originalName: name,
        size: bmp.length,
        at: Date.now(),
        mediaKey: `key-${name}-${index}`,
        sha1: createHash('sha1').update(bmp).digest('hex')
    };
}

test('partial confirmations survive one failed file while others finish; retry is explicit and scoped', async () => {
    const sources = [
        new File(['partial'], 'partial.bin'),
        new File(['complete'], 'complete.bin'),
        new File(['also complete'], 'other.bin')
    ];
    let attempt = 0;
    let releaseActiveCommits = () => {};
    const activeCommits = new Promise<void>((resolve) => {
        releaseActiveCommits = resolve;
    });
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _token, _workers, onJob, onChunk) => {
            attempt++;
            const submitted = filesApi.createUploadJobs(files);

            return Ok(undefined).andThenAsync(async () => {
                if (attempt === 1) {
                    onChunk(confirmedChunk('partial.bin', 0));
                    onJob({
                        ...submitted[0],
                        status: UploadJobStatus.Error,
                        message: 'Commit outcome uncertain. Check Google Photos before retrying.'
                    });

                    await activeCommits;

                    for (const job of submitted.slice(1)) {
                        onChunk(confirmedChunk(job.name, 0));
                        onJob({
                            ...job,
                            status: UploadJobStatus.Complete,
                            result: {
                                status: UploadStatus.Uploaded,
                                mediaKey: `key-${job.name}`,
                                sha1: '0'.repeat(40)
                            }
                        });
                    }
                } else {
                    expect(files.map((file) => file.name)).toEqual(['partial.bin']);
                    onChunk(confirmedChunk('partial.bin', 0));
                    onChunk({ ...confirmedChunk('partial.bin', 0), chunkIndex: 1, isLast: true });
                    onJob({
                        ...submitted[0],
                        status: UploadJobStatus.Complete,
                        result: {
                            status: UploadStatus.AlreadyExists,
                            mediaKey: 'found-by-dedup-lookup',
                            sha1: '1'.repeat(40)
                        }
                    });
                }

                return Ok(undefined);
            });
        });
    const drive = new DriveController();
    drive.initialize();

    const uploading = drive.upload(sources);
    await vi.waitFor(() => expect(drive.uploadJobs[0].status).toBe(UploadJobStatus.Error));
    expect(drive.busy).toBe(true);
    await drive.retryUpload(0);
    expect(upload).toHaveBeenCalledTimes(1);
    releaseActiveCommits();
    await uploading;

    expect(drive.uploadJobs.map((job) => job.status)).toEqual([
        UploadJobStatus.Error,
        UploadJobStatus.Complete,
        UploadJobStatus.Complete
    ]);
    expect(drive.library.chunks.map((chunk) => chunk.originalName)).toEqual([
        'other.bin',
        'complete.bin',
        'partial.bin'
    ]);
    const partial = drive.library.chunks.find((chunk) => chunk.originalName === 'partial.bin');
    expect(partial?.chunkIndex).toBe(0);
    expect(upload).toHaveBeenCalledTimes(1);

    await drive.retryUpload(0);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][0]).toEqual([sources[0]]);
    expect(drive.uploadJobs.map((job) => job.status)).toEqual([
        UploadJobStatus.Complete,
        UploadJobStatus.Complete,
        UploadJobStatus.Complete
    ]);
    expect(
        drive.library.chunks.filter((chunk) => chunk.originalName === 'partial.bin')
    ).toHaveLength(2);
});

test('a commit timeout is not automatically retried, and an explicit dedup lookup can resolve it', async () => {
    const bmp = Buffer.from('synthetic protocol fixture');
    const sha1 = createHash('sha1').update(bmp).digest();
    const missing = bytes(1, bytes(2, bytes(1, bytes(1, sha1))));
    const scotty = Buffer.from([8, 2, 18, 1, 7]);
    const found = bytes(
        1,
        bytes(
            2,
            Buffer.concat([bytes(1, bytes(1, sha1)), bytes(2, bytes(1, 'resolved-media-key'))])
        )
    );
    let requestCount = 0;
    let startCount = 0;
    let transferCount = 0;
    let commitCount = 0;

    const fakeFetch: Fetcher = async (input) => {
        requestCount++;
        const url = String(input);

        if (url.includes('android.googleapis.com/auth'))
            return new Response(`Auth=fake-bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        if (url.includes('/5084965799730810217')) return new Response(Uint8Array.from(missing));
        if (url.includes('upload_id=synthetic-upload')) {
            transferCount++;
            return new Response(scotty);
        }
        if (url.startsWith('https://photos.googleapis.com/data/upload/')) {
            startCount++;
            return new Response(null, { headers: { 'X-GUploader-UploadID': 'synthetic-upload' } });
        }
        if (url.includes('/16538846908252377752')) {
            commitCount++;
            const cause = Object.assign(new Error('synthetic timeout'), {
                code: 'UND_ERR_CONNECT_TIMEOUT'
            });
            throw new TypeError('synthetic fetch failure', { cause });
        }
        return new Response('unexpected synthetic protocol request', { status: 500 });
    };

    const failed = await uploadBmp(
        'test@example.com',
        'aas_et/fake-test-token',
        'synthetic.bmp',
        bmp,
        fakeFetch
    );

    expect(failed.match({ Ok: () => '', Err: (error) => error.message })).toBe(
        'Commit outcome uncertain. Check Google Photos before retrying.'
    );
    expect({ requestCount, startCount, transferCount, commitCount }).toEqual({
        requestCount: 5,
        startCount: 1,
        transferCount: 1,
        commitCount: 1
    });

    const lookupFetch: Fetcher = async (input) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth'))
            return new Response(`Auth=fake-bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        if (url.includes('/5084965799730810217')) return new Response(Uint8Array.from(found));

        return new Response('unexpected synthetic lookup request', { status: 500 });
    };
    const lookup = await findBmpBySha1(
        'test@example.com',
        'aas_et/fake-test-token',
        sha1.toString('hex'),
        lookupFetch
    );

    expect(lookup.match({ Ok: (key) => key, Err: () => null })).toBe('resolved-media-key');
    expect({ requestCount, startCount, transferCount, commitCount }).toEqual({
        requestCount: 5,
        startCount: 1,
        transferCount: 1,
        commitCount: 1
    });
});
