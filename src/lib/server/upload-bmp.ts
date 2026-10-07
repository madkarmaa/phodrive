import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '$server/errors';
import type { ReceivedUpload } from '$server/upload-input';

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
    const reader = input.payload.getReader();
    const zeros = new Uint8Array(TRANSFER_BLOCK_BYTES);
    let phase: 'prefix' | 'payload' | 'padding' = 'prefix';
    let closed = false;
    let received = 0;
    let padding = input.bmp.paddingSize;
    let pending: Uint8Array = new Uint8Array();
    let settle: (result: Result<void, ServerError>) => void = () => {};
    const verification = new Promise<Result<void, ServerError>>((resolve) => {
        settle = resolve;
    });
    const cleanup = async () => {
        closed = true;
        pending = new Uint8Array();
        try {
            await reader.cancel();
        } catch {
            // Keep the primary verification/transport failure.
        } finally {
            reader.releaseLock();
        }
    };
    const body = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                const fail = async (error: ServerError) => {
                    settle(Err(error));
                    controller.error(error);
                    await cleanup();
                };
                if (closed) return;
                if (phase === 'prefix') {
                    phase = 'payload';
                    hash.update(input.bmp.prefix);
                    controller.enqueue(input.bmp.prefix);
                    return;
                }
                if (phase === 'payload') {
                    if (!pending.length) {
                        let next: ReadableStreamReadResult<Uint8Array>;
                        try {
                            next = await reader.read();
                        } catch {
                            await fail(SERVER_ERRORS.FILE_RECEIVE_FAILED);
                            return;
                        }
                        if (closed) return;
                        if (!next.done) {
                            received += next.value.length;
                            if (received > input.header.payloadSize) {
                                await fail(SERVER_ERRORS.INVALID_CHUNK_SIZE);
                                return;
                            }
                            pending = next.value;
                        } else {
                            if (received !== input.header.payloadSize) {
                                await fail(SERVER_ERRORS.INCOMPLETE_FILE);
                                return;
                            }
                            const finished = await input.finished();
                            if (closed) return;
                            if (finished.isErr()) {
                                const error = finished.match({
                                    Ok: () => SERVER_ERRORS.FILE_RECEIVE_FAILED,
                                    Err: (error) => error
                                });
                                await fail(error);
                                return;
                            }
                            phase = 'padding';
                        }
                    }
                    if (pending.length) {
                        const block = pending.subarray(0, TRANSFER_BLOCK_BYTES);
                        pending = pending.subarray(block.length);
                        hash.update(block);
                        controller.enqueue(block);
                        return;
                    }
                }
                if (padding > 0) {
                    const block = zeros.subarray(0, padding);
                    padding -= block.length;
                    hash.update(block);
                    controller.enqueue(block);
                    return;
                }
                if (hash.digest('hex') !== input.sha1) {
                    await fail(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);
                    return;
                }
                closed = true;
                reader.releaseLock();
                settle(Ok(undefined));
                controller.close();
            },
            async cancel() {
                settle(Err(SERVER_ERRORS.FILE_RECEIVE_FAILED));
                await cleanup();
            }
        },
        { highWaterMark: 0 }
    );
    const verified = Ok(undefined).andThenAsync(async () => await verification);
    return {
        body,
        verified,
        length: input.bmp.totalSize,
        sha1: input.sha1,
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
