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
            // Preserve the verification or transport error if cancellation fails.
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

                            const failure = finished.match({
                                Ok: () => null,
                                Err: (error) => error
                            });
                            if (failure) {
                                await fail(failure);

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
    return bmpSource(body, Ok(undefined).and(verification), input.bmp.totalSize, input.sha1);
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

/**
 * Relay a browser-encoded BMP without hashing it; Google rejects bytes that do not match the
 * SHA-1 sent when the upload starts. Only the length is checked, so Google receives exactly the
 * declared size.
 */
export function relayUploadBmp(input: ReceivedUpload): UploadBmpSource {
    const reader = input.payload.getReader();
    const length = input.bmp.totalSize;
    let closed = false;
    let received = 0;
    let settle: (result: Result<void, ServerError>) => void = () => {};
    const verification = new Promise<Result<void, ServerError>>((resolve) => {
        settle = resolve;
    });
    const cleanup = async () => {
        closed = true;

        try {
            await reader.cancel();
        } catch {
            // Preserve the length or transport error if cancellation fails.
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
                    if (received > length) {
                        await fail(SERVER_ERRORS.INVALID_CHUNK_SIZE);

                        return;
                    }

                    controller.enqueue(next.value);

                    return;
                }

                if (received !== length) {
                    await fail(SERVER_ERRORS.INCOMPLETE_FILE);

                    return;
                }

                const finished = await input.finished();
                const failure = finished.match({ Ok: () => null, Err: (error) => error });
                if (failure) {
                    await fail(failure);

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

    return bmpSource(body, Ok(undefined).and(verification), length, input.sha1);
}
