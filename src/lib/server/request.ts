import type { ApplicationError } from '$lib/errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';

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

export function readForm(request: Request): AsyncResult<FormData, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const form = await request.formData();
            return Ok(form);
        } catch {
            return Err({ code: 'INVALID_FORM_REQUEST', message: 'Invalid form request' } as const);
        }
    });
}
