import { createSHA1, createSHA256, sha256, type IHasher } from 'hash-wasm';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '$lib/errors';
import { MAX_CONCURRENT_WORKERS, type SplitHeader } from '$lib/models';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES } from '$lib/bmp/format';

export const HASH_BLOCK_BYTES = 1024 * 1024;
const ZERO_BLOCK = new Uint8Array(64 * 1024);
const FILE_HASHES = new WeakMap<File, string>();
const SHA256_HASHERS: IHasher[] = [];
const SHA1_HASHERS: IHasher[] = [];

function createHasher(
    factory: () => Promise<IHasher>,
    available: IHasher[]
): AsyncResult<IHasher, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const reusable = available.pop();
            if (reusable) return Ok(reusable.init());

            const hasher = await factory();

            return Ok(hasher);
        } catch {
            return Err({
                code: 'HASH_INITIALIZATION_FAILED',
                message: 'Could not prepare file hashing.'
            } as const);
        }
    });
}

function hashBlob(
    blob: Blob,
    hash: IHasher,
    onProgress: (read: number) => void
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        for (let offset = 0; offset < blob.size; offset += HASH_BLOCK_BYTES) {
            let bytes: ArrayBuffer;

            try {
                bytes = await blob.slice(offset, offset + HASH_BLOCK_BYTES).arrayBuffer();
            } catch {
                return Err({
                    code: 'FILE_READ_FAILED',
                    message: 'Could not read the selected file.'
                } as const);
            }
            hash.update(new Uint8Array(bytes));
            onProgress(Math.min(offset + HASH_BLOCK_BYTES, blob.size));
        }

        return Ok(undefined);
    });
}

/** Read the original in bounded slices; a retry can reuse its immutable File's identity. */
export function hashFile(
    file: File,
    onProgress: (read: number) => void
): AsyncResult<string, ApplicationError> {
    const cached = FILE_HASHES.get(file);
    if (cached) {
        onProgress(file.size);

        return Ok(cached).andThenAsync(async (hash) => Ok(hash));
    }

    return createHasher(createSHA256, SHA256_HASHERS).andThenAsync(async (hash) => {
        const hashed = await hashBlob(file, hash, onProgress);
        const result = hashed.map(() => {
            const digest = hash.digest('hex');
            FILE_HASHES.set(file, digest);

            return digest;
        });

        // A state is exclusively owned until its read completes, including failed reads.
        if (SHA256_HASHERS.length < MAX_CONCURRENT_WORKERS) SHA256_HASHERS.push(hash);

        return result;
    });
}

export function uploadIdentity(
    name: string,
    fileHash: string
): AsyncResult<string, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const identity = await sha256(`${fileHash}\0${name}\0${MAX_CHUNK_PAYLOAD_BYTES}`);

            return Ok(identity);
        } catch {
            return Err({
                code: 'HASH_INITIALIZATION_FAILED',
                message: 'Could not prepare file hashing.'
            } as const);
        }
    });
}

/** Google requires the full encoded BMP SHA-1 before its upload session starts. */
export function hashUploadChunk(
    payload: Blob,
    header: SplitHeader
): AsyncResult<{ sha1: string; size: number }, ApplicationError> {
    return encodeSplitPrefix(header).andThenAsync(({ prefix, totalSize, paddingSize }) =>
        createHasher(createSHA1, SHA1_HASHERS).andThenAsync(async (hash) => {
            hash.update(prefix);

            const hashed = await hashBlob(payload, hash, () => {});
            const result = hashed.map(() => {
                for (let offset = 0; offset < paddingSize; offset += ZERO_BLOCK.length)
                    hash.update(ZERO_BLOCK.subarray(0, paddingSize - offset));

                return { sha1: hash.digest('hex'), size: totalSize };
            });

            if (SHA1_HASHERS.length < MAX_CONCURRENT_WORKERS) SHA1_HASHERS.push(hash);

            return result;
        })
    );
}
