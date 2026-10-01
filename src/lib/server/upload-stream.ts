import type { UploadEvent } from '$lib/models';
import { photosFetchWithProgress } from '$server/fetcher';
import { uploadBmp } from '$server/photos';

const PROGRESS_INTERVAL_MS = 100;

export function safeUploadError(error: Error): string {
    return /^(Enter a valid account|Invalid file name|Invalid chunk|File is too large|AAS authentication failed|Hash lookup|Upload start|Upload transfer|Commit rejected|Commit outcome uncertain)/.test(
        error.message
    )
        ? error.message
        : 'Upload failed. Check your credentials and connection, then try again.';
}

/** One POST carries progress and the final result; no credential-bearing polling requests. */
export function uploadStream(email: string, token: string, name: string, bmp: Buffer): Response {
    let open = true;
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            const emit = (event: UploadEvent) => {
                if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };
            let lastUpdate = 0;
            const fetcher = photosFetchWithProgress((sent) => {
                const now = performance.now();
                if (lastUpdate && now - lastUpdate < PROGRESS_INTERVAL_MS && sent !== bmp.length)
                    return;

                lastUpdate = now;
                emit({ type: 'progress', sent, total: bmp.length });
            });

            emit({ type: 'progress', sent: 0, total: bmp.length });
            const uploaded = await uploadBmp(email, token, name, bmp, fetcher);

            uploaded.match({
                Ok: (result) => emit({ type: 'complete', result }),
                Err: (error) => emit({ type: 'error', error: safeUploadError(error) })
            });

            if (open) controller.close();
            open = false;
        },
        cancel() {
            // The Google operation must settle even if the browser disconnects.
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
