import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { receiveUpload } from '$server/upload-input';
import { removeTemporaryDirectory } from '$server/temporary-files';
import { MAX_CHUNK_PAYLOAD_BYTES, MAX_PHOTOS_BMP_BYTES, splitBmpByteLength } from '$server/bmp';
import { planUpload } from '$server/uploads';

const FILE_HASH = 'a'.repeat(64);

function plan(size: number, name = 'large.bin') {
    return planUpload({ name, path: '/sparse/or/mocked', size, fileHash: FILE_HASH });
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
        [MAX_CHUNK_PAYLOAD_BYTES, MAX_CHUNK_PAYLOAD_BYTES, MAX_CHUNK_PAYLOAD_BYTES, 8_000_001]
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

test('multipart receive preserves exact zero and one-byte originals and hashes', async () => {
    const bytes = Buffer.from([0xff]);
    const form = new FormData();
    form.set('email', 'test@example.com');
    form.set('token', 'aas_et/synthetic');
    form.set('workers', '1');
    form.append('file', new File([], 'empty.bin'));
    form.append('file', new File([bytes], 'single-byte.bin'));

    const result = await receiveUpload(
        new Request('http://localhost/api/upload', { method: 'POST', body: form })
    );
    const input = result.unwrap();

    try {
        expect(input.files.map((file) => file.size)).toEqual([0, 1]);
        expect(input.files.map((file) => file.fileHash)).toEqual([
            createHash('sha256').digest('hex'),
            createHash('sha256').update(bytes).digest('hex')
        ]);
        expect(await readFile(input.files[0].path)).toEqual(Buffer.alloc(0));
        expect(await readFile(input.files[1].path)).toEqual(bytes);
    } finally {
        await removeTemporaryDirectory(input.directory);
    }
});
