import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { signupEnabled } from '#server/auth';
import { db } from '#server/db/client';
import { AUTH_ERRORS } from '#server/errors';
import { saveGoogleAccount } from '#server/google';
import { signUp } from '#server/signup';

const INPUT = { email: 'test@example.com', password: 'long enough', token: 'oauth2_4/fake' };
const CLIENT_ADDRESS = '203.0.113.7';

const { removeUser, auth } = vi.hoisted(() => ({
    removeUser: vi.fn(async () => {}),
    auth: { handler: vi.fn<(request: Request) => Promise<Response>>() }
}));

vi.mock('#server/auth', () => ({
    getAuth: () => auth,
    signupEnabled: vi.fn(() => true),
    authRequestHeaders: (source: Headers, clientAddress: string) => {
        const headers = new Headers(source);
        headers.set('x-phodrive-client-address', clientAddress);
        return headers;
    }
}));
vi.mock('#server/db/client', () => ({
    db: { delete: vi.fn(() => ({ where: removeUser })) }
}));
vi.mock('#server/google', () => ({ saveGoogleAccount: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/accounts', () => ({ connectGoogleAccount: vi.fn() }));

function resolved<T>(value: T) {
    return Ok(value).andThenAsync(async (current) => Ok(current));
}

function browserRequest() {
    return new Request('http://localhost/api/account', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify(INPUT)
    });
}

function createdResponse() {
    const headers = new Headers();
    headers.append('set-cookie', 'session=one; HttpOnly');
    return Response.json({ token: 'session', user: { id: 'user-id' } }, { headers });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signupEnabled).mockReturnValue(true);
});

test('disabled signup creates no user and never contacts Google', async () => {
    vi.mocked(signupEnabled).mockReturnValue(false);

    const result = await signUp(browserRequest(), CLIENT_ADDRESS, INPUT);

    expect(result.unwrapErr()).toEqual(AUTH_ERRORS.SIGNUP_DISABLED);
    expect(auth.handler).not.toHaveBeenCalled();
    expect(connectGoogleAccount).not.toHaveBeenCalled();
});

test('Better Auth rejections keep their message and spend no Google token', async () => {
    vi.mocked(auth.handler).mockResolvedValue(
        Response.json({ message: 'User already exists. Use another email.' }, { status: 422 })
    );

    const result = await signUp(browserRequest(), CLIENT_ADDRESS, INPUT);

    expect(result.unwrapErr().message).toBe('User already exists. Use another email.');
    expect(connectGoogleAccount).not.toHaveBeenCalled();
});

test('the user is created without the Google token and with the server client address', async () => {
    vi.mocked(auth.handler).mockResolvedValue(createdResponse());
    vi.mocked(connectGoogleAccount).mockReturnValue(resolved('aas_et/exchanged'));
    vi.mocked(saveGoogleAccount).mockReturnValue(resolved(undefined));

    const result = await signUp(browserRequest(), CLIENT_ADDRESS, INPUT);

    expect(result.unwrap()).toEqual(['session=one; HttpOnly']);
    const request = vi.mocked(auth.handler).mock.calls[0][0];
    const body: unknown = await request.json();
    expect(new URL(request.url).pathname).toBe('/api/auth/sign-up/email');
    expect(request.headers.get('x-phodrive-client-address')).toBe(CLIENT_ADDRESS);
    expect(body).toEqual({ name: INPUT.email, email: INPUT.email, password: INPUT.password });
    expect(saveGoogleAccount).toHaveBeenCalledWith('user-id', {
        email: INPUT.email,
        token: 'aas_et/exchanged'
    });
    expect(removeUser).not.toHaveBeenCalled();
});

test('a rejected Google token removes the new user so the email can sign up again', async () => {
    vi.mocked(auth.handler).mockResolvedValue(createdResponse());
    vi.mocked(connectGoogleAccount).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'ACCOUNT_CONNECTION_FAILED', message: 'Google refused' } as const)
        )
    );

    const result = await signUp(browserRequest(), CLIENT_ADDRESS, INPUT);

    expect(result.unwrapErr().message).toBe('Google refused');
    expect(db.delete).toHaveBeenCalledOnce();
    expect(removeUser).toHaveBeenCalledOnce();
    expect(saveGoogleAccount).not.toHaveBeenCalled();
});

test('a failed token save also removes the new user', async () => {
    vi.mocked(auth.handler).mockResolvedValue(createdResponse());
    vi.mocked(connectGoogleAccount).mockReturnValue(resolved('aas_et/exchanged'));
    vi.mocked(saveGoogleAccount).mockReturnValue(
        Ok(undefined).andThenAsync(async () => Err(AUTH_ERRORS.DATABASE_UNAVAILABLE))
    );

    const result = await signUp(browserRequest(), CLIENT_ADDRESS, INPUT);

    expect(result.unwrapErr()).toEqual(AUTH_ERRORS.DATABASE_UNAVAILABLE);
    expect(removeUser).toHaveBeenCalledOnce();
});
