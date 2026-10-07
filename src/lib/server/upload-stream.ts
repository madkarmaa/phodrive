import { UploadEventType, type UploadEvent } from '$lib/models';
import type { ReceivedUpload } from '$server/upload-input';
import { uploadFiles } from '$server/uploads';

/** Coalesce progress so a paused browser cannot grow the server's event queue. */
export function uploadStream(input: ReceivedUpload): Response {
    let open = true;
    let finished = false;
    let progress: UploadEvent | null = null;
    const confirmations: UploadEvent[] = [];
    const encoder = new TextEncoder();
    const flush = (controller: ReadableStreamDefaultController<Uint8Array>) => {
        if (!open || !controller.desiredSize || controller.desiredSize < 0) return;
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
            const run = async () => {
                const uploaded = await uploadFiles(input, emit);
                const cancelled = await input.cancel();
                uploaded
                    .andThen(() => cancelled)
                    .match({
                        Ok: () => emit({ type: UploadEventType.Complete }),
                        Err: (error) => emit({ type: UploadEventType.Error, error: error.message })
                    });
                finished = true;
                flush(controller);
            };
            void run();
        },
        pull: flush,
        async cancel() {
            open = false;
            progress = null;
            confirmations.length = 0;
            const cancelled = await input.cancel();
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
