import type { ApplicationError } from '$lib/errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { ErrorResponseSchema } from '$lib/models';
import { schemaResult } from '$lib/schema-result';

function readJson(response: Response, fallback: string): AsyncResult<unknown, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const data: unknown = await response.json();
            return Ok(data);
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: fallback } as const);
        }
    });
}

/** Preserve server error messages while handling transport failures at the fetch boundary. */
export function request(
    url: string,
    init: RequestInit,
    fallback: string
): AsyncResult<Response, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let response: Response;

        try {
            response = await fetch(url, init);
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: fallback } as const);
        }

        if (response.ok) return Ok(response);

        const body = await readJson(response, fallback);
        return body.andThen((data) => {
            const parsed = schemaResult(ErrorResponseSchema, data, fallback);
            const message = parsed.match({ Ok: (value) => value.error, Err: () => fallback });

            return Err({ code: 'REQUEST_FAILED', message } as const);
        });
    });
}

export function apiJson(
    url: string,
    init: RequestInit,
    fallback: string
): AsyncResult<unknown, ApplicationError> {
    return request(url, init, fallback).andThenAsync((response) => readJson(response, fallback));
}

export function apiBytes(
    url: string,
    init: RequestInit,
    fallback: string
): AsyncResult<Uint8Array, ApplicationError> {
    return request(url, init, fallback).andThenAsync(async (response) => {
        try {
            const body = await response.arrayBuffer();
            return Ok(new Uint8Array(body));
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: fallback } as const);
        }
    });
}
