import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { apiJson } from '@madkarmaa/phodrive-core/browser/api';
import { createAuthClient } from 'better-auth/svelte';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import {
    TOKEN_ENCRYPTION,
    TokenKeySchema,
    type SignInInput,
    type SignUpInput,
    type SignUpRequest
} from '#lib/auth';

const SIGN_UP_URL = '/api/account';
const GOOGLE_TOKEN_URL = '/api/account/google';
const TOKEN_KEY_URL = '/api/account/key';
const ENCRYPTION_FAILED = {
    code: 'REQUEST_FAILED',
    message: 'Could not protect the token in this browser. Reload the page and try again.'
} as const satisfies ApplicationError;
const SIGN_IN_FAILED = 'Could not sign in. Try again.';
const SIGN_OUT_FAILED = 'Could not sign out. Try again.';

/** Better Auth's client for session endpoints; Google tokens only travel in signup and replacement. */
const authClient = createAuthClient();

type AuthClientResult = { error: { message?: string } | null };

function authResult(
    call: () => Promise<AuthClientResult>,
    fallback: string
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, ApplicationError>> => {
        let result: AuthClientResult;

        try {
            result = await call();
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: fallback });
        }

        if (result.error)
            return Err({ code: 'REQUEST_FAILED', message: result.error.message || fallback });

        return Ok(undefined);
    });
}

export function signIn({ email, password }: SignInInput): AsyncResult<void, ApplicationError> {
    return authResult(() => authClient.signIn.email({ email, password }), SIGN_IN_FAILED);
}

export function signOut(): AsyncResult<void, ApplicationError> {
    return authResult(() => authClient.signOut(), SIGN_OUT_FAILED);
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);

    return btoa(binary);
}

/** Encrypt a pasted token with the server's current public key; only the server can read it. */
function encryptToken(token: string): AsyncResult<string, ApplicationError> {
    return apiJson(TOKEN_KEY_URL, { method: 'GET' }, ENCRYPTION_FAILED.message)
        .andThen((body) => schemaResult(TokenKeySchema, body, ENCRYPTION_FAILED.message))
        .andThenAsync(async ({ key }): Promise<Result<string, ApplicationError>> => {
            try {
                const publicKey = await crypto.subtle.importKey(
                    'jwk',
                    key,
                    TOKEN_ENCRYPTION,
                    false,
                    ['encrypt']
                );
                const plaintext = new TextEncoder().encode(token);
                const ciphertext = await crypto.subtle.encrypt(
                    TOKEN_ENCRYPTION,
                    publicKey,
                    plaintext
                );

                return Ok(encodeBase64(new Uint8Array(ciphertext)));
            } catch {
                return Err(ENCRYPTION_FAILED);
            }
        });
}

function postJson(
    url: string,
    method: string,
    body: unknown,
    fallback: string
): AsyncResult<void, ApplicationError> {
    return apiJson(
        url,
        { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        fallback
    ).map(() => undefined);
}

/** The server decrypts and exchanges the Google token and keeps it; only a session cookie returns. */
export function signUp({
    email,
    password,
    token
}: SignUpInput): AsyncResult<void, ApplicationError> {
    return encryptToken(token).andThenAsync((encryptedToken) => {
        const body: SignUpRequest = { email, password, encryptedToken };

        return postJson(SIGN_UP_URL, 'POST', body, 'Could not create your account. Try again.');
    });
}

export function replaceGoogleToken(token: string): AsyncResult<void, ApplicationError> {
    return encryptToken(token).andThenAsync((encryptedToken) =>
        postJson(
            GOOGLE_TOKEN_URL,
            'PUT',
            { encryptedToken },
            'Google could not validate this token. Try again.'
        )
    );
}
