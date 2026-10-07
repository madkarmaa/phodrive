import type { ServerError } from '#server/errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { Fetcher } from '#server/fetcher';

export function send(
    fetcher: Fetcher,
    url: string | URL,
    init: RequestInit,
    stage: string
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let response: Response;

        try {
            response = await fetcher(url, init);
        } catch {
            return Err({
                code: 'REQUEST_FAILED',
                message: init.signal?.aborted ? `${stage} timed out` : `${stage} failed`
            } as const);
        }
        if (response.status !== 200) {
            try {
                await response.body?.cancel();
            } catch {
                // Preserve the HTTP failure when cancelling its response body also fails.
            }

            return Err({
                code: 'REQUEST_FAILED',
                message: `${stage} failed (HTTP ${response.status})`
            } as const);
        }

        return Ok(response);
    });
}

export function readBody(response: Response, stage: string): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const body = await response.arrayBuffer();

            return Ok(Buffer.from(body));
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: `${stage} failed` } as const);
        }
    });
}
