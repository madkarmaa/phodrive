import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { uploadFiles } from '@madkarmaa/phodrive-core/browser/upload';
import { ChunkFormat, ProcessingMode, UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { TEST_ACCOUNT } from '../../core/tests/helpers/upload';
import { CHUNK, files, freshFiles, sum, type Workload } from '../fixtures';
import { provider } from '../transport';

/** The Google Photos fetchers the mocked server module forwards to. */
export interface TransportSlot {
    fetcher: typeof fetch | null;
    fetcherWithProgress: ((callback: (sent: number) => void) => typeof fetch) | null;
}

export interface UploadCase {
    sizes: number[];
    workers?: number;
    /** Google already stores every chunk, so nothing is transferred. */
    duplicate?: boolean;
    /** Every commit fails, then the same files are uploaded again. */
    retry?: boolean;
}

/** The browser's /api/upload requests reach the real server code in the same process. */
async function serverUpload(url: string, init: RequestInit) {
    assert.equal(url, '/api/upload');

    const request = new Request('http://localhost/api/upload', init);
    const received = await receiveUpload(request, TEST_ACCOUNT, ChunkFormat.Bmp);

    return received.match({
        Ok: uploadStream,
        Err: (error) => new Response(JSON.stringify({ error: error.message }), { status: 400 })
    });
}

function expectedChunks(sizes: readonly number[]) {
    return sum(sizes.map((size) => Math.max(1, Math.ceil(size / CHUNK))));
}

async function runUploads(sources: readonly File[], workers: number, retry: boolean) {
    const counts = { completed: 0, failed: 0, chunks: 0 };
    const fresh = freshFiles(sources);
    const upload = () =>
        uploadFiles(
            fresh,
            'bench@example.com',
            workers,
            (job) => {
                if (job.status === UploadJobStatus.Complete) counts.completed++;
                if (job.status === UploadJobStatus.Error) counts.failed++;
            },
            () => {
                counts.chunks++;
            },
            ProcessingMode.Browser
        );

    const result = await upload();
    assert.ok(result.isOk());
    if (!retry) return counts;

    assert.equal(counts.failed, sources.length);
    const retried = await upload();
    assert.ok(retried.isOk());

    return counts;
}

export function uploadWorkload(
    { sizes, workers = 4, duplicate = false, retry = false }: UploadCase,
    transport: TransportSlot
): Workload {
    const sources = files(sizes);

    return {
        bytes: sum(sizes),
        run: async () => {
            const harness = provider({ duplicate, failCommit: retry });
            transport.fetcher = harness.fetcher;
            transport.fetcherWithProgress = harness.fetcherWithProgress;
            vi.stubGlobal('fetch', serverUpload);

            try {
                const counts = await runUploads(sources, workers, retry);
                const transfers = duplicate ? 0 : counts.chunks;

                assert.equal(counts.completed, sources.length);
                assert.equal(counts.chunks, expectedChunks(sizes));
                assert.equal(harness.counts.transfers, transfers);
            } finally {
                vi.unstubAllGlobals();
            }
        }
    };
}
