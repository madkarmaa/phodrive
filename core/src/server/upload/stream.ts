import type { AsyncResult } from 'results-ts';
import { UploadEventType, type UploadEvent } from '../../models';
import type { ServerError } from '../errors';
import type { ReceivedUpload } from './input';
import { uploadFiles } from './index';

/** Work reported over an upload event stream, and the cleanup that ends its request. */
export interface UploadTask {
    run: (emit: (event: UploadEvent) => void) => AsyncResult<void, { message: string }>;
    cancel: () => AsyncResult<void, ServerError>;
}

/** Coalesce progress so a paused browser cannot grow the server's event queue. */
export function uploadEventStream({ run, cancel }: UploadTask): Response {
    let open = true;
    let finished = false;
    let progress: UploadEvent | null = null;
    const confirmations: UploadEvent[] = [];
    const encoder = new TextEncoder();
    const flush = (controller: ReadableStreamDefaultController<Uint8Array>) => {
        // Enqueue only while the browser is reading, so events coalesce instead of queueing.
        if (!open || (controller.desiredSize ?? 0) <= 0) return;

        const event = progress ?? confirmations.shift();
        if (event) {
            progress = null;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

            return;
        }
        if (finished) {
            controller.close();
            open = false;
        }
    };
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            const emit = (event: UploadEvent) => {
                if (!open) return;
                if (event.type === UploadEventType.Progress) progress = event;
                else confirmations.push(event);

                flush(controller);
            };
            const execute = async () => {
                const completed = await run(emit);

                const cancelled = await cancel();

                completed
                    .andThen(() => cancelled)
                    .match({
                        Ok: () => emit({ type: UploadEventType.Complete }),
                        Err: (error) => emit({ type: UploadEventType.Error, error: error.message })
                    });
                finished = true;
                flush(controller);
            };
            void execute();
        },
        pull: flush,
        async cancel() {
            open = false;
            progress = null;
            confirmations.length = 0;

            const cancelled = await cancel();

            cancelled.inspectErr((error) => console.error(error.message));
        }
    });

    return new Response(body, {
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no'
        }
    });
}

/** Encode or relay one received chunk while reporting its upload events. */
export function uploadStream(input: ReceivedUpload): Response {
    return uploadEventStream({ run: (emit) => uploadFiles(input, emit), cancel: input.cancel });
}
