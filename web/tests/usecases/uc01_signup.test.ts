import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { replaceGoogleToken, signUp } from '#browser/auth';
import {
    GoogleTokenRequestSchema,
    SignInSchema,
    SignUpRequestSchema,
    SignUpSchema,
    TOKEN_ENCRYPTION
} from '@madkarmaa/phodrive-core/auth';
import { SignUpFormSchema } from '#lib/auth';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

test('signup needs a Google email, a valid password, and a Google token before any request', () => {
    const valid = { email: 'test@example.com', password: 'long enough', token: 'oauth2_4/fake' };

    expect(SignUpSchema.safeParse(valid).success).toBe(true);
    expect(SignUpSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, password: 'x'.repeat(129) }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, token: 'not-a-token' }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(SignInSchema.safeParse({ email: valid.email, password: '' }).success).toBe(false);
});

test('the signup form needs the password repeated exactly, even while other fields are invalid', () => {
    const form = {
        email: 'test@example.com',
        password: 'long enough',
        confirmPassword: 'long enough',
        token: 'oauth2_4/fake'
    };

    expect(SignUpFormSchema.safeParse(form).success).toBe(true);

    const mismatch = SignUpFormSchema.safeParse({ ...form, confirmPassword: 'long enougH' });
    expect(mismatch.error?.issues.map((issue) => issue.path[0])).toEqual(['confirmPassword']);

    const incomplete = SignUpFormSchema.safeParse({
        ...form,
        email: '',
        token: '',
        confirmPassword: 'different'
    });
    expect(incomplete.error?.issues.map((issue) => issue.path[0])).toContain('confirmPassword');
});

/** A stand-in server: publishes a public key and records every request body it receives. */
async function tokenServer(reply: Response = Response.json({ signedUp: true })) {
    const pair = await crypto.subtle.generateKey(
        {
            ...TOKEN_ENCRYPTION,
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1])
        },
        false,
        ['encrypt', 'decrypt']
    );
    const key = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const bodies: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        bodies.push(typeof init?.body === 'string' ? init.body : '');
        if (url === '/api/account/key') return Response.json({ key });

        return reply;
    });
    const decrypt = async (encrypted: string) => {
        const plaintext = await crypto.subtle.decrypt(
            TOKEN_ENCRYPTION,
            pair.privateKey,
            Buffer.from(encrypted, 'base64')
        );

        return new TextDecoder().decode(plaintext);
    };

    return { fetchMock, bodies, decrypt };
}

test('signup sends only an encrypted token and never stores it in the browser', async () => {
    const server = await tokenServer();
    const input = { email: 'test@example.com', password: 'long enough', token: 'oauth2_4/fake' };

    const signedUp = await signUp(input);

    expect(signedUp.isOk()).toBe(true);
    expect(server.fetchMock.mock.calls.map(([url]) => url)).toEqual([
        '/api/account/key',
        '/api/account'
    ]);
    expect(server.bodies.some((body) => body.includes('oauth2_4'))).toBe(false);

    const sent = SignUpRequestSchema.parse(JSON.parse(server.bodies[1]));
    expect(sent).toMatchObject({ email: input.email, password: input.password });
    expect(await server.decrypt(sent.encryptedToken)).toBe(input.token);
    expect(storage.length).toBe(0);
    server.fetchMock.mockRestore();
});

test('token replacement sends only an encrypted token', async () => {
    const server = await tokenServer(Response.json({ connected: true }));
    const replaced = await replaceGoogleToken('aas_et/replacement');

    expect(replaced.isOk()).toBe(true);
    expect(server.bodies.some((body) => body.includes('aas_et'))).toBe(false);

    const sent = GoogleTokenRequestSchema.parse(JSON.parse(server.bodies[1]));
    expect(await server.decrypt(sent.encryptedToken)).toBe('aas_et/replacement');
    server.fetchMock.mockRestore();
});

test('signup surfaces the server error message', async () => {
    const server = await tokenServer(
        Response.json({ error: 'Signup is disabled.' }, { status: 403 })
    );

    const signedUp = await signUp({
        email: 'test@example.com',
        password: 'long enough',
        token: 'aas_et/fake'
    });

    expect(signedUp.unwrapErr().message).toBe('Signup is disabled.');
    server.fetchMock.mockRestore();
});
