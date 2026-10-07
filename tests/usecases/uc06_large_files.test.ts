import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { receiveUpload } from '#server/upload/input';
import { encodeUploadBmp } from '#server/upload/bmp';
import { uploadForm } from '../helpers/upload';
import { MAX_CHUNK_PAYLOAD_BYTES, MAX_PHOTOS_BMP_BYTES, splitBmpByteLength } from '#server/bmp';
import { planUpload } from '#server/upload';

const FILE_HASH = 'a'.repeat(64);

function plan(size: number, name = 'large.bin') {
    return planUpload({ name, size, fileHash: FILE_HASH });
}

test('plans exact chunk boundary ranges, final flags, zero-byte files, and 200 MB originals', () => {
    const sizes = [
        0,
        1,
        MAX_CHUNK_PAYLOAD_BYTES - 1,
        MAX_CHUNK_PAYLOAD_BYTES,
        MAX_CHUNK_PAYLOAD_BYTES + 1,
        200_000_001
    ];
    const expected = [
        [0],
        [1],
        [MAX_CHUNK_PAYLOAD_BYTES - 1],
        [MAX_CHUNK_PAYLOAD_BYTES],
        [MAX_CHUNK_PAYLOAD_BYTES, 1],
        [195_000_000, 5_000_001]
    ];

    for (const [index, size] of sizes.entries()) {
        const planned = plan(size).unwrap();
        expect(planned.headers.map((header) => header.payloadSize)).toEqual(expected[index]);
        expect(planned.headers.map((header) => header.chunkIndex)).toEqual(
            expected[index].map((_, chunkIndex) => chunkIndex)
        );
        expect(planned.headers.map((header) => header.flags)).toEqual(
            expected[index].map((_, chunkIndex) =>
                Number(chunkIndex === expected[index].length - 1)
            )
        );
        expect(planned.headers[0].fileName).toBe('large.bin');
        expect(planned.headers.slice(1).every((header) => header.fileName === undefined)).toBe(
            true
        );
        expect(planned.sizes).toHaveLength(expected[index].length);
        expect(planned.sizes.every((bmpSize) => bmpSize < MAX_PHOTOS_BMP_BYTES)).toBe(true);
        expect(planned.headers.reduce((sum, header) => sum + header.payloadSize, 0)).toBe(size);
    }
});

test('first chunk BMP size accounts for UTF-8 long-name metadata overhead', () => {
    const name = `${'旅行'.repeat(8_000)}.bin`;
    const planned = plan(MAX_CHUNK_PAYLOAD_BYTES + 1, name).unwrap();
    const first = planned.headers[0];
    const projected = splitBmpByteLength(first).unwrap();
    const withoutName = splitBmpByteLength({ ...first, fileName: 'x' }).unwrap();
    const utf8NameBytes = Buffer.byteLength(name, 'utf8');

    expect(projected).toBe(planned.sizes[0]);
    expect(projected).toBeGreaterThan(withoutName + utf8NameBytes - 2);
    expect(planned.sizes[1]).toBe(splitBmpByteLength(planned.headers[1]).unwrap());
});

test('zero and one-byte chunks stream with exact hashes and payloads', async () => {
    for (const payload of [new Uint8Array(), Uint8Array.of(0xff)]) {
        const fixture = uploadForm(payload, 'small.bin');
        const received = await receiveUpload(fixture.request());
        const input = received.unwrap();
        const bmp = encodeUploadBmp(input);
        const drained = await bmp.drain();
        expect(drained.isOk()).toBe(true);
        expect(input.file.size).toBe(payload.length);
        expect(input.file.fileHash).toBe(createHash('sha256').update(payload).digest('hex'));
        await input.cancel();
    }
});
