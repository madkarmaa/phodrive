import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedUpload } from './input';
import { payloadReader, verifiedStream, type NextBlock } from './verified-stream';

const TRANSFER_BLOCK_BYTES = 64 * 1024;

export interface UploadBmpSource {
    body: ReadableStream<Uint8Array>;
    length: number;
    sha1: string;
    verified: AsyncResult<void, ServerError>;
    drain: () => AsyncResult<void, ServerError>;
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
