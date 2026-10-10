import { createHash } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { createSHA1, createSHA256 } from 'hash-wasm';
import { encodeSplitBmp } from '#server/bmp';

vi.mock('hash-wasm', async (importOriginal) => {
    const original = await importOriginal<typeof import('hash-wasm')>();

    return {
        ...original,
        createSHA1: vi.fn(original.createSHA1),
        createSHA256: vi.fn(original.createSHA256)
    };
});

const original = await vi.importActual<typeof import('hash-wasm')>('hash-wasm');
const bytes = new Uint8Array([1, 2, 3]);
const header = {
    fileHash: 'ab'.repeat(32),
    fileId: 'cd'.repeat(32),
    chunkIndex: 0,
    flags: 1 as const,
    payloadSize: bytes.length,
    fileName: 'fixture.bin'
};

beforeEach(() => {
    vi.resetModules();
    vi.mocked(createSHA1).mockReset().mockImplementation(original.createSHA1);
    vi.mocked(createSHA256).mockReset().mockImplementation(original.createSHA256);
});

test.each(['update', 'digest'] as const)(
    'file hashing returns Err after a WASM %s failure and retries with a new state',
    async (operation) => {
        const hasher = await original.createSHA256();
        const init = vi.spyOn(hasher, 'init');
        vi.spyOn(hasher, operation).mockImplementationOnce(() => {
            throw new Error('WASM failure');
        });
        vi.mocked(createSHA256).mockResolvedValueOnce(hasher);
        const { hashFile } = await import('#browser/upload/hash');
        const file = new File([bytes], header.fileName);

        const failed = await hashFile(file, () => {});
        expect(failed.unwrapErr().code).toBe('HASH_INITIALIZATION_FAILED');

        const retried = await hashFile(file, () => {});
        expect(retried.unwrap()).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(createSHA256).toHaveBeenCalledTimes(2);
        expect(init).not.toHaveBeenCalled();
    }
);

test.each(['prefix', 'payload', 'padding', 'digest'] as const)(
    'chunk hashing returns Err after a WASM %s failure and discards the failed state',
    async (stage) => {
        const hasher = await original.createSHA1();
        const init = vi.spyOn(hasher, 'init');
        if (stage === 'digest') {
            vi.spyOn(hasher, 'digest').mockImplementationOnce(() => {
                throw new Error('WASM failure');
            });
        } else {
            const update = hasher.update.bind(hasher);
            const failAt = { prefix: 1, payload: 2, padding: 3 }[stage];
            let calls = 0;
            vi.spyOn(hasher, 'update').mockImplementation((data) => {
                if (++calls === failAt) throw new Error('WASM failure');

                return update(data);
            });
        }
        vi.mocked(createSHA1).mockResolvedValueOnce(hasher);
        const { hashUploadChunk } = await import('#browser/upload/hash');
        const file = new File([bytes], header.fileName);

        const failed = await hashUploadChunk(file, header);
        expect(failed.unwrapErr().code).toBe('HASH_INITIALIZATION_FAILED');

        const retried = await hashUploadChunk(file, header);
        const encoded = encodeSplitBmp(bytes, header).unwrap();
        expect(retried.unwrap().sha1).toBe(createHash('sha1').update(encoded).digest('hex'));
        expect(createSHA1).toHaveBeenCalledTimes(2);
        expect(init).not.toHaveBeenCalled();
    }
);

test('rejected hasher initialization becomes Err for file and chunk hashing', async () => {
    vi.mocked(createSHA256).mockRejectedValueOnce(new Error('WASM unavailable'));
    vi.mocked(createSHA1).mockRejectedValueOnce(new Error('WASM unavailable'));
    const { hashFile, hashUploadChunk } = await import('#browser/upload/hash');
    const file = new File([bytes], header.fileName);

    const hashed = await hashFile(file, () => {});
    const chunk = await hashUploadChunk(file, header);
    expect(hashed.unwrapErr().code).toBe('HASH_INITIALIZATION_FAILED');
    expect(chunk.unwrapErr().code).toBe('HASH_INITIALIZATION_FAILED');
});

test('progress callback exceptions propagate instead of becoming hashing errors', async () => {
    const { hashFile } = await import('#browser/upload/hash');
    const failure = new Error('callback failure');
    const hashed = hashFile(new File([bytes], header.fileName), () => {
        throw failure;
    });

    await expect(Promise.resolve(hashed)).rejects.toBe(failure);
});
