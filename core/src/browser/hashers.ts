import type { IHasher } from 'hash-wasm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../errors';
import { MAX_CONCURRENT_WORKERS } from '../models';

// Result-returning wrappers around hash-wasm, whose WASM calls can throw.

export const HASH_ERROR = {
    code: 'HASH_INITIALIZATION_FAILED',
    message: 'Could not prepare file hashing.'
} as const satisfies ApplicationError;

export const FILE_READ_ERROR = {
    code: 'FILE_READ_FAILED',
    message: 'Could not read the selected file.'
} as const satisfies ApplicationError;

/** Reuse an idle hasher from `available` when there is one, or create a new one. */
export function acquireHasher(
    factory: () => Promise<IHasher>,
    available: IHasher[] = []
): AsyncResult<IHasher, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const reusable = available.pop();
            if (reusable) return Ok(reusable.init());

            const hasher = await factory();

            return Ok(hasher);
        } catch {
            return Err(HASH_ERROR);
        }
    });
}

/** A failed WASM operation may leave its state unusable; a failed file read does not. */
export function releaseHasher(
    hasher: IHasher,
    available: IHasher[],
    result: Result<unknown, ApplicationError>
): void {
    const reusable = result.match({
        Ok: () => true,
        Err: (error) => error.code === FILE_READ_ERROR.code
    });

    if (reusable && available.length < MAX_CONCURRENT_WORKERS) available.push(hasher);
}

export function updateHasher(hasher: IHasher, bytes: Uint8Array): Result<void, ApplicationError> {
    try {
        hasher.update(bytes);

        return Ok(undefined);
    } catch {
        return Err(HASH_ERROR);
    }
}

export function digestHasher(hasher: IHasher): Result<string, ApplicationError> {
    try {
        return Ok(hasher.digest('hex'));
    } catch {
        return Err(HASH_ERROR);
    }
}
