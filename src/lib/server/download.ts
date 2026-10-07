import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { FileRequest, RemoteBmp, SplitHeader } from '#lib/models';
import { SplitBmpReader } from '#server/bmp/stream';
import { MAX_SPLIT_HEADER_BYTES, splitHeaderByteLength } from '#server/bmp';
import { SERVER_ERRORS, type ServerError } from '#server/errors';
import { downloadBmp } from '#server/photos';

function openChunk(
    input: FileRequest,
    chunk: RemoteBmp,
    signal: AbortSignal
): AsyncResult<SplitBmpReader, ServerError> {
    const expected: SplitHeader = {
        fileHash: input.fileHash,
        fileId: input.fileId,
        chunkIndex: chunk.chunkIndex,
        flags: chunk.isLast ? 1 : 0,
        payloadSize: chunk.size,
        fileName: chunk.chunkIndex === 0 ? input.name : undefined
    };

    return splitHeaderByteLength(expected)
        .andThen((length) =>
            length <= MAX_SPLIT_HEADER_BYTES
                ? Ok(undefined)
                : Err(SERVER_ERRORS.INVALID_CHUNK_METADATA)
        )
        .andThenAsync(() =>
            downloadBmp(input.email, input.token, chunk.mediaKey, chunk.sha1, undefined, signal)
        )
        .andThenAsync((response) => SplitBmpReader.open(response, expected, chunk.sha1));
}

/** Ordered, demand-driven reconstruction with no temporary storage. */
export function streamDownload(
    input: FileRequest,
    chunks: RemoteBmp[],
    requestSignal?: AbortSignal
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const abort = new AbortController();
        const hash = createHash('sha256');
        let active: SplitBmpReader | null = null;
        let index = 0;
        let closed = false;
        let responseController: ReadableStreamDefaultController<Uint8Array> | undefined;

        const cleanup = async () => {
            if (closed) return;

            closed = true;
            abort.abort();
            requestSignal?.removeEventListener('abort', onAbort);

            if (active) {
                const cancelled = await active.close();

                cancelled.inspectErr((error) => console.error(error.message));
                active = null;
            }
        };
        const onAbort = () => {
            if (!closed)
                responseController?.error(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);

            void cleanup();
        };
        requestSignal?.addEventListener('abort', onAbort, { once: true });
        if (requestSignal?.aborted) await cleanup();
        if (closed) return Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);

        // Prepare only the first header so authentication and metadata errors remain actionable.
        const first = await openChunk(input, chunks[0], abort.signal);
        if (first.isErr()) {
            await cleanup();

            return first.map(() => new Response());
        }

        first.inspect((reader) => {
            active = reader;
        });
        if (closed) {
            const cancelled = await first.andThenAsync((reader) => reader.close());

            return cancelled.andThen(() => Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE));
        }

        const body = new ReadableStream<Uint8Array>(
            {
                start(controller) {
                    responseController = controller;
                },
                async pull(controller) {
                    while (!closed) {
                        if (!active) {
                            if (index === chunks.length) {
                                const valid = hash.digest('hex') === input.fileHash;
                                await cleanup();
                                if (!valid) {
                                    controller.error(SERVER_ERRORS.FILE_INTEGRITY_FAILED);

                                    return;
                                }

                                controller.close();

                                return;
                            }

                            const opened = await openChunk(input, chunks[index], abort.signal);

                            opened.inspect((reader) => {
                                active = reader;
                            });
                            if (closed) {
                                const cancelled = await opened.andThenAsync((reader) =>
                                    reader.close()
                                );

                                cancelled.inspectErr((error) => console.error(error.message));

                                return;
                            }
                            if (opened.isErr()) {
                                opened.inspectErr((error) => controller.error(error));
                                await cleanup();

                                return;
                            }
                        }
                        if (!active) return;

                        const next = await active.readPayload();
                        if (closed) return;
                        if (next.isErr()) {
                            next.inspectErr((error) => controller.error(error));
                            await cleanup();

                            return;
                        }

                        const delivered = next.match({
                            Ok: (payload) => {
                                if (payload === null) {
                                    active = null;
                                    index++;

                                    return false;
                                }

                                hash.update(payload);
                                controller.enqueue(payload);

                                return true;
                            },
                            Err: () => false
                        });
                        if (delivered) return;
                    }

                    controller.error(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
                },
                cancel: cleanup
            },
            { highWaterMark: 0 }
        );

        return Ok(
            new Response(body, {
                headers: {
                    'content-type': 'application/octet-stream',
                    'cache-control': 'no-store',
                    'x-accel-buffering': 'no'
                }
            })
        );
    });
}
