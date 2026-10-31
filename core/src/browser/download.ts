import { createSHA1, createSHA256, type IHasher } from 'hash-wasm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../errors';
import type { FileGroup } from '../files';
import type { RemoteBmp, SplitHeader } from '../models';
import { encodeSplitPrefix } from '../bmp/format';
import { request } from './api';

const CHUNK_URL = '/api/chunk';

const INCOMPLETE_CHUNKS = {
    code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
    message: 'Load the remaining chunks before downloading.'
} as const satisfies ApplicationError;
const INTEGRITY_FAILED = {
    code: 'DOWNLOAD_INTEGRITY_FAILED',
    message: 'The downloaded file failed its integrity check.'
} as const satisfies ApplicationError;
const RECEIVE_FAILED = {
    code: 'DOWNLOAD_RECEIVE_FAILED',
    message: 'Could not receive the downloaded file.'
} as const satisfies ApplicationError;
const HASH_FAILED = {
    code: 'HASH_INITIALIZATION_FAILED',
    message: 'Could not prepare file hashing.'
} as const satisfies ApplicationError;

/** Every chunk must be present, in order, and belong to this file before anything is fetched. */
function orderedChunks(item: FileGroup): Result<RemoteBmp[], ApplicationError> {
    const chunks = item.chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
    const complete =
        item.complete &&
        chunks.length > 0 &&
        chunks.length === item.chunkCount &&
        chunks.every(
            (chunk, index) =>
                chunk.chunkIndex === index &&
                chunk.isLast === (index === chunks.length - 1) &&
                chunk.fileHash === item.fileHash &&
                chunk.fileId === item.fileId &&
                (index !== 0 || chunk.originalName === item.name)
        );

    return complete ? Ok(chunks) : Err(INCOMPLETE_CHUNKS);
}

function expectedHeader(item: FileGroup, chunk: RemoteBmp): SplitHeader {
    return {
        fileHash: item.fileHash,
        fileId: item.fileId,
        chunkIndex: chunk.chunkIndex,
        flags: chunk.isLast ? 1 : 0,
        payloadSize: chunk.size,
        fileName: chunk.chunkIndex === 0 ? item.name : undefined
    };
}

function createHasher(factory: () => Promise<IHasher>): AsyncResult<IHasher, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const hasher = await factory();

            return Ok(hasher);
        } catch {
            return Err(HASH_FAILED);
        }
    });
}

function update(hasher: IHasher, bytes: Uint8Array): Result<void, ApplicationError> {
    try {
        hasher.update(bytes);

        return Ok(undefined);
    } catch {
        return Err(HASH_FAILED);
    }
}

function digest(hasher: IHasher): Result<string, ApplicationError> {
    try {
        return Ok(hasher.digest('hex'));
    } catch {
        return Err(HASH_FAILED);
    }
}

/** Tracks one BMP as it streams in: the exact expected prefix, then the payload, then padding. */
class ChunkVerifier {
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
            const hashed = update(this.fileHasher, payload);
            if (hashed.isErr()) return hashed;

            // Copy the payload so the received block, prefix and padding included, can be released.
            this.parts.push(payload.slice());
        }

        this.offset = end;

        return update(this.bmpHasher, block);
    }

    finish(sha1: string): Result<void, ApplicationError> {
        if (this.offset !== this.totalSize) return Err(INTEGRITY_FAILED);

        return digest(this.bmpHasher).andThen((actual) =>
            actual === sha1 ? Ok(undefined) : Err(INTEGRITY_FAILED)
        );
    }
}

function readBody(
    response: Response,
    verifier: ChunkVerifier
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, ApplicationError>> => {
        if (!response.body) return Err(RECEIVE_FAILED);

        const reader = response.body.getReader();

        try {
            while (true) {
                let next: ReadableStreamReadResult<Uint8Array>;

                try {
                    next = await reader.read();
                } catch {
                    return Err(RECEIVE_FAILED);
                }
                if (next.done) return Ok(undefined);

                const accepted = verifier.accept(next.value);
                if (accepted.isErr()) return accepted;
            }
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    });
}

/** Fetch one stored BMP through the server relay and keep only its verified payload. */
function readChunk(
    item: FileGroup,
    chunk: RemoteBmp,
    fileHasher: IHasher,
    parts: Uint8Array<ArrayBuffer>[]
): AsyncResult<void, ApplicationError> {
    const header = expectedHeader(item, chunk);

    return encodeSplitPrefix(header).andThenAsync(({ prefix, totalSize }) =>
        createHasher(createSHA1).andThenAsync((bmpHasher) => {
            const verifier = new ChunkVerifier(
                prefix,
                header.payloadSize,
                totalSize,
                bmpHasher,
                fileHasher,
                parts
            );

            return request(
                CHUNK_URL,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ mediaKey: chunk.mediaKey, sha1: chunk.sha1 })
                },
                'Download failed'
            )
                .andThenAsync((response) => readBody(response, verifier))
                .andThen(() => verifier.finish(chunk.sha1));
        })
    );
}

/** Decode and verify every chunk in the browser; the server only relays the stored bytes. */
export function downloadChunks(item: FileGroup): AsyncResult<Blob, ApplicationError> {
    return orderedChunks(item).andThenAsync((chunks) =>
        createHasher(createSHA256).andThenAsync(async (fileHasher) => {
            const parts: Uint8Array<ArrayBuffer>[] = [];

            for (const chunk of chunks) {
                const read = await readChunk(item, chunk, fileHasher, parts);
                if (read.isErr()) return read;
            }

            return digest(fileHasher).andThen((actual) =>
                actual === item.fileHash ? Ok(new Blob(parts)) : Err(INTEGRITY_FAILED)
            );
        })
    );
}
