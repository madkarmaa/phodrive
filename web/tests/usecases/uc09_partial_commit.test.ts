import { createHash } from 'node:crypto';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { UploadJobStatus, UploadStatus } from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

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

test('a file appears only once its upload ends, even when a later chunk finishes first', async () => {
    let finishFirstChunk = () => {};
    const firstChunk = new Promise<void>((resolve) => {
        finishFirstChunk = resolve;
    });
    vi.spyOn(filesApi, 'uploadFiles').mockImplementation(
        (files, _email, _workers, onJob, onChunk) => {
            const [job] = filesApi.createUploadJobs(files);

            return Ok(undefined).andThenAsync(async () => {
                onChunk({ ...confirmedChunk('large.bin', 1), originalName: undefined }, job.id);
                await firstChunk;
                onChunk({ ...confirmedChunk('large.bin', 0), isLast: false }, job.id);
                onJob({
                    ...job,
                    status: UploadJobStatus.Complete,
                    result: {
                        status: UploadStatus.Uploaded,
                        mediaKey: 'key-large.bin-0',
                        sha1: '0'.repeat(40)
                    }
                });

                return Ok(undefined);
            });
        }
    );
    const drive = new DriveController('test@example.com');
    drive.initialize();

    const uploading = drive.upload([new File(['large'], 'large.bin')]);
    await vi.waitFor(() => expect(drive.busy).toBe(true));

    expect(drive.library.files).toEqual([]);

    finishFirstChunk();
    await uploading;

    expect(drive.library.files.map((file) => [file.name, file.chunks.length])).toEqual([
        ['large.bin', 2]
    ]);
});

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
        .mockImplementation((files, _email, _workers, onJob, onChunk) => {
            attempt++;
            const submitted = filesApi.createUploadJobs(files);

            return Ok(undefined).andThenAsync(async () => {
                if (attempt === 1) {
                    onChunk(confirmedChunk('partial.bin', 0), submitted[0].id);
                    onJob({
                        ...submitted[0],
                        status: UploadJobStatus.Error,
                        message: 'Commit outcome uncertain. Check Google Photos before retrying.'
                    });

                    await activeCommits;

                    for (const job of submitted.slice(1)) {
                        onChunk(confirmedChunk(job.name, 0), job.id);
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
                    onChunk(confirmedChunk('partial.bin', 0), submitted[0].id);
                    onChunk(
                        { ...confirmedChunk('partial.bin', 0), chunkIndex: 1, isLast: true },
                        submitted[0].id
                    );
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
    const drive = new DriveController('test@example.com');
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
