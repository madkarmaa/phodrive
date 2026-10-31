import {
    FileActionKind,
    FileActionRequestSchema,
    LibraryPageRequestSchema
} from '@madkarmaa/phodrive-core/models';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { deleteFile, downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { Hono } from 'hono';
import { GoogleTokenSchema, SignUpSchema } from '#lib/auth';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import { handleAuthRequest } from '#server/auth';
import { AUTH_ERRORS } from '#server/errors';
import { readGoogleEmail, saveGoogleAccount } from '#server/google';
import { requireGoogleAccount, requireUser, type ApiBindings } from '#server/middleware';
import { signUp } from '#server/signup';

/** Better Auth endpoints the web app uses; signup goes through the Google-linking route instead. */
const PUBLIC_AUTH_ROUTES = new Set(['GET /get-session', 'POST /sign-in/email', 'POST /sign-out']);

const authRoutes = new Hono<{ Bindings: ApiBindings }>().all('/*', (c) => {
    const route = `${c.req.method} ${c.req.path.slice('/api/auth'.length)}`;
    if (!PUBLIC_AUTH_ROUTES.has(route)) return errorResponse(AUTH_ERRORS.NOT_FOUND);

    return handleAuthRequest(c.req.raw, c.env.clientAddress).match({
        Ok: (response) => response,
        Err: errorResponse
    });
});

const accountRoutes = new Hono<{ Bindings: ApiBindings }>()
    .post('/', (c) =>
        readJsonRequest(c.req.raw, SignUpSchema, 'Enter your email, password, and Google token.')
            .andThenAsync((input) => signUp(c.req.raw, c.env.clientAddress, input))
            .match({
                Ok: (cookies) =>
                    jsonResponse(
                        { signedUp: true },
                        cookies.map((cookie): [string, string] => ['set-cookie', cookie])
                    ),
                Err: errorResponse
            })
    )
    .put('/google', requireUser, (c) => {
        const user = c.get('user');

        return readJsonRequest(c.req.raw, GoogleTokenSchema, 'Enter an OAuth2 or AAS token.')
            .andThenAsync(({ token }) =>
                readGoogleEmail(user).andThenAsync((email) =>
                    connectGoogleAccount(email, token).andThenAsync((aasToken) =>
                        saveGoogleAccount(user.id, { email, token: aasToken })
                    )
                )
            )
            .match({ Ok: () => jsonResponse({ connected: true }), Err: errorResponse });
    });

/** Google Photos routes act for the signed-in user with the token stored on the server. */
const driveRoutes = new Hono<{ Bindings: ApiBindings }>()
    .post('/library', requireUser, requireGoogleAccount, (c) => {
        const { email, token } = c.get('account');

        return readJsonRequest(c.req.raw, LibraryPageRequestSchema, 'Invalid request')
            .andThenAsync((input) => listBmps(email, token, input.pageToken ?? ''))
            .match({ Ok: jsonResponse, Err: errorResponse });
    })
    .post('/files', requireUser, requireGoogleAccount, (c) => {
        const account = c.get('account');

        return readJsonRequest(c.req.raw, FileActionRequestSchema, 'Invalid request')
            .andThenAsync((input) =>
                input.action === FileActionKind.Download
                    ? downloadFile({ ...input, ...account }, c.req.raw.signal)
                    : deleteFile({ ...input, ...account }).map(jsonResponse)
            )
            .match({ Ok: (response) => response, Err: errorResponse });
    })
    .post('/upload', requireUser, requireGoogleAccount, (c) =>
        receiveUpload(c.req.raw, c.get('account')).match({ Ok: uploadStream, Err: errorResponse })
    );

export const api = new Hono<{ Bindings: ApiBindings }>()
    .basePath('/api')
    .route('/auth', authRoutes)
    .route('/account', accountRoutes)
    .route('/', driveRoutes)
    .notFound(() => errorResponse(AUTH_ERRORS.NOT_FOUND));
