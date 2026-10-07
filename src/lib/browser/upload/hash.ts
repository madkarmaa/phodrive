import { createSHA1, createSHA256, sha256, type IHasher } from 'hash-wasm';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '$lib/errors';
import type { SplitHeader } from '$lib/models';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES } from '$lib/bmp/format';

export const HASH_BLOCK_BYTES = 1024 * 1024;
const ZERO_BLOCK = new Uint8Array(64 * 1024);
const FILE_HASHES = new WeakMap<File, string>();

function createHasher(factory: () => Promise<IHasher>): AsyncResult<IHasher, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
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

    return createHasher(createSHA256).andThenAsync((hash) =>
        hashBlob(file, hash, onProgress).map(() => {
            const digest = hash.digest('hex');
            FILE_HASHES.set(file, digest);

            return digest;
        })
    );
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
        createHasher(createSHA1).andThenAsync((hash) => {
            hash.update(prefix);

            return hashBlob(payload, hash, () => {}).map(() => {
                for (let offset = 0; offset < paddingSize; offset += ZERO_BLOCK.length)
                    hash.update(ZERO_BLOCK.subarray(0, paddingSize - offset));

                return { sha1: hash.digest('hex'), size: totalSize };
            });
        })
    );
}
