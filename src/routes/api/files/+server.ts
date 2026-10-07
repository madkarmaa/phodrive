import { FileActionKind, FileRequestSchema } from '$lib/models';
import { json } from '@sveltejs/kit';
import { downloadFile, deleteFile } from '$server/files';
import { readJson } from '$server/request';
import { schemaResult } from '$lib/schema-result';
import type { z } from 'zod';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const body = await readJson(request);
    const parsed = body.andThen((value) =>
        schemaResult(FileRequestSchema, value, 'Invalid request')
    );
    const input = parsed.match<z.infer<typeof FileRequestSchema> | Response>({
        Ok: (value) => value,
        Err: (error) => json({ error: error.message }, { status: 400 })
    });
    if (input instanceof Response) return input;

    if (input.action === FileActionKind.Download) {
        const downloaded = await downloadFile(input, request.signal);
        return downloaded.match({
            Ok: (response) => response,
            Err: (error) =>
                json(
                    { error: error.message },
                    { status: 400, headers: { 'cache-control': 'no-store' } }
                )
        });
    }

    const deleted = await deleteFile(input);
    return deleted.match({
        Ok: (result) => json(result, { headers: { 'cache-control': 'no-store' } }),
        Err: (error) =>
            json(
                { error: error.message },
                { status: 400, headers: { 'cache-control': 'no-store' } }
            )
    });
};
