import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { hashFile, hashUploadChunk } from '$browser/upload/hash';
import { encodeSplitBmp } from '$server/bmp';

test('concurrent hashing isolates reusable states and failed reads cannot contaminate later files', async () => {
    const damaged = new File([new Uint8Array(2 * 1024 * 1024).fill(99)], 'damaged.bin');
    const slice = damaged.slice.bind(damaged);
    vi.spyOn(damaged, 'slice').mockImplementation((start, end) => {
        if (!start) return slice(start, end);
        const blob = new Blob();
        vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('read failure'));
        return blob;
    });
    const failed = await hashFile(damaged, () => {});
    expect(failed.unwrapErr().code).toBe('FILE_READ_FAILED');

    for (let round = 0; round < 3; round++) {
        await Promise.all(
            Array.from({ length: 40 }, async (_, index) => {
                const bytes = new Uint8Array(8192 + index).fill(index + round);
                const file = new File([bytes], `${round}-${index}.bin`);
                const hashed = await hashFile(file, () => {});
                expect(hashed.unwrap()).toBe(createHash('sha256').update(bytes).digest('hex'));
                const header = {
                    fileHash: hashed.unwrap(),
                    fileId: 'ab'.repeat(32),
                    chunkIndex: 0,
                    flags: 1 as const,
                    payloadSize: bytes.length,
                    fileName: file.name
                };
                const chunk = await hashUploadChunk(file, header);
                const encoded = encodeSplitBmp(bytes, header).unwrap();
                expect(chunk.unwrap().sha1).toBe(createHash('sha1').update(encoded).digest('hex'));
            })
        );
    }
});
