import { afterEach, expect, test, vi } from 'vitest';
import { validateAccount } from '#browser/accounts';

const EMAIL = 'test@example.com';
const TOKEN = 'aas_et/fixture';

afterEach(() => vi.restoreAllMocks());

test('account validation uses JSON HTTP transport and returns the validated token', async () => {
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ token: TOKEN }));

    const result = await validateAccount(EMAIL, TOKEN);

    expect(result.unwrap()).toBe(TOKEN);
    expect(fetchMock).toHaveBeenCalledWith('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, token: TOKEN })
    });
});

test('account validation preserves safe API error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ error: 'Get a fresh token and try again.' }, { status: 400 })
    );

    const result = await validateAccount(EMAIL, TOKEN);

    expect(result.unwrapErr().message).toBe('Get a fresh token and try again.');
});

test.each([{ token: 'oauth2_unvalidated' }, { token: 42 }, {}, null])(
    'account validation rejects a malformed success response: %j',
    async (body) => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body));

        const result = await validateAccount(EMAIL, TOKEN);

        expect(result.isErr()).toBe(true);
    }
);

test('account validation converts network rejection into a safe Result failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network unavailable'));

    const result = await validateAccount(EMAIL, TOKEN);

    expect(result.unwrapErr().message).toBe('Google could not validate this account. Try again.');
});

test('account validation converts unreadable JSON into a safe Result failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unreadable response'));

    const result = await validateAccount(EMAIL, TOKEN);

    expect(result.isErr()).toBe(true);
});
