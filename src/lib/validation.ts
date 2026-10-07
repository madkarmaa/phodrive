import type { ApplicationError } from '#lib/errors';
import { Err, Ok, type Result } from 'results-ts';
import type { z } from 'zod';

export function schemaResult<T>(
    schema: z.ZodType<T>,
    value: unknown,
    message: string
): Result<T, ApplicationError> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return Err({ code: 'INVALID_SCHEMA', message } as const);

    return Ok(parsed.data);
}
