import { sha256 } from '@noble/hashes/sha2.js';
import { Err, Ok, type AsyncResult } from 'results-ts';

const HASH_READ_BYTES = 8_000_000;

export function hashFile(
    file: File,
    onProgress?: (bytesRead: number) => void
): AsyncResult<string, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const hash = sha256.create();
        onProgress?.(0);

        for (let start = 0; start < file.size; start += HASH_READ_BYTES) {
            let bytes: ArrayBuffer;

            try {
                bytes = await file.slice(start, start + HASH_READ_BYTES).arrayBuffer();
            } catch {
                return Err(new Error('Could not read the selected file.'));
            }

            hash.update(new Uint8Array(bytes));
            onProgress?.(Math.min(file.size, start + HASH_READ_BYTES));
        }

        return Ok(Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    });
}
