import { expect, test } from 'vitest';
import { connectGoogleAccount } from '$server/accounts';
import type { Fetcher } from '$server/fetcher';
import { SERVER_ERRORS } from '$server/errors';

test('account connection exchanges OAuth2 then validates the AAS token before returning it', async () => {
    let calls = 0;
    const fetcher: Fetcher = async (input, init) => {
        const form = new URLSearchParams(String(init?.body));

        if (++calls === 1) {
            expect(String(input)).toBe('https://android.clients.google.com/auth');
            expect(form.get('Token')).toBe('oauth2_4/fixture');
            return new Response('Token=aas_et/exchanged');
        }

        expect(String(input)).toBe('https://android.googleapis.com/auth');
        expect(form.get('Token')).toBe('aas_et/exchanged');
        return new Response(`Auth=fixture\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
    };
    const result = await connectGoogleAccount('test@example.com', 'oauth2_4/fixture', fetcher);

    expect(result.unwrap()).toBe('aas_et/exchanged');
    expect(calls).toBe(2);
});

test('account connection validates an existing AAS token without an exchange', async () => {
    let calls = 0;
    const fetcher: Fetcher = async (input) => {
        calls++;
        expect(String(input)).toBe('https://android.googleapis.com/auth');
        return new Response(`Auth=fixture\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
    };
    const result = await connectGoogleAccount('test@example.com', 'aas_et/fixture', fetcher);

    expect(result.unwrap()).toBe('aas_et/fixture');
    expect(calls).toBe(1);
});

test('failed exchange or validation preserves the original error', async () => {
    let exchangeCalls = 0;
    const failedExchange: Fetcher = async () => {
        exchangeCalls++;
        return new Response('Error=BadAuthentication');
    };
    const exchanged = await connectGoogleAccount(
        'test@example.com',
        'oauth2_4/fixture',
        failedExchange
    );

    expect(exchanged.unwrapErr()).toEqual({
        code: 'OAUTH_EXCHANGE_FAILED',
        message: 'OAuth2 exchange failed'
    });
    expect(exchangeCalls).toBe(1);

    let validationCalls = 0;
    const failedValidation: Fetcher = async () =>
        ++validationCalls === 1
            ? new Response('Token=aas_et/exchanged')
            : new Response('Error=BadAuthentication');
    const validated = await connectGoogleAccount(
        'test@example.com',
        'oauth2_4/fixture',
        failedValidation
    );

    expect(validated.unwrapErr()).toEqual(SERVER_ERRORS.AAS_AUTHENTICATION_FAILED);
    expect(validationCalls).toBe(2);
    expect(validated.unwrapErr().message).not.toContain('aas_et/');
});
