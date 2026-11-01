import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedUpload } from './input';

/** The next block to send, or null once the BMP is complete. */
export type NextBlock = () => AsyncResult<Uint8Array | null, ServerError>;

export interface PayloadReader {
    read: NextBlock;
    /** Stop reading; a pending read then reports a failure that the stream ignores. */
    cancel: () => Promise<void>;
    release: () => void;
}

/** Read the received payload, failing when it runs longer or shorter than `expected` bytes. */
export function payloadReader(input: ReceivedUpload, expected: number): PayloadReader {
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
export function verifiedStream(next: NextBlock, payload: PayloadReader) {
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
