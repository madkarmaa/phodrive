import { createSHA1, createSHA256, sha256, type IHasher } from 'hash-wasm';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '#lib/errors';
import { MAX_CONCURRENT_WORKERS, type SplitHeader } from '#lib/models';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES } from '#lib/bmp/format';

export const HASH_BLOCK_BYTES = 1024 * 1024;
// Avoid native digest call overhead for tiny files.
const NATIVE_HASH_MIN_BYTES = 32 * 1024;
const ZERO_BLOCK = new Uint8Array(64 * 1024);
const FILE_HASHES = new WeakMap<File, string>();

// Only idle states are pooled; an operation owns its hasher through reads and digesting.
const AVAILABLE_SHA256_HASHERS: IHasher[] = [];
const AVAILABLE_SHA1_HASHERS: IHasher[] = [];

function acquireHasher(
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
    hasher: IHasher,
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

            hasher.update(new Uint8Array(bytes));
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
            return Err({
                code: 'FILE_READ_FAILED',
                message: 'Could not read the selected file.'
            } as const);
        }

        try {
            const digest = await subtle.digest('SHA-256', bytes);

            return Ok(
                Array.from(new Uint8Array(digest), (byte) =>
                    byte.toString(16).padStart(2, '0')
                ).join('')
            );
        } catch {
            return Err({
                code: 'HASH_INITIALIZATION_FAILED',
                message: 'Could not prepare file hashing.'
            } as const);
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
        const result = hashed.map(() => {
            const digest = hasher.digest('hex');
            FILE_HASHES.set(file, digest);

            return digest;
        });

        // Limit retained WASM states, including states returned after a failed read.
        if (AVAILABLE_SHA256_HASHERS.length < MAX_CONCURRENT_WORKERS)
            AVAILABLE_SHA256_HASHERS.push(hasher);

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
        acquireHasher(createSHA1, AVAILABLE_SHA1_HASHERS).andThenAsync(async (hasher) => {
            hasher.update(prefix);

            const hashed = await hashBlob(payload, hasher, () => {});
            const result = hashed.map(() => {
                for (let offset = 0; offset < paddingSize; offset += ZERO_BLOCK.length)
                    hasher.update(ZERO_BLOCK.subarray(0, paddingSize - offset));

                return { sha1: hasher.digest('hex'), size: totalSize };
            });

            if (AVAILABLE_SHA1_HASHERS.length < MAX_CONCURRENT_WORKERS)
                AVAILABLE_SHA1_HASHERS.push(hasher);

            return result;
        })
    );
}
