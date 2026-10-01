import { Err, Ok, type Result } from 'results-ts';
import type { z } from 'zod';

export function schemaResult<T>(
    schema: z.ZodType<T>,
    value: unknown,
    message: string
): Result<T, Error> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return Err(new Error(message));

    return Ok(parsed.data);
}
