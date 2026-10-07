import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { randomBytes } from 'node:crypto';
import { photosFetch, type Fetcher } from '$server/fetcher';
import { send, readBody } from '$server/photos/transport';
import { utf8 } from '$server/protobuf';

const AUTH_URL = 'https://android.googleapis.com/auth';
const APP = 'com.google.android.apps.photos';
const SIGNATURE = '24bb24c05e47e0aefa68a58a766179d9b613a600';
export type PhotosHeaders = {
    commonHeaders: Record<string, string>;
    rpcHeaders: Record<string, string>;
};

export function authenticatedHeaders(
    email: string,
    token: string,
    fetcher: Fetcher
): AsyncResult<PhotosHeaders, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !token.startsWith('aas_et/')) {
            return Err(SERVER_ERRORS.INVALID_ACCOUNT);
        }

        const androidId = randomBytes(8).toString('hex');
        const form = new URLSearchParams({
            Email: email,
            Token: token,
            androidId,
            app: APP,
            callerPkg: APP,
            callerSig: SIGNATURE,
            client_sig: SIGNATURE,
            device_country: 'us',
            operatorCountry: 'us',
            google_play_services_version: '240913000',
            lang: 'en_US',
            oauth2_foreground: '1',
            sdk_version: '33',
            source: 'android',
            service:
                'oauth2:openid https://www.googleapis.com/auth/mobileapps.native https://www.googleapis.com/auth/photos.native'
        });

        return send(
            fetcher,
            AUTH_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    app: APP,
                    device: androidId,
                    'user-agent': 'GoogleAuth/1.4 (Pixel XL PQ2A.190205.001); gzip',
                    'content-type': 'application/x-www-form-urlencoded',
                    'accept-encoding': 'identity'
                },
                body: form
            },
            'Authentication'
        ).andThenAsync((response) =>
            readBody(response, 'Authentication').andThen(utf8).andThen(authHeadersFromResponse)
        );
    });
}

function authHeadersFromResponse(text: string): Result<PhotosHeaders, ServerError> {
    const authFields = Object.fromEntries(
        text
            .split('\n')
            .filter((line) => line.includes('='))
            .map((line) => {
                const index = line.indexOf('=');

                return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
            })
    );
    if (authFields.Error || !authFields.Auth || Number(authFields.Expiry) <= Date.now() / 1000)
        return Err(SERVER_ERRORS.AAS_AUTHENTICATION_FAILED);

    const commonHeaders = {
        Authorization: `Bearer ${authFields.Auth}`,
        'user-agent':
            'com.google.android.apps.photos/49029607 (Linux; U; Android 9; en_US; Pixel XL; Build/PQ2A.190205.001; Cronet/127.0.6510.5) (gzip)',
        'accept-encoding': 'identity',
        'accept-language': 'en_US'
    };
    const rpcHeaders = {
        ...commonHeaders,
        'content-type': 'application/x-protobuf',
        'x-goog-ext-173412678-bin': 'CgcIAhClARgC',
        'x-goog-ext-174067345-bin': 'CgIIAg=='
    };

    return Ok({ commonHeaders, rpcHeaders });
}

/** Confirm Google accepts this email and AAS token for Photos without exposing the bearer token. */
export function validateAasAccount(
    email: string,
    token: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return authenticatedHeaders(email, token, fetcher).map(() => undefined);
}
