import type { ApplicationError } from '$lib/errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { photosFetch, type Fetcher } from '$server/fetcher';

const AUTH_URL = 'https://android.clients.google.com/auth';

/** Adapted and modified from xhyrom/sniff's oauth2aas to exchange OAuth2 tokens for AAS. */
export function exchangeOAuth2ForAas(
    email: string,
    oauth2: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<string, ApplicationError> {
    return Ok(undefined).andThenAsync<string, ApplicationError>(async () => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !oauth2.startsWith('oauth2_'))
            return Err({
                code: 'INVALID_OAUTH_CREDENTIALS',
                message: 'Enter a valid email and OAuth2 token'
            } as const);

        const form = new URLSearchParams({
            lang: 'en',
            google_play_services_version: '19629032',
            sdk_version: '28',
            device_country: 'us',
            Email: email,
            service: 'ac2dm',
            get_accountid: '1',
            ACCESS_TOKEN: '1',
            callerPkg: 'com.google.android.gms',
            add_account: '1',
            Token: oauth2,
            callerSig: '38918a453d07199354f8b19af05ec6562ced5788'
        });

        let response: Response;
        try {
            response = await fetcher(AUTH_URL, {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    'user-agent': '',
                    app: 'com.google.android.gms',
                    'content-type': 'application/x-www-form-urlencoded'
                },
                body: form
            });
        } catch {
            return Err({
                code: 'OAUTH_EXCHANGE_FAILED',
                message: 'OAuth2 exchange failed'
            } as const);
        }

        if (response.status !== 200)
            return Err({
                code: 'OAUTH_EXCHANGE_FAILED',
                message: 'OAuth2 exchange failed'
            } as const);

        let body: string;
        try {
            body = await response.text();
        } catch {
            return Err({
                code: 'OAUTH_EXCHANGE_FAILED',
                message: 'OAuth2 exchange failed'
            } as const);
        }

        const fields = Object.fromEntries(
            body
                .split(/\r?\n/)
                .filter((line) => line.includes('='))
                .map((line) => {
                    const equal = line.indexOf('=');
                    return [
                        line.slice(0, equal).trim().toLowerCase(),
                        line.slice(equal + 1).trim()
                    ];
                })
        );
        const aas = fields.token;

        if (!aas?.startsWith('aas_et/'))
            return Err({
                code: 'OAUTH_EXCHANGE_FAILED',
                message: 'OAuth2 exchange failed'
            } as const);

        return Ok(aas);
    });
}
