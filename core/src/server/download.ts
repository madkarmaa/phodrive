import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { FileRequest, RemoteBmp } from '../models';
import { ChunkCursor, openChunk } from './chunk-cursor';
import { SERVER_ERRORS, type ServerError } from './errors';

/** Ordered, demand-driven reconstruction with no temporary storage. */
export function streamDownload(
    input: FileRequest,
    chunks: RemoteBmp[],
    requestSignal?: AbortSignal
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const cursor = new ChunkCursor(input, chunks);
        const hash = createHash('sha256');
        let responseController: ReadableStreamDefaultController<Uint8Array> | undefined;

        const cleanup = async () => {
            if (cursor.closed) return;

            requestSignal?.removeEventListener('abort', onAbort);
            await cursor.close();
        };
        const onAbort = () => {
            if (!cursor.closed)
                responseController?.error(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);

            void cleanup();
        };
        requestSignal?.addEventListener('abort', onAbort, { once: true });
        if (requestSignal?.aborted) await cleanup();
        if (cursor.closed) return Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);

        // Validate the first header before sending a response so HTTP errors reach the browser.
        const first = await openChunk(input, chunks[0], cursor.signal);
        if (first.isErr()) {
            await cleanup();

            return first;
        }

        if (cursor.closed) {
            const cancelled = await first.andThenAsync((reader) => reader.close());

            return cancelled.andThen(() => Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE));
        }
        first.inspect((reader) => cursor.begin(reader));

        const finish = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
            const valid = hash.digest('hex') === input.fileHash;
            await cleanup();

            if (valid) controller.close();
            else controller.error(SERVER_ERRORS.FILE_INTEGRITY_FAILED);
        };

        const body = new ReadableStream<Uint8Array>(
            {
                start(controller) {
                    responseController = controller;
                },
                async pull(controller) {
                    if (cursor.closed)
                        return controller.error(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);

                    const next = await cursor.next();
                    if (cursor.closed) return;

                    await next.match({
                        Ok: async (payload) => {
                            if (!payload) return finish(controller);

                            hash.update(payload);
                            controller.enqueue(payload);
                        },
                        Err: async (error) => {
                            controller.error(error);
                            await cleanup();
                        }
                    });
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
