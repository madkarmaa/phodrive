import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { groupChunks, type UploadedChunk } from '$lib/file-groups';
import { FileActionKind } from '$lib/models';
import {
    decodeSplitBmp,
    encodeSplitBmp,
    MAX_CHUNK_PAYLOAD_BYTES,
    MAX_PHOTOS_BMP_BYTES
} from '$server/bmp';
import { fileIdentity } from '$server/chunks';
import { downloadFile } from '$server/files';
import { downloadBmp } from '$server/photos';
import { planUpload } from '$server/uploads';
import { bmpResponse } from '../helpers/download';

vi.mock('$server/photos', () => ({ downloadBmp: vi.fn(), uploadBmp: vi.fn() }));

const FILE_NAME = 'compatible.bin';
const EMAIL = 'test@example.com';
const LEGACY_CHUNK_PAYLOAD_BYTES = 64_000_000;

function legacyIdentity(fileHash: string): string {
    return createHash('sha256').update(fileHash).update('\0').update(FILE_NAME).digest('hex');
}

test('195 MB split layouts remain below the photo limit and retry with a stable identity', () => {
    const file = {
        name: FILE_NAME,
        size: 2 * MAX_CHUNK_PAYLOAD_BYTES + 1,
        fileHash: 'a'.repeat(64)
    };
    const initial = planUpload(file).unwrap();
    const retry = planUpload(file).unwrap();

    expect(initial.headers.map((header) => header.payloadSize)).toEqual([
        195_000_000, 195_000_000, 1
    ]);
    expect(initial.sizes.every((size) => size < MAX_PHOTOS_BMP_BYTES)).toBe(true);
    expect(retry.headers).toEqual(initial.headers);
    expect(new Set(initial.headers.map((header) => header.fileId)).size).toBe(1);
    expect(initial.headers[0].fileId).not.toBe(legacyIdentity(file.fileHash));
    expect(initial.headers[0].fileId).not.toBe(fileIdentity(FILE_NAME, file.fileHash, 128_000_000));
});

test('old 64 MB chunks and a larger-chunk reupload coexist and both download intact', async () => {
    const original = Buffer.alloc(LEGACY_CHUNK_PAYLOAD_BYTES + 1, 0x2a);
    original[original.length - 1] = 0xff;
    const fileHash = createHash('sha256').update(original).digest('hex');
    const planned = planUpload({
        name: FILE_NAME,
        size: original.length,
        fileHash
    });
    const plan = planned.unwrap();
    expect(plan.headers).toHaveLength(1);

    const layouts = [
        {
            fileId: legacyIdentity(fileHash),
            parts: [
                original.subarray(0, LEGACY_CHUNK_PAYLOAD_BYTES),
                original.subarray(LEGACY_CHUNK_PAYLOAD_BYTES)
            ]
        },
        { fileId: plan.headers[0].fileId, parts: [original] }
    ];
    const chunks: UploadedChunk[] = [];
    const stored = new Map<string, Buffer>();
    for (const [layoutIndex, layout] of layouts.entries()) {
        for (const [chunkIndex, payload] of layout.parts.entries()) {
            const encoded = encodeSplitBmp(payload, {
                fileHash,
                fileId: layout.fileId,
                chunkIndex,
                flags: chunkIndex === layout.parts.length - 1 ? 1 : 0,
                payloadSize: payload.length,
                fileName: chunkIndex === 0 ? FILE_NAME : undefined
            });
            const bmp = encoded.unwrap();
            const decoded = decodeSplitBmp(bmp).unwrap();
            const mediaKey = `${layoutIndex}-${chunkIndex}`;
            stored.set(mediaKey, Buffer.from(bmp.buffer, bmp.byteOffset, bmp.byteLength));
            chunks.push({
                email: EMAIL,
                fileHash,
                fileId: decoded.header.fileId,
                chunkIndex,
                isLast: decoded.header.flags === 1,
                originalName: decoded.header.fileName,
                size: decoded.header.payloadSize,
                at: layoutIndex + 1,
                mediaKey,
                sha1: createHash('sha1').update(bmp).digest('hex')
            });
        }
    }

    const groups = groupChunks(chunks);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.chunkCount)).toEqual([2, 1]);
    expect(groups.every((group) => group.complete)).toBe(true);
    vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) => {
        const bmp = stored.get(mediaKey);
        expect(bmp).toBeDefined();

        return Ok(bmpResponse(bmp!)).andThenAsync(async (response) => Ok(response));
    });

    try {
        for (const group of groups) {
            const downloaded = await downloadFile({
                action: FileActionKind.Download,
                email: EMAIL,
                token: 'aas_et/synthetic',
                name: group.name,
                fileHash,
                fileId: group.fileId,
                chunks: group.chunks,
                workers: 1
            });
            const response = downloaded.unwrap();
            const bytes = await response.arrayBuffer();

            expect(Buffer.from(bytes).equals(original)).toBe(true);
        }
    } finally {
        vi.mocked(downloadBmp).mockReset();
    }
});
