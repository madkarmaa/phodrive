import { test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
    decodeSplitHeader,
    decodeSplitBmp,
    encodeSplitBmp,
    MAX_CHUNK_PAYLOAD_BYTES,
    MAX_PHOTOS_BMP_BYTES,
    splitBmpByteLength
} from '$server/bmp';
import { chunkFileName } from '$server/chunks';
import { groupChunks } from '$lib/files';
import { SplitHeaderSchema, type SplitHeader, type RemoteBmp } from '$lib/models';

const ORIGINAL = Uint8Array.from({ length: 1031 }, (_, index) => index % 251);
const FILE_HASH = createHash('sha256').update(ORIGINAL).digest('hex');

function header(index: number, payloadSize: number, last: boolean): SplitHeader {
    return {
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
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
        expect(new TextDecoder().decode(bmp.subarray(54, 62))).toBe('BMSPLIT\x01');
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
        expect([...bmp.subarray(126, 126 + expected.length)]).toEqual([...expected]);
        expect(decodeSplitBmp(bmp).unwrap().header.chunkIndex).toBe(index);
    }
});

test('split metadata requires file identity and rejects unsupported format versions', () => {
    const metadata = header(0, 1, true);
    const { fileId, ...missingIdentity } = metadata;
    expect(fileId).toBe(FILE_HASH);
    expect(SplitHeaderSchema.safeParse(missingIdentity).success).toBe(false);

    for (const version of [0, 2, 255]) {
        const bmp = encodeSplitBmp(Uint8Array.of(9), metadata).unwrap();
        bmp[61] = version;
        expect(decodeSplitBmp(bmp).isErr()).toBe(true);
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

test('remote chunks group into one card', () => {
    const makeChunk = (index: number): RemoteBmp => ({
        originalName: index === 0 ? 'video.mp4' : undefined,
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
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
    expect(remoteName).toBe(`video.mp4.phodrive-${FILE_HASH}-1-of-2.bmp`);
});

test('prefix encoding preserves original protocol bytes for Unicode and multibyte indexes', async () => {
    const { encodeSplitPrefix } = await import('$lib/bmp/format');
    const common = { fileHash: 'ab'.repeat(32), fileId: 'cd'.repeat(32) };
    const first = encodeSplitPrefix({
        ...common,
        chunkIndex: 0,
        flags: 1,
        payloadSize: 1024,
        fileName: 'photos-📷.bin'
    }).unwrap();
    expect(Buffer.from(first.prefix).toString('hex')).toBe(
        '424d360c000000000000360000002800000020000000200000000100180000000000000c000000000000000000000000000000000000424d53504c495401' +
            'ab'.repeat(32) +
            'cd'.repeat(32) +
            '000180080f70686f746f732df09f93b72e62696e'
    );
    expect([first.totalSize, first.paddingSize]).toEqual([3126, 1956]);
    const later = encodeSplitPrefix({
        ...common,
        chunkIndex: 128,
        flags: 0,
        payloadSize: 195000000
    }).unwrap();
    expect(Buffer.from(later.prefix).toString('hex')).toBe(
        '424db6a49f0b000000003600000028000000801f00007d1f0000010018000000000080a49f0b00000000000000000000000000000000424d53504c495401' +
            'ab'.repeat(32) +
            'cd'.repeat(32) +
            '800100c0edfd5c'
    );
    expect([later.totalSize, later.paddingSize]).toEqual([195011766, 11633]);
});
