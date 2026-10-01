import { json } from '@sveltejs/kit';
import { downloadBmp, moveToTrash } from '$server/photos';
import { readJson } from '$server/request';
import { FileRequestSchema } from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const body = await readJson(request);
    const parsed = body.andThen((value) =>
        schemaResult(FileRequestSchema, value, 'Invalid request')
    );
    const input = parsed.match({ Ok: (value) => value, Err: () => null });
    if (!input) return json({ error: 'Invalid request' }, { status: 400 });

    const { action, email, token, mediaKey, sha1 } = input;
    if (action === 'download') {
        if (typeof mediaKey !== 'string')
            return json({ error: 'Invalid request' }, { status: 400 });

        const downloaded = await downloadBmp(email, token, mediaKey, sha1);
        return downloaded.match({
            Ok: (bmp) =>
                new Response(new Uint8Array(bmp), {
                    headers: { 'content-type': 'image/bmp', 'cache-control': 'no-store' }
                }),
            Err: () =>
                json(
                    { error: 'Download failed. Check your account and try again.' },
                    { status: 400, headers: { 'cache-control': 'no-store' } }
                )
        });
    }

    const deleted = await moveToTrash(email, token, sha1);
    return deleted.match({
        Ok: () => json({ deleted: true }, { headers: { 'cache-control': 'no-store' } }),
        Err: () =>
            json(
                { error: 'Could not move this file to Google Photos trash.' },
                { status: 400, headers: { 'cache-control': 'no-store' } }
            )
    });
};
