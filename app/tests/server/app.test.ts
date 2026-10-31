import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { api } from '#server/app';
import { handleAuthRequest, requireSessionUser } from '#server/auth';
import { AUTH_ERRORS } from '#server/errors';
import { readGoogleAccount, readGoogleEmail, saveGoogleAccount } from '#server/google';
import { signUp } from '#server/signup';

const USER = { id: 'user-id', email: 'test@example.com' };
const ACCOUNT = { email: 'test@example.com', token: 'aas_et/stored' };
const CLIENT_ADDRESS = '203.0.113.7';

vi.mock('#server/auth', () => ({
    handleAuthRequest: vi.fn(),
    requireSessionUser: vi.fn()
}));
vi.mock('#server/google', () => ({
    readGoogleAccount: vi.fn(),
    readGoogleEmail: vi.fn(),
    saveGoogleAccount: vi.fn()
}));
vi.mock('#server/signup', () => ({ signUp: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/accounts', () => ({ connectGoogleAccount: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({ listBmps: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/upload/input', () => ({ receiveUpload: vi.fn() }));

function resolved<T>(value: T) {
    return Ok(value).andThenAsync(async (current) => Ok(current));
}

function rejected<E>(error: E) {
    return Ok(undefined).andThenAsync(async () => Err(error));
}

function call(path: string, init: RequestInit = {}) {
    return api.fetch(new Request(`http://localhost${path}`, init), {
        clientAddress: CLIENT_ADDRESS
    });
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
    expect(readGoogleAccount).toHaveBeenCalledWith(USER.id);
    expect(listBmps).toHaveBeenCalledWith(ACCOUNT.email, ACCOUNT.token, 'next');
});

test('uploads receive the stored account, not one from the request', async () => {
    vi.mocked(receiveUpload).mockReturnValue(rejected(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));

    await call('/api/upload', { method: 'POST', body: new FormData() });

    expect(vi.mocked(receiveUpload).mock.calls[0][1]).toEqual(ACCOUNT);
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
    expect(vi.mocked(handleAuthRequest).mock.calls.map(([, address]) => address)).toEqual([
        CLIENT_ADDRESS,
        CLIENT_ADDRESS
    ]);
});

test('signup forwards session cookies and never returns the Google token', async () => {
    vi.mocked(signUp).mockReturnValue(resolved(['session=one; HttpOnly', 'data=two; HttpOnly']));

    const response = await postJson('/api/account', {
        email: 'test@example.com',
        password: 'long enough',
        token: 'oauth2_4/fake'
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
        'session=one; HttpOnly',
        'data=two; HttpOnly'
    ]);
    expect(text).not.toContain('oauth2_4');
    expect(vi.mocked(signUp).mock.calls[0][1]).toBe(CLIENT_ADDRESS);
});

test('signup rejects invalid input before creating a user', async () => {
    const response = await postJson('/api/account', {
        email: 'test@example.com',
        password: 'short',
        token: 'oauth2_4/fake'
    });

    expect(response.status).toBe(400);
    expect(signUp).not.toHaveBeenCalled();
});

test('replacing the Google token validates it for the stored email and saves only on success', async () => {
    vi.mocked(readGoogleEmail).mockReturnValue(resolved(ACCOUNT.email));
    vi.mocked(connectGoogleAccount).mockReturnValue(resolved('aas_et/new'));
    vi.mocked(saveGoogleAccount).mockReturnValue(resolved(undefined));

    const response = await postJson('/api/account/google', { token: 'oauth2_4/new' }, 'PUT');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('aas_et');
    expect(connectGoogleAccount).toHaveBeenCalledWith(ACCOUNT.email, 'oauth2_4/new');
    expect(saveGoogleAccount).toHaveBeenCalledWith(USER.id, {
        email: ACCOUNT.email,
        token: 'aas_et/new'
    });

    vi.mocked(connectGoogleAccount).mockReturnValue(
        rejected({ code: 'ACCOUNT_CONNECTION_FAILED', message: 'Google refused' } as const)
    );
    vi.mocked(saveGoogleAccount).mockClear();

    const refused = await postJson('/api/account/google', { token: 'oauth2_4/bad' }, 'PUT');

    expect(refused.status).toBe(400);
    expect(saveGoogleAccount).not.toHaveBeenCalled();
});

test('unknown API paths return JSON not-found errors', async () => {
    const response = await call('/api/missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: AUTH_ERRORS.NOT_FOUND.message });
});
