import { json } from '@sveltejs/kit';
import { listBmps } from '$server/photos';
import { readJson } from '$server/request';
import { LibraryRequestSchema } from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const body = await readJson(request);
    const parsed = body.andThen((value) =>
        schemaResult(LibraryRequestSchema, value, 'Invalid request')
    );
    const input = parsed.match({ Ok: (value) => value, Err: () => null });
    if (!input) return json({ error: 'Invalid request' }, { status: 400 });

    const files = await listBmps(input.email, input.token, input.pageToken ?? '');
    return files.match({
        Ok: (value) => json(value, { headers: { 'cache-control': 'no-store' } }),
        Err: () =>
            json(
                { error: 'Could not load Google Photos files.' },
                { status: 400, headers: { 'cache-control': 'no-store' } }
            )
    });
};
