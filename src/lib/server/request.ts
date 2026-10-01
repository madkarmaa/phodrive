import { Err, Ok, type AsyncResult, type Result } from 'results-ts';

export function readJson(request: Request): AsyncResult<unknown, Error> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const body: unknown = await request.json();
            return Ok(body);
        } catch {
            return Err(new Error('Invalid JSON request'));
        }
    });
}

export function readForm(request: Request): AsyncResult<FormData, Error> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const form = await request.formData();
            return Ok(form);
        } catch {
            return Err(new Error('Invalid form request'));
        }
    });
}
