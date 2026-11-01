import {
    GoogleTokenRequestSchema,
    GoogleTokenSchema,
    SignUpRequestSchema,
    type SessionResponse
} from '@madkarmaa/phodrive-core/auth';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import { Hono } from 'hono';
import { errorResponse, jsonResponse, readJsonRequest } from '../api';
import { handleAuthRequest, readSessionUser } from '../auth';
import type { ServerContext } from '../context';
import { AUTH_ERRORS } from '../errors';
import { readGoogleEmail, saveGoogleAccount } from '../google';
import { requireUser, type ApiEnv } from '../middleware';
import { signUp } from '../signup';
import { decryptToken, publicTokenKey } from '../token-key';

/** Better Auth endpoints the web app uses; signup goes through the Google-linking route instead. */
const PUBLIC_AUTH_ROUTES = new Set(['GET /get-session', 'POST /sign-in/email', 'POST /sign-out']);
const TOKEN_FORMAT_ERROR = 'Enter an OAuth2 or AAS token.';

/** Decrypt a token encrypted in the page, then check it looks like a Google token. */
function readEncryptedToken(encrypted: string) {
    return decryptToken(encrypted).andThen((token) =>
        schemaResult(GoogleTokenSchema, { token }, TOKEN_FORMAT_ERROR).map((input) => input.token)
    );
}

/** What the web app needs before it renders: who is signed in, and how this server works. */
export function sessionRoutes(context: ServerContext) {
    const { env } = context;

    return new Hono<ApiEnv>().get('/', (c) =>
        readSessionUser(context.auth, c.req.raw.headers).match({
            Ok: (user) => {
                const session: SessionResponse = {
                    user: user ? { email: user.email } : null,
                    signupEnabled: !env.PHODRIVE_DISABLE_SIGNUP,
                    processing: env.PHODRIVE_PROCESSING,
                    preferencesDefaults: env.preferencesDefaults
                };

                return jsonResponse(session);
            },
            Err: errorResponse
        })
    );
}

export function authRoutes({ auth }: ServerContext) {
    return new Hono<ApiEnv>().all('/*', (c) => {
        const route = `${c.req.method} ${c.req.path.slice('/api/auth'.length)}`;
        if (!PUBLIC_AUTH_ROUTES.has(route)) return errorResponse(AUTH_ERRORS.NOT_FOUND);

        return handleAuthRequest(auth, c.req.raw, c.get('clientAddress')).match({
            Ok: (response) => response,
            Err: errorResponse
        });
    });
}

export function accountRoutes(context: ServerContext) {
    return new Hono<ApiEnv>()
        .get('/key', () =>
            publicTokenKey().match({ Ok: (key) => jsonResponse({ key }), Err: errorResponse })
        )
        .post('/', (c) =>
            readJsonRequest(
                c.req.raw,
                SignUpRequestSchema,
                'Enter your email, password, and Google token.'
            )
                .andThenAsync(({ email, password, encryptedToken }) =>
                    readEncryptedToken(encryptedToken).map((token) => ({ email, password, token }))
                )
                .andThenAsync((input) => signUp(context, c.req.raw, c.get('clientAddress'), input))
                .match({
                    Ok: (cookies) =>
                        jsonResponse(
                            { signedUp: true },
                            cookies.map((cookie): [string, string] => ['set-cookie', cookie])
                        ),
                    Err: errorResponse
                })
        )
        .put('/google', requireUser(context), (c) => {
            const user = c.get('user');

            return readJsonRequest(c.req.raw, GoogleTokenRequestSchema, TOKEN_FORMAT_ERROR)
                .andThenAsync(({ encryptedToken }) => readEncryptedToken(encryptedToken))
                .andThenAsync((token) =>
                    readGoogleEmail(context, user).andThenAsync((email) =>
                        connectGoogleAccount(email, token).andThenAsync((aasToken) =>
                            saveGoogleAccount(context, user.id, { email, token: aasToken })
                        )
                    )
                )
                .match({ Ok: () => jsonResponse({ connected: true }), Err: errorResponse });
        });
}
