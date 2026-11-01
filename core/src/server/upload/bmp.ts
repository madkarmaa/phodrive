import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedUpload } from './input';

const TRANSFER_BLOCK_BYTES = 64 * 1024;

export interface UploadBmpSource {
    body: ReadableStream<Uint8Array>;
    length: number;
    sha1: string;
    verified: AsyncResult<void, ServerError>;
    drain: () => AsyncResult<void, ServerError>;
}

/** The next block to send, or null once the BMP is complete. */
type NextBlock = () => AsyncResult<Uint8Array | null, ServerError>;

interface PayloadReader {
    read: NextBlock;
    /** Stop reading; a pending read then reports a failure that the stream ignores. */
    cancel: () => Promise<void>;
    release: () => void;
}

/** Read the received payload, failing when it runs longer or shorter than `expected` bytes. */
function payloadReader(input: ReceivedUpload, expected: number): PayloadReader {
    const reader = input.payload.getReader();
    let received = 0;
    let stopped = false;

    const read: NextBlock = () =>
        Ok(undefined).andThenAsync(async () => {
            let next: ReadableStreamReadResult<Uint8Array>;
            try {
                next = await reader.read();
            } catch {
                return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
            }
            if (stopped) return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);

            if (!next.done) {
                received += next.value.length;

                return received > expected ? Err(SERVER_ERRORS.INVALID_CHUNK_SIZE) : Ok(next.value);
            }
            if (received !== expected) return Err(SERVER_ERRORS.INCOMPLETE_FILE);

            const finished = await input.finished();

            return finished.map(() => null);
        });

    return {
        read,
        cancel: async () => {
            stopped = true;

            try {
                await reader.cancel();
            } catch {
                // Preserve the verification or transport error if cancellation fails.
            } finally {
                reader.releaseLock();
            }
        },
        release: () => reader.releaseLock()
    };
}

/** Send blocks on demand; the first failure errors the body and settles `verified`. */
function verifiedStream(next: NextBlock, payload: PayloadReader) {
    let closed = false;
    let settle: (result: Result<void, ServerError>) => void = () => {};
    const verification = new Promise<Result<void, ServerError>>((resolve) => {
        settle = resolve;
    });
    const stop = async (error: ServerError, controller?: ReadableStreamDefaultController) => {
        closed = true;
        settle(Err(error));
        controller?.error(error);
        await payload.cancel();
    };

    const body = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                if (closed) return;

                const block = await next();
                if (closed) return;

                await block.match({
                    Ok: async (value) => {
                        if (value) return controller.enqueue(value);

                        closed = true;
                        payload.release();
                        settle(Ok(undefined));
                        controller.close();
                    },
                    Err: (error) => stop(error, controller)
                });
            },
            cancel: () => stop(SERVER_ERRORS.FILE_RECEIVE_FAILED)
        },
        { highWaterMark: 0 }
    );

    return { body, verified: Ok(undefined).and(verification) };
}

/** Encode and verify a BMP in fixed-sized pieces before permitting the Google commit. */
export function encodeUploadBmp(input: ReceivedUpload): UploadBmpSource {
    const hash = createHash('sha1');
    const payload = payloadReader(input, input.header.payloadSize);
    const zeros = new Uint8Array(TRANSFER_BLOCK_BYTES);
    let prefixSent = false;
    let payloadDone = false;
    let pending: Uint8Array = new Uint8Array();
    let padding = input.bmp.paddingSize;

    const nextBlock: NextBlock = () =>
        Ok(undefined).andThenAsync(async (): Promise<Result<Uint8Array | null, ServerError>> => {
            if (!prefixSent) {
                prefixSent = true;

                return Ok(input.bmp.prefix);
            }

            while (!pending.length && !payloadDone) {
                const read = await payload.read();
                if (read.isErr()) return read;

                read.inspect((part) => {
                    if (part) pending = part;
                    else payloadDone = true;
                });
            }
            if (pending.length) {
                const block = pending.subarray(0, TRANSFER_BLOCK_BYTES);
                pending = pending.subarray(block.length);

                return Ok(block);
            }
            if (padding > 0) {
                const block = zeros.subarray(0, padding);
                padding -= block.length;

                return Ok(block);
            }

            return Ok(null);
        });

    const hashedBlock: NextBlock = () =>
        nextBlock().andThen((block) => {
            if (block) {
                hash.update(block);

                return Ok(block);
            }

            return hash.digest('hex') === input.sha1
                ? Ok(null)
                : Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);
        });

    const { body, verified } = verifiedStream(hashedBlock, payload);

    return bmpSource(body, verified, input.bmp.totalSize, input.sha1);
}

/**
 * Relay a browser-encoded BMP without hashing it; Google rejects bytes that do not match the
 * SHA-1 sent when the upload starts. Only the length is checked, so Google receives exactly the
 * declared size.
 */
export function relayUploadBmp(input: ReceivedUpload): UploadBmpSource {
    const length = input.bmp.totalSize;
    const payload = payloadReader(input, length);
    const { body, verified } = verifiedStream(payload.read, payload);

    return bmpSource(body, verified, length, input.sha1);
}

/** Drain lets an already-stored chunk finish reading its request before reporting the result. */
function bmpSource(
    body: ReadableStream<Uint8Array>,
    verified: AsyncResult<void, ServerError>,
    length: number,
    sha1: string
): UploadBmpSource {
    return {
        body,
        verified,
        length,
        sha1,
        drain: () =>
            Ok(undefined).andThenAsync(async () => {
                const bmpReader = body.getReader();

                try {
                    while (true) {
                        const next = await bmpReader.read();
                        if (next.done) break;
                    }
                } catch {
                    return await verified;
                } finally {
                    bmpReader.releaseLock();
                }

                return await verified;
            })
    };
}
