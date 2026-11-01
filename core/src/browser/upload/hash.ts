import { createSHA1, createSHA256, sha256, type IHasher } from 'hash-wasm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../../errors';
import type { SplitHeader } from '../../models';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES } from '../../bmp/format';
import {
    acquireHasher,
    digestHasher,
    FILE_READ_ERROR,
    HASH_ERROR,
    releaseHasher,
    updateHasher
} from '../hashers';

export const HASH_BLOCK_BYTES = 1024 * 1024;
// Avoid native digest call overhead for tiny files.
const NATIVE_HASH_MIN_BYTES = 32 * 1024;
const ZERO_BLOCK = new Uint8Array(64 * 1024);
const FILE_HASHES = new WeakMap<File, string>();
// Only idle states are pooled; an operation owns its hasher through reads and digesting.
const AVAILABLE_SHA256_HASHERS: IHasher[] = [];
const AVAILABLE_SHA1_HASHERS: IHasher[] = [];

function hashBlob(
    blob: Blob,
    hasher: IHasher,
    onProgress: (read: number) => void
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        for (let offset = 0; offset < blob.size; offset += HASH_BLOCK_BYTES) {
            let bytes: ArrayBuffer;

            try {
                bytes = await blob.slice(offset, offset + HASH_BLOCK_BYTES).arrayBuffer();
            } catch {
                return Err(FILE_READ_ERROR);
            }

            const updated = updateHasher(hasher, new Uint8Array(bytes));
            if (updated.isErr()) return updated;

            onProgress(Math.min(offset + HASH_BLOCK_BYTES, blob.size));
        }

        return Ok(undefined);
    });
}

/** The caller limits native hashing to one read block to bound memory and preserve progress. */
function hashFileNatively(file: File, subtle: SubtleCrypto): AsyncResult<string, ApplicationError> {
    return Ok(undefined).andThenAsync<string, ApplicationError>(async () => {
        let bytes: ArrayBuffer;

        try {
            bytes = await file.slice(0, file.size).arrayBuffer();
        } catch {
            return Err(FILE_READ_ERROR);
        }

        try {
            const digest = await subtle.digest('SHA-256', bytes);

            return Ok(
                Array.from(new Uint8Array(digest), (byte) =>
                    byte.toString(16).padStart(2, '0')
                ).join('')
            );
        } catch {
            return Err(HASH_ERROR);
        }
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

    const subtle = globalThis.crypto?.subtle;
    if (subtle && file.size >= NATIVE_HASH_MIN_BYTES && file.size <= HASH_BLOCK_BYTES) {
        return hashFileNatively(file, subtle)
            .map((digest) => {
                FILE_HASHES.set(file, digest);
                onProgress(file.size);

                return digest;
            })
            .orElseAsync(async (error) => {
                if (error.code !== 'HASH_INITIALIZATION_FAILED') return Err(error);

                return await hashFileIncrementally(file, onProgress);
            });
    }

    return hashFileIncrementally(file, onProgress);
}

function hashFileIncrementally(
    file: File,
    onProgress: (read: number) => void
): AsyncResult<string, ApplicationError> {
    return acquireHasher(createSHA256, AVAILABLE_SHA256_HASHERS).andThenAsync(async (hasher) => {
        const hashed = await hashBlob(file, hasher, onProgress);
        const result = hashed
            .andThen(() => digestHasher(hasher))
            .inspect((digest) => {
                FILE_HASHES.set(file, digest);
            });
        releaseHasher(hasher, AVAILABLE_SHA256_HASHERS, result);

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
            return Err(HASH_ERROR);
        }
    });
}

/** Google requires the full encoded BMP SHA-1 before its upload session starts. */
export function hashUploadChunk(
    payload: Blob,
    header: SplitHeader
): AsyncResult<{ sha1: string; size: number }, ApplicationError> {
    return encodeSplitPrefix(header).andThenAsync(({ prefix, totalSize, paddingSize }) =>
        acquireHasher(createSHA1, AVAILABLE_SHA1_HASHERS).andThenAsync(async (hasher) => {
            const prefixed = updateHasher(hasher, prefix);
            if (prefixed.isErr()) return prefixed;

            const hashed = await hashBlob(payload, hasher, () => {});
            const result = hashed.andThen(() => {
                for (let offset = 0; offset < paddingSize; offset += ZERO_BLOCK.length) {
                    const updated = updateHasher(
                        hasher,
                        ZERO_BLOCK.subarray(0, paddingSize - offset)
                    );
                    if (updated.isErr()) return updated;
                }

                return digestHasher(hasher).map((sha1) => ({ sha1, size: totalSize }));
            });
            releaseHasher(hasher, AVAILABLE_SHA1_HASHERS, result);

            return result;
        })
    );
}
