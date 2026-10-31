import { beforeEach, expect, test, vi } from 'vitest';
import { CLIENT_ADDRESS_HEADER, handleAuthRequest } from '../src/auth';
import { testContext } from './helpers/context';

const { handler } = vi.hoisted(() => ({
    handler: vi.fn<(request: Request) => Promise<Response>>()
}));

vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn() }));
vi.mock('better-auth', () => ({ betterAuth: () => ({ handler, api: {} }) }));

beforeEach(() => handler.mockReset());

function signIn() {
    return new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CLIENT_ADDRESS_HEADER]: '198.51.100.1' },
        body: JSON.stringify({ email: 'test@example.com', password: 'long enough' })
    });
}

test('session tokens are removed from JSON bodies while cookies are kept', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'session=one; HttpOnly');
    headers.append('set-cookie', 'data=two; HttpOnly');
    handler.mockResolvedValue(
        Response.json(
            { token: 'secret', user: { id: 'user' }, session: { id: 's', token: 'secret' } },
            { headers }
        )
    );

    const forwarded = await handleAuthRequest(testContext().auth, signIn(), '203.0.113.7');
    const response = forwarded.unwrap();
    const body: unknown = await response.json();

    expect(body).toEqual({ user: { id: 'user' }, session: { id: 's' } });
    expect(response.headers.getSetCookie()).toEqual([
        'session=one; HttpOnly',
        'data=two; HttpOnly'
    ]);
});

test('Better Auth receives the server client address and the original body', async () => {
    handler.mockResolvedValue(Response.json(null));

    const forwarded = await handleAuthRequest(testContext().auth, signIn(), '203.0.113.7');
    const request = handler.mock.calls[0][0];

    expect(await forwarded.unwrap().json()).toBeNull();
    expect(request.headers.get(CLIENT_ADDRESS_HEADER)).toBe('203.0.113.7');
    expect(await request.json()).toEqual({
        email: 'test@example.com',
        password: 'long enough'
    });
});
