import { UploadEventType, type UploadEvent } from '$lib/models';
import type { ReceivedUpload } from '$server/upload-input';
import { uploadFiles } from '$server/uploads';
import { removeTemporaryDirectory } from '$server/temporary-files';

/** One POST streams every job's progress and confirmation without retaining credentials. */
export function uploadStream(input: ReceivedUpload): Response {
    let open = true;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            const emit = (event: UploadEvent) => {
                if (!open) return;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };

            const uploaded = await uploadFiles(input, emit);
            const removed = await removeTemporaryDirectory(input.directory);
            uploaded
                .andThen(() => removed)
                .match({
                    Ok: () => emit({ type: UploadEventType.Complete }),
                    Err: (error) => emit({ type: UploadEventType.Error, error: error.message })
                });
            if (open) controller.close();
            open = false;
        },
        cancel() {
            // Active Google commits must settle; their input is removed after all workers finish.
            open = false;
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
