import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { apiJson } from '@madkarmaa/phodrive-core/browser/api';
import { createAuthClient } from 'better-auth/svelte';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { SignInInput, SignUpInput } from '#lib/auth';

const SIGN_UP_URL = '/api/account';
const GOOGLE_TOKEN_URL = '/api/account/google';
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

/** The server exchanges the Google token and keeps it; the response only sets the session cookie. */
export function signUp(input: SignUpInput): AsyncResult<void, ApplicationError> {
    return apiJson(
        SIGN_UP_URL,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
        },
        'Could not create your account. Try again.'
    ).map(() => undefined);
}

export function replaceGoogleToken(token: string): AsyncResult<void, ApplicationError> {
    return apiJson(
        GOOGLE_TOKEN_URL,
        {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token })
        },
        'Google could not validate this token. Try again.'
    ).map(() => undefined);
}
