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
import { Hono } from 'hono';
import { GoogleTokenRequestSchema, GoogleTokenSchema, SignUpRequestSchema } from '#lib/auth';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import { handleAuthRequest } from '#server/auth';
import { AUTH_ERRORS } from '#server/errors';
import { readGoogleEmail, saveGoogleAccount } from '#server/google';
import { requireGoogleAccount, requireUser, type ApiBindings } from '#server/middleware';
import { processingMode } from '#server/processing';
import { signUp } from '#server/signup';
import { decryptToken, publicTokenKey } from '#server/token-key';

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

const TOKEN_FORMAT_ERROR = 'Enter an OAuth2 or AAS token.';

/** Decrypt a token encrypted in the page, then check it looks like a Google token. */
function readEncryptedToken(encrypted: string) {
    return decryptToken(encrypted).andThen((token) =>
        schemaResult(GoogleTokenSchema, { token }, TOKEN_FORMAT_ERROR).map((input) => input.token)
    );
}

const accountRoutes = new Hono<{ Bindings: ApiBindings }>()
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

        return readJsonRequest(c.req.raw, GoogleTokenRequestSchema, TOKEN_FORMAT_ERROR)
            .andThenAsync(({ encryptedToken }) => readEncryptedToken(encryptedToken))
            .andThenAsync((token) =>
                readGoogleEmail(user).andThenAsync((email) =>
                    connectGoogleAccount(email, token).andThenAsync((aasToken) =>
                        saveGoogleAccount(user.id, { email, token: aasToken })
                    )
                )
            )
            .match({ Ok: () => jsonResponse({ connected: true }), Err: errorResponse });
    });

function relayedChunk(response: Response): Response {
    const headers = new Headers({
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store'
    });
    const length = response.headers.get('content-length');
    if (length) headers.set('content-length', length);

    return new Response(response.body, { headers });
}

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
    .post('/upload', requireUser, requireGoogleAccount, (c) => {
        const account = c.get('account');

        // Browsers send finished chunks to relay, or whole files for the server to process.
        if (processingMode() === ProcessingMode.Browser)
            return receiveUpload(c.req.raw, account, ChunkFormat.Bmp).match({
                Ok: uploadStream,
                Err: errorResponse
            });

        return receiveFileUpload(c.req.raw).match({
            Ok: (received) => fileUploadStream(received, account),
            Err: errorResponse
        });
    })
    .post('/chunk', requireUser, requireGoogleAccount, (c) => {
        const { email, token } = c.get('account');

        // Relays one stored BMP unchanged for the browser to verify and decode.
        return readJsonRequest(c.req.raw, ChunkReferenceSchema, 'Invalid request')
            .andThenAsync(({ mediaKey, sha1 }) =>
                downloadBmp(email, token, mediaKey, sha1, undefined, c.req.raw.signal)
            )
            .match({ Ok: relayedChunk, Err: errorResponse });
    });

export const api = new Hono<{ Bindings: ApiBindings }>()
    .basePath('/api')
    .route('/auth', authRoutes)
    .route('/account', accountRoutes)
    .route('/', driveRoutes)
    .notFound(() => errorResponse(AUTH_ERRORS.NOT_FOUND));
