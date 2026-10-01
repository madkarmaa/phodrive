import { FileActionKind, FileRequestSchema } from '$lib/models';
import { json } from '@sveltejs/kit';
import { downloadFile, deleteFile } from '$server/files';
import { readJson } from '$server/request';
import { schemaResult } from '$lib/schema-result';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const body = await readJson(request);
    const parsed = body.andThen((value) =>
        schemaResult(FileRequestSchema, value, 'Invalid request')
    );
    const input = parsed.match({ Ok: (value) => value, Err: () => null });
    if (!input) return json({ error: 'Invalid request' }, { status: 400 });

    if (input.action === FileActionKind.Download) {
        const downloaded = await downloadFile(input);
        return downloaded.match({
            Ok: (response) => response,
            Err: (error) =>
                json(
                    {
                        error: /^(Load the remaining|Downloaded chunks|Reconstructed file)/.test(
                            error.message
                        )
                            ? error.message
                            : 'Download failed. Check your account and try again.'
                    },
                    { status: 400, headers: { 'cache-control': 'no-store' } }
                )
        });
    }

    const deleted = await deleteFile(input);
    return deleted.match({
        Ok: (result) => json(result, { headers: { 'cache-control': 'no-store' } }),
        Err: () =>
            json(
                { error: 'Could not move this file to Google Photos trash.' },
                { status: 400, headers: { 'cache-control': 'no-store' } }
            )
    });
};
