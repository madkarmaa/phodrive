import { listBmps } from '#server/photos';
import { readJson } from '#server/request';
import { LibraryRequestSchema } from '#lib/models';
import { schemaResult } from '#lib/validation';
import type { z } from 'zod';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const body = await readJson(request);

    const parsed = body.andThen((value) =>
        schemaResult(LibraryRequestSchema, value, 'Invalid request')
    );
    const input = parsed.match<z.infer<typeof LibraryRequestSchema> | Response>({
        Ok: (value) => value,
        Err: (error) => Response.json({ error: error.message }, { status: 400 })
    });
    if (input instanceof Response) return input;

    const files = await listBmps(input.email, input.token, input.pageToken ?? '');

    return files.match({
        Ok: (value) => Response.json(value, { headers: { 'cache-control': 'no-store' } }),
        Err: (error) =>
            Response.json(
                { error: error.message },
                { status: 400, headers: { 'cache-control': 'no-store' } }
            )
    });
};
