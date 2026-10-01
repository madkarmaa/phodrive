import { test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
    decodeSplitHeader,
    decodeSplitBmp,
    encodeSplitBmp,
    MAX_CHUNK_PAYLOAD_BYTES,
    MAX_PHOTOS_BMP_BYTES,
    splitBmpByteLength
} from '$lib/bmp';
import { chunkFileName, parseChunkFileName } from '$lib/chunks';
import { groupChunks } from '$lib/file-groups';
import { hashFile } from '$lib/file-hash';
import type { SplitHeader, RemoteBmp } from '$lib/models';

const ORIGINAL = Uint8Array.from({ length: 1031 }, (_, index) => index % 251);
const FILE_HASH = createHash('sha256').update(ORIGINAL).digest('hex');

function header(index: number, payloadSize: number, last: boolean): SplitHeader {
    return {
        fileHash: FILE_HASH,
        chunkIndex: index,
        flags: last ? 1 : 0,
        payloadSize,
        fileName: index === 0 ? 'video.mp4' : undefined
    };
}

test('split BMPs store the Zod-validated metadata and reconstruct the original bytes', () => {
    const payloads = [
        ORIGINAL.subarray(0, 500),
        ORIGINAL.subarray(500, 900),
        ORIGINAL.subarray(900)
    ];
    const decoded = payloads.map((payload, index) => {
        const bmp = encodeSplitBmp(payload, header(index, payload.length, index === 2)).unwrap();
        expect(bmp.length).toBe(
            splitBmpByteLength(header(index, payload.length, index === 2)).unwrap()
        );
        expect(bmp.length).toBeLessThan(MAX_PHOTOS_BMP_BYTES);
        expect(new TextDecoder().decode(bmp.subarray(54, 62))).toBe('BMSPLIT\0');
        expect(new DataView(bmp.buffer).getUint32(10, true)).toBe(54);
        expect(decodeSplitHeader(bmp.subarray(0, 256), bmp.length).unwrap().header).toEqual(
            header(index, payload.length, index === 2)
        );

        return decodeSplitBmp(bmp).unwrap();
    });

    expect(decoded[0].header.fileName).toBe('video.mp4');
    expect(decoded[1].header.fileName).toBeUndefined();
    expect(decoded[2].header.flags).toBe(1);
    const reconstructed = Buffer.concat(decoded.map(({ payload }) => Buffer.from(payload)));
    expect(reconstructed).toEqual(Buffer.from(ORIGINAL));
    expect(createHash('sha256').update(reconstructed).digest('hex')).toBe(FILE_HASH);
});

test('chunk indexes use canonical varints, including indexes above 127', () => {
    for (const [index, expected] of [
        [127, [0x7f]],
        [128, [0x80, 0x01]],
        [300, [0xac, 0x02]],
        [16_384, [0x80, 0x80, 0x01]]
    ] as const) {
        const bmp = encodeSplitBmp(Uint8Array.of(9), header(index, 1, false)).unwrap();
        expect([...bmp.subarray(94, 94 + expected.length)]).toEqual([...expected]);
        expect(decodeSplitBmp(bmp).unwrap().header.chunkIndex).toBe(index);
    }
});

test('projected chunks fit the photo limit and reject damaged padding', () => {
    expect(splitBmpByteLength(header(0, MAX_CHUNK_PAYLOAD_BYTES, false)).unwrap()).toBeLessThan(
        MAX_PHOTOS_BMP_BYTES
    );

    const bmp = encodeSplitBmp(Uint8Array.of(1, 2, 3), header(0, 3, true)).unwrap();
    bmp[bmp.length - 1] = 1;
    expect(decodeSplitBmp(bmp).isErr()).toBe(true);
});

test('file hashing reads in slices and remote chunks group into one card', async () => {
    const file = new File([ORIGINAL], 'video.mp4');
    const progress: number[] = [];
    const hashed = await hashFile(file, (bytesRead) => progress.push(bytesRead));
    expect(hashed.unwrap()).toBe(FILE_HASH);
    expect(progress).toEqual([0, file.size]);

    const makeChunk = (index: number): RemoteBmp => ({
        originalName: index === 0 ? 'video.mp4' : undefined,
        fileHash: FILE_HASH,
        chunkIndex: index,
        isLast: index === 1,
        size: 100,
        at: index,
        mediaKey: `key-${index}`,
        sha1: 'a'.repeat(40)
    });
    const partial = groupChunks([{ ...makeChunk(1), email: 'test@example.com' }]);
    expect(partial[0].complete).toBe(false);
    expect(partial[0].chunkCount).toBe(2);
    expect(partial[0].name).toBe(`File ${FILE_HASH.slice(0, 12)}`);

    const complete = groupChunks([
        { ...makeChunk(1), email: 'test@example.com' },
        { ...makeChunk(0), email: 'test@example.com' }
    ]);
    expect(complete).toHaveLength(1);
    expect(complete[0].complete).toBe(true);
    expect(complete[0].name).toBe('video.mp4');
    expect(complete[0].chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);

    const remoteName = chunkFileName('video.mp4', FILE_HASH, 1, 2);
    expect(parseChunkFileName(remoteName)).toEqual({
        name: 'video.mp4',
        fileHash: FILE_HASH,
        chunkIndex: 1,
        chunkCount: 2
    });
});
