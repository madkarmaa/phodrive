import { beforeEach, expect, test, vi } from 'vitest';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { SessionResponseSchema } from '@madkarmaa/phodrive-core/auth';
import { handleAuthRequest, readSessionUser, requireSessionUser } from '../src/auth';
import { readGoogleAccount, readGoogleEmail, saveGoogleAccount } from '../src/google';
import { AUTH_ERRORS } from '../src/errors';
import { signUp } from '../src/signup';
import {
    ACCOUNT,
    CLIENT_ADDRESS,
    USER,
    call,
    encrypted,
    postJson,
    rejected,
    resolved,
    settings
} from './helpers/api';

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

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    vi.mocked(readGoogleAccount).mockReturnValue(resolved(ACCOUNT));
    settings.processing = ProcessingMode.Browser;
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
    settings.processing = ProcessingMode.Server;

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
