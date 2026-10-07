import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { SplitHeader } from '$lib/models';
import {
    decodeSplitHeader,
    MAX_PHOTOS_BMP_BYTES,
    MAX_SPLIT_HEADER_BYTES,
    splitHeaderByteLength
} from '$server/bmp';
import { SERVER_ERRORS, type ServerError } from '$server/errors';

/** Retain only the split header and the current network block, never a whole BMP. */
export class SplitBmpReader {
    private readonly hash = createHash('sha1');
    private pending: Uint8Array = new Uint8Array(0);
    private received = 0;
    private offset = 0;
    private totalSize = 0;
    private payloadEnd = 0;
    private closed = false;

    private constructor(
        private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
        private readonly sha1: string
    ) {}

    static open(
        response: Response,
        expected: SplitHeader,
        sha1: string
    ): AsyncResult<SplitBmpReader, ServerError> {
        return splitHeaderByteLength(expected).andThenAsync(async (length) => {
            if (!response.body) return Err(SERVER_ERRORS.MISSING_DOWNLOAD_BODY);

            const bmp = new SplitBmpReader(response.body.getReader(), sha1);
            const initialized = await bmp.readHeader(length, expected);
            if (initialized.isErr()) {
                const closed = await bmp.close();
                closed.inspectErr((error) => console.error(error.message));
                return initialized.map(() => bmp);
            }

            return Ok(bmp);
        });
    }

    private readBlock(): AsyncResult<Uint8Array | null, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            try {
                const next = await this.reader.read();
                if (next.done) return Ok(null);

                this.received += next.value.byteLength;
                this.hash.update(next.value);
                return Ok(next.value);
            } catch {
                return Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
            }
        });
    }

    private readHeader(length: number, expected: SplitHeader): AsyncResult<void, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            if (length > MAX_SPLIT_HEADER_BYTES) return Err(SERVER_ERRORS.INVALID_CHUNK_METADATA);

            const prefix = new Uint8Array(length);
            while (this.offset < length) {
                const next = await this.readBlock();
                if (next.isErr()) return next.map(() => undefined);

                const copied = next.andThen((block) => {
                    if (block === null) return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

                    const remaining = length - this.offset;
                    const part = block.subarray(0, remaining);
                    prefix.set(part, this.offset);
                    this.offset += part.length;
                    this.pending = block.subarray(part.length);
                    return Ok(undefined);
                });
                if (copied.isErr()) return copied;
            }

            this.totalSize = new DataView(prefix.buffer).getUint32(2, true);
            if (this.totalSize > MAX_PHOTOS_BMP_BYTES || this.received > this.totalSize)
                return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

            return decodeSplitHeader(prefix, this.totalSize).andThen(
                ({ header, payloadOffset }): Result<void, ServerError> => {
                    if (
                        header.fileHash !== expected.fileHash ||
                        header.fileId !== expected.fileId ||
                        header.chunkIndex !== expected.chunkIndex ||
                        header.flags !== expected.flags ||
                        header.payloadSize !== expected.payloadSize ||
                        header.fileName !== expected.fileName ||
                        payloadOffset !== length
                    )
                        return Err(SERVER_ERRORS.DOWNLOAD_CHUNK_MISMATCH);

                    this.payloadEnd = payloadOffset + header.payloadSize;
                    return Ok(undefined);
                }
            );
        });
    }

    /** Null means the complete BMP, including padding and SHA-1, has been verified. */
    readPayload(): AsyncResult<Uint8Array | null, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            while (!this.closed) {
                const next = this.pending.length ? Ok(this.pending) : await this.readBlock();
                this.pending = new Uint8Array(0);
                if (this.closed) return Ok(null);
                if (next.isErr()) return next;

                const processed = next.andThen((block): Result<Uint8Array | null, ServerError> => {
                    if (block === null) {
                        if (this.received !== this.totalSize)
                            return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);
                        if (this.hash.digest('hex') !== this.sha1)
                            return Err(SERVER_ERRORS.DOWNLOAD_INTEGRITY_FAILED);

                        this.closed = true;
                        this.reader.releaseLock();
                        return Ok(null);
                    }
                    if (this.received > this.totalSize)
                        return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

                    const payloadBytes = Math.max(0, this.payloadEnd - this.offset);
                    const payload = block.subarray(0, payloadBytes);
                    if (block.subarray(payload.length).some(Boolean))
                        return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

                    this.offset += block.length;
                    return Ok(payload);
                });
                const ready = processed.match({
                    Ok: (payload) => payload === null || payload.length > 0,
                    Err: () => true
                });
                if (ready) return processed;
            }

            return Ok(null);
        });
    }

    close(): AsyncResult<void, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            if (this.closed) return Ok(undefined);
            this.closed = true;
            this.pending = new Uint8Array(0);

            try {
                await this.reader.cancel();
                return Ok(undefined);
            } catch {
                return Err(SERVER_ERRORS.COULD_NOT_CLOSE_THE_DOWNLOADED_FILE);
            } finally {
                this.reader.releaseLock();
            }
        });
    }
}
