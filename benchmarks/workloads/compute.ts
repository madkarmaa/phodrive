import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
    hashFile,
    hashUploadChunk,
    uploadIdentity
} from '@madkarmaa/phodrive-core/browser/upload/hash';
import { encodeSplitPrefix } from '@madkarmaa/phodrive-core/bmp/format';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { planChunks } from '@madkarmaa/phodrive-core/upload';
import { files, freshFiles, header, MIB, sum, type Workload } from '../fixtures';

const PLANNED_FILE_BYTES = 500_000_000_000;

export async function hashWorkload(sizes: number[], repetitions: number): Promise<Workload> {
    const sources = files(sizes);
    const expected = await Promise.all(
        sources.map(async (file) => {
            const data = await file.arrayBuffer();

            return createHash('sha256').update(new Uint8Array(data)).digest('hex');
        })
    );

    return {
        bytes: sum(sizes) * repetitions,
        run: async () => {
            for (let round = 0; round < repetitions; round++)
                for (const [index, file] of freshFiles(sources).entries()) {
                    const result = await hashFile(file, () => {});
                    assert.equal(result.unwrap(), expected[index]);
                }
        }
    };
}

export function identityWorkload(): Workload {
    return {
        bytes: 0,
        run: async () => {
            for (let i = 0; i < 1000; i++) {
                const result = await uploadIdentity(`file-${i}`, 'ab'.repeat(32));
                assert.equal(result.unwrap().length, 64);
            }
        }
    };
}

export function chunkHashWorkload(size: number, count: number): Workload {
    const payload = new Blob([new Uint8Array(size).fill(42)]);
    const encoded = encodeSplitBmp(new Uint8Array(size).fill(42), header(size)).unwrap();
    const expected = createHash('sha1').update(encoded).digest('hex');

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

export function planningWorkload(): Workload {
    return {
        bytes: 0,
        run: () => {
            for (let i = 0; i < 20; i++) {
                const size = PLANNED_FILE_BYTES + i;
                const file = { name: 'archive.bin', size, fileHash: 'ab'.repeat(32) };
                const plan = planChunks(file, 'cd'.repeat(32)).unwrap();

                assert.equal(sum(plan.headers.map((part) => part.payloadSize)), size);
            }
        }
    };
}

export function prefixWorkload(): Workload {
    return {
        bytes: 0,
        run: () => {
            for (let i = 0; i < 10_000; i++)
                assert.ok(encodeSplitPrefix(header(i)).unwrap().prefix.length > 100);
        }
    };
}

export function bmpEncodeWorkload(): Workload {
    const data = new Uint8Array(64 * MIB).fill(42);

    return {
        bytes: data.length,
        run: () => {
            const result = encodeSplitBmp(data, header(data.length)).unwrap();
            assert.equal(result[1000], 42);
        }
    };
}
