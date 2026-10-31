import type { Account } from '@madkarmaa/phodrive-core/models';
import { createMiddleware } from 'hono/factory';
import { requireSessionUser, type SessionUser } from '#server/auth';
import { errorResponse } from '#server/api';
import { readGoogleAccount } from '#server/google';

/** Values the SvelteKit route passes to every API request. */
export type ApiBindings = { clientAddress: string };

export const requireUser = createMiddleware<{
    Bindings: ApiBindings;
    Variables: { user: SessionUser };
}>(async (c, next) => {
    const user = await requireSessionUser(c.req.raw.headers);

    return user.match<Promise<void> | Response>({
        Ok: async (signedIn) => {
            c.set('user', signedIn);
            await next();
        },
        Err: errorResponse
    });
});

/** Load the signed-in user's Google account; its token never leaves the server. */
export const requireGoogleAccount = createMiddleware<{
    Bindings: ApiBindings;
    Variables: { user: SessionUser; account: Account };
}>(async (c, next) => {
    const account = await readGoogleAccount(c.get('user').id);

    return account.match<Promise<void> | Response>({
        Ok: async (connected) => {
            c.set('account', connected);
            await next();
        },
        Err: errorResponse
    });
});
