import type { ApplicationError } from '#lib/errors';
import { Err, Ok, type AsyncResult } from 'results-ts';

export function readJson(request: Request): AsyncResult<unknown, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const body: unknown = await request.json();

            return Ok(body);
        } catch {
            return Err({ code: 'INVALID_JSON_REQUEST', message: 'Invalid JSON request' } as const);
        }
    });
}
