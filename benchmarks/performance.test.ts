import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test, vi } from 'vitest';
import { hashFile, hashUploadChunk, uploadIdentity } from '#browser/upload/hash';
import { uploadFiles } from '#browser/upload';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES as CHUNK } from '#lib/bmp/format';
import { planChunks } from '#lib/upload';
import { FileSort, UploadJobStatus, type SplitHeader } from '#lib/models';
import { groupChunks, sortFiles, type UploadedChunk } from '#lib/files';
import { encodeSplitBmp } from '#server/bmp';
import { SplitBmpReader } from '#server/bmp/stream';
import { receiveUpload } from '#server/upload/input';
import { encodeUploadBmp } from '#server/upload/bmp';
import { uploadStream } from '#server/upload/stream';
import { parseLibraryPage } from '#server/photos/library/metadata';
import { bytesField, numberField, message } from '#server/protobuf';
import { uploadForm } from '../tests/helpers/upload';
import { provider } from './transport';

const transport = vi.hoisted(() => ({
    fetcher: null as typeof fetch | null,
    fetcherWithProgress: null as ((callback: (sent: number) => void) => typeof fetch) | null
}));
vi.mock('#server/fetcher', () => ({
    photosFetch: (...args: Parameters<typeof fetch>) => transport.fetcher!(...args),
    photosFetchWithProgress:
        (callback: (sent: number) => void) =>
        (...args: Parameters<typeof fetch>) =>
            transport.fetcherWithProgress!(callback)(...args)
}));

const MIB = 1024 * 1024;
const name = process.env.PHODRIVE_PERF_CASE;
const SIZES: Record<string, number> = {
    tiny: 1024,
    small: 64 * 1024,
    medium: 8 * MIB,
    large: 64 * MIB,
    'very-large': 2 * CHUNK + MIB
};
const header = (size: number): SplitHeader => ({
    fileHash: 'ab'.repeat(32),
    fileId: 'cd'.repeat(32),
    chunkIndex: 0,
    flags: 1,
    payloadSize: size,
    fileName: 'photos-📷.bin'
});
const files = (sizes: number[]) =>
    sizes.map(
        (size, index) =>
            new File([new Uint8Array(size).fill((index % 251) + 1)], `file-${index}.bin`)
    );
function blocks(bytes: Uint8Array, blockSize = 64 * 1024) {
    let offset = 0;
    return new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (offset === bytes.length) {
                    controller.close();
                    return;
                }
                const part = bytes.subarray(offset, offset + blockSize);
                offset += part.length;
                controller.enqueue(part);
            }
        },
        { highWaterMark: 0 }
    );
}

async function workload(): Promise<{ run: () => Promise<void> | void; bytes: number }> {
    if (name?.startsWith('hash-')) {
        const sizes =
            name === 'hash-many' ? Array.from({ length: 500 }, () => 1024) : [SIZES[name.slice(5)]];
        const repetitions = name === 'hash-tiny' || name === 'hash-small' ? 200 : 1;
        const sources = files(sizes);
        const expected = await Promise.all(
            sources.map(async (file) => {
                const data = await file.arrayBuffer();
                return createHash('sha256').update(new Uint8Array(data)).digest('hex');
            })
        );
        return {
            bytes: sizes.reduce((a, b) => a + b, 0) * repetitions,
            run: async () => {
                for (let repeat = 0; repeat < repetitions; repeat++)
                    for (const [index, file] of sources.entries()) {
                        const fresh = new File([file], file.name);
                        const result = await hashFile(fresh, () => {});
                        assert.equal(result.unwrap(), expected[index]);
                    }
            }
        };
    }
    if (name === 'identity')
        return {
            bytes: 0,
            run: async () => {
                for (let i = 0; i < 1000; i++) {
                    const result = await uploadIdentity(`file-${i}`, 'ab'.repeat(32));
                    assert.equal(result.unwrap().length, 64);
                }
            }
        };
    if (name?.startsWith('chunk-hash')) {
        const size = name.endsWith('small') ? 1024 : CHUNK;
        const payload = new Blob([new Uint8Array(size).fill(42)]);
        const encoded = encodeSplitBmp(new Uint8Array(size).fill(42), header(size)).unwrap();
        const expected = createHash('sha1').update(encoded).digest('hex');
        const count = size === 1024 ? 500 : 1;
        return {
            bytes: size * count,
            run: async () => {
                for (let i = 0; i < count; i++) {
                    const result = await hashUploadChunk(payload, header(size));
                    assert.equal(result.unwrap().sha1, expected);
                }
            }
        };
    }
    if (name === 'planning')
        return {
            bytes: 0,
            run: () => {
                for (let i = 0; i < 20; i++) {
                    const plan = planChunks(
                        {
                            name: 'archive.bin',
                            size: 500_000_000_000 + i,
                            fileHash: 'ab'.repeat(32)
                        },
                        'cd'.repeat(32)
                    ).unwrap();
                    assert.equal(
                        plan.headers.reduce((sum, part) => sum + part.payloadSize, 0),
                        500_000_000_000 + i
                    );
                }
            }
        };
    if (name === 'prefix')
        return {
            bytes: 0,
            run: () => {
                for (let i = 0; i < 10_000; i++)
                    assert.ok(encodeSplitPrefix(header(i)).unwrap().prefix.length > 100);
            }
        };
    if (name === 'bmp-encode') {
        const data = new Uint8Array(64 * MIB).fill(42);
        return {
            bytes: data.length,
            run: () => {
                const result = encodeSplitBmp(data, header(data.length)).unwrap();
                assert.equal(result[1000], 42);
            }
        };
    }
    if (name === 'bmp-stream') {
        const fixture = uploadForm(new Uint8Array(CHUNK).fill(42));
        return {
            bytes: CHUNK,
            run: async () => {
                const received = await receiveUpload(fixture.request());
                const input = received.unwrap();
                const source = encodeUploadBmp(input);
                const result = await source.drain();
                assert.ok(result.isOk());
                await input.cancel();
            }
        };
    }
    if (name === 'download-stream') {
        const data = new Uint8Array(64 * MIB).fill(42);
        const metadata = header(data.length);
        const bmp = encodeSplitBmp(data, metadata).unwrap();
        const sha1 = createHash('sha1').update(bmp).digest('hex');
        return {
            bytes: data.length,
            run: async () => {
                const opened = await SplitBmpReader.open(new Response(blocks(bmp)), metadata, sha1);
                const reader = opened.unwrap();
                let length = 0;
                while (true) {
                    const next = await reader.readPayload();
                    const part = next.unwrap();
                    if (part === null) break;
                    length += part.length;
                }
                assert.equal(length, data.length);
            }
        };
    }
    if (name === 'protocol-page') {
        const entries = Array.from({ length: 1000 }, (_, i) =>
            bytesField(
                2,
                message(
                    bytesField(1, `media-${i}`),
                    bytesField(
                        2,
                        message(
                            numberField(9, i + 1),
                            numberField(10, 10000),
                            bytesField(13, bytesField(1, new Uint8Array(20).fill(i % 255)))
                        )
                    )
                )
            )
        );
        const page = bytesField(1, message(...entries));
        return {
            bytes: page.length * 10,
            run: () => {
                for (let i = 0; i < 10; i++)
                    assert.equal(parseLibraryPage(page).unwrap().items.length, 1000);
            }
        };
    }
    if (name === 'group-chunks' || name === 'group-many-files' || name === 'sort-files') {
        const manyFiles = name !== 'group-chunks';
        const entries: UploadedChunk[] = Array.from(
            { length: manyFiles ? 10_000 : 4096 },
            (_, i) => ({
                email: 'bench@example.com',
                fileHash: 'ab'.repeat(32),
                fileId: manyFiles ? String(i) : String(i % 8),
                chunkIndex: manyFiles ? 0 : Math.floor(i / 8),
                isLast: manyFiles || i >= 4088,
                originalName: `file-${i}`,
                size: 1,
                at: (i * 997) % 10007,
                mediaKey: String(i),
                sha1: 'ab'.repeat(20)
            })
        );
        const groups = groupChunks(entries);
        return {
            bytes: 0,
            run: () => {
                for (let i = 0; i < 10; i++) {
                    if (name.startsWith('group-'))
                        assert.equal(
                            groupChunks([
                                ...entries,
                                ...entries.filter((_, index) => index % 4 === 0)
                            ]).length,
                            manyFiles ? 10_000 : 8
                        );
                    else
                        assert.equal(
                            sortFiles(groups, FileSort.ModifiedDescending).length,
                            entries.length
                        );
                }
            }
        };
    }
    if (name === 'failure-paths') {
        const fixture = uploadForm(new Uint8Array(MIB).fill(42));
        return {
            bytes: 0,
            run: async () => {
                const invalid = await receiveUpload(
                    new Request('http://localhost/api/upload', { method: 'POST', body: 'bad' })
                );
                assert.ok(invalid.isErr());
                for (const mode of ['hash', 'short', 'cancel', 'stream']) {
                    const received = await receiveUpload(fixture.request());
                    const input = received.unwrap();
                    if (mode === 'hash') input.sha1 = '0'.repeat(40);
                    if (mode === 'short') input.header.payloadSize++;
                    if (mode === 'stream') {
                        await input.cancel();
                        input.payload = new ReadableStream({
                            pull(controller) {
                                controller.error(new Error('failed stream'));
                            }
                        });
                    }
                    const source = encodeUploadBmp(input);
                    if (mode === 'cancel') await source.body.cancel();
                    else {
                        const drained = await source.drain();
                        assert.ok(drained.isErr());
                    }
                    const verified = await source.verified;
                    assert.ok(verified.isErr());
                    await input.cancel();
                }
            }
        };
    }
    const sizes =
        name === 'upload-tiny'
            ? [0, 1, 1024]
            : name === 'upload-many'
              ? Array.from({ length: 300 }, () => 64 * 1024)
              : name === 'upload-large'
                ? [2 * CHUNK + MIB]
                : name === 'upload-boundaries'
                  ? [CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK + 1]
                  : name === 'upload-duplicate' || name === 'upload-retry'
                    ? [8 * MIB]
                    : [
                          ...Array.from({ length: 64 }, () => 64 * 1024),
                          ...Array.from({ length: 4 }, () => 8 * MIB),
                          CHUNK + MIB
                      ];
    const sources = files(sizes);
    const workers = Number(name?.split('-').at(-1)) || 4;
    return {
        bytes: sizes.reduce((a, b) => a + b, 0),
        run: async () => {
            const harness = provider({
                duplicate: name === 'upload-duplicate',
                failCommit: name === 'upload-retry'
            });
            transport.fetcher = harness.fetcher;
            transport.fetcherWithProgress = harness.fetcherWithProgress;
            vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
                assert.equal(url, '/api/upload');
                const received = await receiveUpload(
                    new Request('http://localhost/api/upload', init)
                );
                return received.match({
                    Ok: uploadStream,
                    Err: (error) =>
                        new Response(JSON.stringify({ error: error.message }), { status: 400 })
                });
            });
            let completed = 0;
            let failed = 0;
            let chunks = 0;
            const fresh = sources.map((file) => new File([file], file.name));
            const run = () =>
                uploadFiles(
                    fresh,
                    'bench@example.com',
                    'aas_et/fixture',
                    workers,
                    (job) => {
                        if (job.status === UploadJobStatus.Complete) completed++;
                        if (job.status === UploadJobStatus.Error) failed++;
                    },
                    () => {
                        chunks++;
                    }
                );
            try {
                const result = await run();
                assert.ok(result.isOk());
                if (name === 'upload-retry') {
                    assert.equal(failed, sources.length);
                    const retried = await run();
                    assert.ok(retried.isOk());
                }
                assert.equal(completed, sources.length);
                assert.equal(
                    chunks,
                    sizes.reduce((sum, size) => sum + Math.max(1, Math.ceil(size / CHUNK)), 0)
                );
                if (name === 'upload-duplicate') assert.equal(harness.counts.transfers, 0);
                else assert.equal(harness.counts.transfers, chunks);
            } finally {
                vi.unstubAllGlobals();
            }
        }
    };
}

test(`performance: ${name}`, async () => {
    assert.ok(name);
    const { run, bytes } = await workload();
    await run();
    await run();
    const samplesMs: number[] = [];
    let peakExternal = 0;
    let peakHeap = 0;
    const sampleMemory = () => {
        const memory = process.memoryUsage();
        peakExternal = Math.max(peakExternal, memory.external);
        peakHeap = Math.max(peakHeap, memory.heapUsed);
    };
    const timer = setInterval(sampleMemory, 5);
    try {
        for (let sample = 0; sample < 5; sample++) {
            sampleMemory();
            const start = performance.now();
            await run();
            samplesMs.push(performance.now() - start);
            sampleMemory();
        }
    } finally {
        clearInterval(timer);
    }
    const medianMs = samplesMs.toSorted((a, b) => a - b)[2];
    const result = {
        name,
        samplesMs,
        medianMs,
        bytes,
        mibPerSecond: bytes / MIB / (medianMs / 1000),
        peakRssMiB: process.resourceUsage().maxRSS / 1024,
        peakExternalMiB: peakExternal / MIB,
        peakHeapMiB: peakHeap / MIB
    };
    await writeFile(process.env.PHODRIVE_PERF_RESULT!, JSON.stringify(result));
});
