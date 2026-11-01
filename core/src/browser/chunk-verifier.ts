import type { IHasher } from 'hash-wasm';
import { Err, Ok, type Result } from 'results-ts';
import type { ApplicationError } from '../errors';
import { digestHasher, updateHasher } from './hashers';

export const INTEGRITY_FAILED = {
    code: 'DOWNLOAD_INTEGRITY_FAILED',
    message: 'The downloaded file failed its integrity check.'
} as const satisfies ApplicationError;

/** Tracks one BMP as it streams in: the exact expected prefix, then the payload, then padding. */
export class ChunkVerifier {
    private offset = 0;

    constructor(
        private readonly prefix: Uint8Array,
        private readonly payloadSize: number,
        private readonly totalSize: number,
        private readonly bmpHasher: IHasher,
        private readonly fileHasher: IHasher,
        private readonly parts: Uint8Array<ArrayBuffer>[]
    ) {}

    accept(block: Uint8Array): Result<void, ApplicationError> {
        const start = this.offset;
        const end = start + block.length;
        if (end > this.totalSize) return Err(INTEGRITY_FAILED);

        for (let position = start; position < Math.min(end, this.prefix.length); position++) {
            if (block[position - start] !== this.prefix[position]) return Err(INTEGRITY_FAILED);
        }

        const payloadStart = Math.max(start, this.prefix.length);
        const payloadEnd = Math.min(end, this.prefix.length + this.payloadSize);
        if (payloadStart < payloadEnd) {
            const payload = block.subarray(payloadStart - start, payloadEnd - start);
            const hashed = updateHasher(this.fileHasher, payload);
            if (hashed.isErr()) return hashed;

            // Copy the payload so the received block, prefix and padding included, can be released.
            this.parts.push(payload.slice());
        }

        this.offset = end;

        return updateHasher(this.bmpHasher, block);
    }

    finish(sha1: string): Result<void, ApplicationError> {
        if (this.offset !== this.totalSize) return Err(INTEGRITY_FAILED);

        return digestHasher(this.bmpHasher).andThen((actual) =>
            actual === sha1 ? Ok(undefined) : Err(INTEGRITY_FAILED)
        );
    }
}
