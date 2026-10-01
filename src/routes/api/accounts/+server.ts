import { json } from '@sveltejs/kit';
import { NewAccountSchema } from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import { connectGoogleAccount } from '$server/accounts';
import { readJson } from '$server/request';
import type { RequestHandler } from './$types';

const RESPONSE_HEADERS = { 'cache-control': 'no-store' };

export const POST: RequestHandler = async ({ request }) => {
    const body = await readJson(request);
    const parsed = body.andThen((value) =>
        schemaResult(NewAccountSchema, value, 'Invalid account')
    );
    const input = parsed.match({ Ok: (value) => value, Err: () => null });

    if (!input) {
        return json({ error: 'Invalid account' }, { status: 400, headers: RESPONSE_HEADERS });
    }

    const connected = await connectGoogleAccount(input.email, input.token);

    return connected.match({
        Ok: (token) => json({ token }, { headers: RESPONSE_HEADERS }),
        Err: (error) => json({ error: error.message }, { status: 400, headers: RESPONSE_HEADERS })
    });
};
