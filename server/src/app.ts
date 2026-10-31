import {
    GoogleTokenRequestSchema,
    GoogleTokenSchema,
    SignUpRequestSchema,
    type SessionResponse
} from '@madkarmaa/phodrive-core/auth';
import {
    ChunkFormat,
    ChunkReferenceSchema,
    FileActionKind,
    FileActionRequestSchema,
    LibraryPageRequestSchema,
    ProcessingMode
} from '@madkarmaa/phodrive-core/models';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { deleteFile, downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp, listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { fileUploadStream, receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import { Hono } from 'hono';
import { errorResponse, jsonResponse, readJsonRequest } from './api';
import { handleAuthRequest, readSessionUser } from './auth';
import type { ServerContext } from './context';
import { AUTH_ERRORS } from './errors';
import { readGoogleEmail, saveGoogleAccount } from './google';
import { requireGoogleAccount, requireUser, type ApiEnv } from './middleware';
import { signUp } from './signup';
import { decryptToken, publicTokenKey } from './token-key';

/** Better Auth endpoints the web app uses; signup goes through the Google-linking route instead. */
const PUBLIC_AUTH_ROUTES = new Set(['GET /get-session', 'POST /sign-in/email', 'POST /sign-out']);
const TOKEN_FORMAT_ERROR = 'Enter an OAuth2 or AAS token.';

/** Decrypt a token encrypted in the page, then check it looks like a Google token. */
function readEncryptedToken(encrypted: string) {
    return decryptToken(encrypted).andThen((token) =>
        schemaResult(GoogleTokenSchema, { token }, TOKEN_FORMAT_ERROR).map((input) => input.token)
    );
}

function relayedChunk(response: Response): Response {
    const headers = new Headers({
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store'
    });
    const length = response.headers.get('content-length');
    if (length) headers.set('content-length', length);

    return new Response(response.body, { headers });
}

/** What the web app needs before it renders: who is signed in, and how this server works. */
function sessionRoutes(context: ServerContext) {
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

function authRoutes({ auth }: ServerContext) {
    return new Hono<ApiEnv>().all('/*', (c) => {
        const route = `${c.req.method} ${c.req.path.slice('/api/auth'.length)}`;
        if (!PUBLIC_AUTH_ROUTES.has(route)) return errorResponse(AUTH_ERRORS.NOT_FOUND);

        return handleAuthRequest(auth, c.req.raw, c.get('clientAddress')).match({
            Ok: (response) => response,
            Err: errorResponse
        });
    });
}

function accountRoutes(context: ServerContext) {
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

/** Google Photos routes act for the signed-in user with the token stored on the server. */
function driveRoutes(context: ServerContext) {
    const signedIn = requireUser(context);
    const connected = requireGoogleAccount(context);

    return new Hono<ApiEnv>()
        .post('/library', signedIn, connected, (c) => {
            const { email, token } = c.get('account');

            return readJsonRequest(c.req.raw, LibraryPageRequestSchema, 'Invalid request')
                .andThenAsync((input) => listBmps(email, token, input.pageToken ?? ''))
                .match({ Ok: jsonResponse, Err: errorResponse });
        })
        .post('/files', signedIn, connected, (c) => {
            const account = c.get('account');

            return readJsonRequest(c.req.raw, FileActionRequestSchema, 'Invalid request')
                .andThenAsync((input) =>
                    input.action === FileActionKind.Download
                        ? downloadFile({ ...input, ...account }, c.req.raw.signal)
                        : deleteFile({ ...input, ...account }).map(jsonResponse)
                )
                .match({ Ok: (response) => response, Err: errorResponse });
        })
        .post('/upload', signedIn, connected, (c) => {
            const account = c.get('account');

            // Browsers send finished chunks to relay, or whole files for the server to process.
            if (context.env.PHODRIVE_PROCESSING === ProcessingMode.Browser)
                return receiveUpload(c.req.raw, account, ChunkFormat.Bmp).match({
                    Ok: uploadStream,
                    Err: errorResponse
                });

            return receiveFileUpload(c.req.raw).match({
                Ok: (received) => fileUploadStream(received, account),
                Err: errorResponse
            });
        })
        .post('/chunk', signedIn, connected, (c) => {
            const { email, token } = c.get('account');

            // Relays one stored BMP unchanged for the browser to verify and decode.
            return readJsonRequest(c.req.raw, ChunkReferenceSchema, 'Invalid request')
                .andThenAsync(({ mediaKey, sha1 }) =>
                    downloadBmp(email, token, mediaKey, sha1, undefined, c.req.raw.signal)
                )
                .match({ Ok: relayedChunk, Err: errorResponse });
        });
}

/** The JSON API under /api; the caller sets the `clientAddress` variable for each request. */
export function createApi(context: ServerContext) {
    return (
        new Hono<ApiEnv>()
            .basePath('/api')
            .route('/session', sessionRoutes(context))
            .route('/auth', authRoutes(context))
            .route('/account', accountRoutes(context))
            .route('/', driveRoutes(context))
            // A mounted app's notFound handler is not used, so unknown API paths end here instead.
            .all('*', () => errorResponse(AUTH_ERRORS.NOT_FOUND))
    );
}
