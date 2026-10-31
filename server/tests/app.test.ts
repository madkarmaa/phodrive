import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { ChunkFormat, ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { downloadBmp, listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import {
    SessionResponseSchema,
    TOKEN_ENCRYPTION,
    TokenKeySchema
} from '@madkarmaa/phodrive-core/auth';
import { Hono } from 'hono';
import { createApi } from '../src/app';
import { handleAuthRequest, readSessionUser, requireSessionUser } from '../src/auth';
import { AUTH_ERRORS } from '../src/errors';
import { readGoogleAccount, readGoogleEmail, saveGoogleAccount } from '../src/google';
import type { ApiEnv } from '../src/middleware';
import { signUp } from '../src/signup';
import { testContext } from './helpers/context';

const USER = { id: 'user-id', email: 'test@example.com' };
const ACCOUNT = { email: 'test@example.com', token: 'aas_et/stored' };
const CLIENT_ADDRESS = '203.0.113.7';

vi.mock('../src/auth', () => ({
    createAuth: vi.fn(() => ({})),
    handleAuthRequest: vi.fn(),
    readSessionUser: vi.fn(),
    requireSessionUser: vi.fn()
}));
vi.mock('../src/google', () => ({
    readGoogleAccount: vi.fn(),
    readGoogleEmail: vi.fn(),
    saveGoogleAccount: vi.fn()
}));
vi.mock('../src/signup', () => ({ signUp: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/accounts', () => ({ connectGoogleAccount: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    listBmps: vi.fn()
}));
vi.mock('@madkarmaa/phodrive-core/server/upload/input', () => ({ receiveUpload: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/upload/file', () => ({
    fileUploadStream: vi.fn(),
    receiveFileUpload: vi.fn()
}));

function resolved<T>(value: T) {
    return Ok(value).andThenAsync(async (current) => Ok(current));
}

function rejected<E>(error: E) {
    return Ok(undefined).andThenAsync(async () => Err(error));
}

let processing = ProcessingMode.Browser;

/** The API as the server mounts it, with the socket address the server would set. */
function call(path: string, init: RequestInit = {}) {
    const app = new Hono<ApiEnv>()
        .use(async (c, next) => {
            c.set('clientAddress', CLIENT_ADDRESS);
            await next();
        })
        .route('/', createApi(testContext({ PHODRIVE_PROCESSING: processing })));

    return app.fetch(new Request(`http://localhost${path}`, init));
}

/** Encrypt like the browser does, with the key the server publishes. */
async function encrypted(token: string): Promise<string> {
    const response = await call('/api/account/key');
    const { key } = TokenKeySchema.parse(await response.json());
    const publicKey = await crypto.subtle.importKey('jwk', key, TOKEN_ENCRYPTION, false, [
        'encrypt'
    ]);
    const ciphertext = await crypto.subtle.encrypt(
        TOKEN_ENCRYPTION,
        publicKey,
        new TextEncoder().encode(token)
    );

    return Buffer.from(ciphertext).toString('base64');
}

function postJson(path: string, body: unknown, method = 'POST') {
    return call(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    vi.mocked(readGoogleAccount).mockReturnValue(resolved(ACCOUNT));
    processing = ProcessingMode.Browser;
});

test('drive routes refuse signed-out requests before contacting Google', async () => {
    vi.mocked(requireSessionUser).mockReturnValue(rejected(AUTH_ERRORS.SIGNED_OUT));

    for (const path of ['/api/library', '/api/files', '/api/upload']) {
        const response = await postJson(path, {});
        const body: unknown = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: AUTH_ERRORS.SIGNED_OUT.message });
    }

    expect(readGoogleAccount).not.toHaveBeenCalled();
    expect(listBmps).not.toHaveBeenCalled();
    expect(receiveUpload).not.toHaveBeenCalled();
});

test('the library uses the stored account and ignores credentials sent by the client', async () => {
    vi.mocked(listBmps).mockReturnValue(resolved({ items: [], nextPageToken: '' }));

    const response = await postJson('/api/library', {
        email: 'other@example.com',
        token: 'aas_et/forged',
        pageToken: 'next'
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(readGoogleAccount).mock.calls[0][1]).toBe(USER.id);
    expect(listBmps).toHaveBeenCalledWith(ACCOUNT.email, ACCOUNT.token, 'next');
});

test('in browser mode, uploads relay finished BMPs with the stored account', async () => {
    vi.mocked(receiveUpload).mockReturnValue(rejected(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));

    await call('/api/upload', { method: 'POST', body: new FormData() });

    expect(vi.mocked(receiveUpload).mock.calls[0].slice(1)).toEqual([ACCOUNT, ChunkFormat.Bmp]);
    expect(receiveFileUpload).not.toHaveBeenCalled();
});

test('in server mode, uploads receive whole files for the server to process', async () => {
    processing = ProcessingMode.Server;
    vi.mocked(receiveFileUpload).mockReturnValue(rejected(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));

    const response = await call('/api/upload', { method: 'POST', body: new FormData() });

    expect(response.status).toBe(400);
    expect(receiveFileUpload).toHaveBeenCalledOnce();
    expect(receiveUpload).not.toHaveBeenCalled();
});

test('raw chunks are relayed unchanged with the stored account', async () => {
    const bytes = Uint8Array.of(66, 77, 1, 2, 3);
    vi.mocked(downloadBmp).mockReturnValue(
        resolved(new Response(bytes, { headers: { 'content-type': 'image/bmp' } }))
    );

    const response = await postJson('/api/chunk', { mediaKey: 'key', sha1: '0'.repeat(40) });

    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(vi.mocked(downloadBmp).mock.calls[0].slice(0, 4)).toEqual([
        ACCOUNT.email,
        ACCOUNT.token,
        'key',
        '0'.repeat(40)
    ]);
});

test('an unreadable or missing Google account is reported without a token', async () => {
    vi.mocked(readGoogleAccount).mockReturnValue(rejected(AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE));

    const response = await postJson('/api/library', {});
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE.message });
});

test('only the Better Auth endpoints the app uses are public', async () => {
    vi.mocked(handleAuthRequest).mockReturnValue(resolved(Response.json({ ok: true })));

    const blocked = await postJson('/api/auth/sign-up/email', {
        email: 'test@example.com',
        password: 'long enough',
        name: 'test'
    });
    const updateUser = await postJson('/api/auth/update-user', { name: 'x' });

    expect(blocked.status).toBe(404);
    expect(updateUser.status).toBe(404);
    expect(handleAuthRequest).not.toHaveBeenCalled();

    const signedIn = await postJson('/api/auth/sign-in/email', {
        email: 'test@example.com',
        password: 'long enough'
    });
    const session = await call('/api/auth/get-session');

    expect(signedIn.status).toBe(200);
    expect(session.status).toBe(200);
    expect(vi.mocked(handleAuthRequest).mock.calls.map(([, , address]) => address)).toEqual([
        CLIENT_ADDRESS,
        CLIENT_ADDRESS
    ]);
});

test('signup forwards session cookies and never returns the Google token', async () => {
    vi.mocked(signUp).mockReturnValue(resolved(['session=one; HttpOnly', 'data=two; HttpOnly']));

    const response = await postJson('/api/account', {
        email: 'test@example.com',
        password: 'long enough',
        encryptedToken: await encrypted('oauth2_4/fake')
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
        'session=one; HttpOnly',
        'data=two; HttpOnly'
    ]);
    expect(text).not.toContain('oauth2_4');
    expect(vi.mocked(signUp).mock.calls[0].slice(2)).toEqual([
        CLIENT_ADDRESS,
        { email: 'test@example.com', password: 'long enough', token: 'oauth2_4/fake' }
    ]);
});

test('plaintext tokens are refused, and so are tokens the server cannot decrypt', async () => {
    const plaintext = await postJson('/api/account', {
        email: 'test@example.com',
        password: 'long enough',
        token: 'oauth2_4/fake'
    });
    const forged = await postJson('/api/account', {
        email: 'test@example.com',
        password: 'long enough',
        encryptedToken: btoa('oauth2_4/fake')
    });
    const notAToken = await postJson('/api/account', {
        email: 'test@example.com',
        password: 'long enough',
        encryptedToken: await encrypted('not-a-token')
    });

    expect(plaintext.status).toBe(400);
    expect(await forged.json()).toEqual({ error: AUTH_ERRORS.TOKEN_DECRYPTION_FAILED.message });
    expect(notAToken.status).toBe(400);
    expect(signUp).not.toHaveBeenCalled();
});

test('signup rejects invalid input before creating a user', async () => {
    const response = await postJson('/api/account', {
        email: 'test@example.com',
        password: 'short',
        encryptedToken: await encrypted('oauth2_4/fake')
    });

    expect(response.status).toBe(400);
    expect(signUp).not.toHaveBeenCalled();
});

test('replacing the Google token validates it for the stored email and saves only on success', async () => {
    vi.mocked(readGoogleEmail).mockReturnValue(resolved(ACCOUNT.email));
    vi.mocked(connectGoogleAccount).mockReturnValue(resolved('aas_et/new'));
    vi.mocked(saveGoogleAccount).mockReturnValue(resolved(undefined));

    const response = await postJson(
        '/api/account/google',
        { encryptedToken: await encrypted('oauth2_4/new') },
        'PUT'
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('aas_et');
    expect(connectGoogleAccount).toHaveBeenCalledWith(ACCOUNT.email, 'oauth2_4/new');
    expect(vi.mocked(saveGoogleAccount).mock.calls[0].slice(1)).toEqual([
        USER.id,
        { email: ACCOUNT.email, token: 'aas_et/new' }
    ]);

    vi.mocked(connectGoogleAccount).mockReturnValue(
        rejected({ code: 'ACCOUNT_CONNECTION_FAILED', message: 'Google refused' } as const)
    );
    vi.mocked(saveGoogleAccount).mockClear();

    const refused = await postJson(
        '/api/account/google',
        { encryptedToken: await encrypted('oauth2_4/bad') },
        'PUT'
    );

    expect(refused.status).toBe(400);
    expect(saveGoogleAccount).not.toHaveBeenCalled();
});

test('the session endpoint reports the signed-in user and server settings without secrets', async () => {
    vi.mocked(readSessionUser).mockReturnValue(resolved(USER));
    processing = ProcessingMode.Server;

    const response = await call('/api/session');
    const text = await response.text();
    const session = SessionResponseSchema.parse(JSON.parse(text));

    expect(session).toMatchObject({
        user: { email: USER.email },
        signupEnabled: true,
        processing: ProcessingMode.Server
    });
    expect(text).not.toContain(USER.id);
    expect(text).not.toContain('postgres');

    vi.mocked(readSessionUser).mockReturnValue(resolved(null));

    const signedOut = await call('/api/session');

    expect(SessionResponseSchema.parse(await signedOut.json()).user).toBeNull();
});

test('unknown API paths return JSON not-found errors', async () => {
    const response = await call('/api/missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: AUTH_ERRORS.NOT_FOUND.message });
});
