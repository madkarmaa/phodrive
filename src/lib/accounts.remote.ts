import { command } from '$app/server';
import { NewAccountSchema, type AccountConnection } from '$lib/models';
import { connectGoogleAccount } from '$server/accounts';

export const connectAccount = command(NewAccountSchema, async ({ email, token }) => {
    const connected = await connectGoogleAccount(email, token);

    // Only plain, typed data crosses SvelteKit's serialization boundary.
    return connected.match<AccountConnection>({
        Ok: (token) => ({ token }),
        Err: (error) => ({ error: error.message })
    });
});
