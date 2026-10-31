import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { readJson } from '@madkarmaa/phodrive-core/server/request';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AsyncResult } from 'results-ts';
import type { z } from 'zod';

// Responses carry account data or credentials, so neither results nor errors are cached.
const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export function readJsonRequest<T>(
    request: Request,
    schema: z.ZodType<T>,
    message: string
): AsyncResult<T, ApplicationError> {
    return readJson(request).andThen((body) => schemaResult(schema, body, message));
}

export function jsonResponse(body: unknown, headers?: HeadersInit): Response {
    const response = Response.json(body, { headers });
    response.headers.set('cache-control', 'no-store');

    return response;
}

/** Errors without their own status are client errors. */
export function errorResponse(error: { message: string; status?: ContentfulStatusCode }): Response {
    return Response.json(
        { error: error.message },
        { status: error.status ?? 400, headers: NO_STORE_HEADERS }
    );
}
