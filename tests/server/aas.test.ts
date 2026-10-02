import { expect, test } from 'vitest';
import { exchangeOAuth2ForAas } from '$server/aas';
import type { Fetcher } from '$server/fetcher';

test('Phodrive exchanges OAuth2 for an AAS token with the Google auth form', async () => {
    const fakeFetch: Fetcher = async (input, init) => {
        expect(String(input)).toBe('https://android.clients.google.com/auth');
        expect(init?.method).toBe('POST');
        expect(init?.signal).toBeUndefined();
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('Email')).toBe('test@example.com');
        expect(form.get('Token')).toBe('oauth2_4/test+token');
        expect(form.get('callerPkg')).toBe('com.google.android.gms');
        expect(form.get('service')).toBe('ac2dm');
        return new Response('token=aas_et/test\n');
    };
    const exchanged = await exchangeOAuth2ForAas(
        'test@example.com',
        'oauth2_4/test+token',
        fakeFetch
    );
    expect(exchanged.unwrap()).toBe('aas_et/test');
});

test('OAuth2 exchange rejects a response without an AAS token', async () => {
    const fakeFetch: Fetcher = async () => new Response('Error=BadAuthentication\n');
    const exchanged = await exchangeOAuth2ForAas('test@example.com', 'oauth2_4/test', fakeFetch);
    expect(exchanged.unwrapErr()).toEqual({
        code: 'OAUTH_EXCHANGE_FAILED',
        message: 'OAuth2 exchange failed'
    });
});
