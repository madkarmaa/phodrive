import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { z } from 'zod';
import type { SignUpInput } from '#lib/auth';
import { authRequestHeaders, getAuth, signupEnabled } from '#server/auth';
import { db } from '#server/db/client';
import { user } from '#server/db/schema';
import { AUTH_ERRORS, type AuthError } from '#server/errors';
import { saveGoogleAccount } from '#server/google';

const SIGN_UP_PATH = '/api/auth/sign-up/email';
const TOO_MANY_REQUESTS = 429;

const CreatedUserResponseSchema = z.object({ user: z.object({ id: z.string().min(1) }) });
const AuthErrorResponseSchema = z.object({ message: z.string().min(1) });

type CreatedUser = { userId: string; cookies: string[] };
export type SignUpError = AuthError | ApplicationError | ServerError;

function readResponseJson(response: Response): AsyncResult<unknown, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const body: unknown = await response.json();

            return Ok(body);
        } catch {
            return Err(AUTH_ERRORS.SIGN_UP_FAILED);
        }
    });
}

function signUpFailure(response: Response, body: unknown): AuthError {
    const parsed = AuthErrorResponseSchema.safeParse(body);
    const message = parsed.success ? parsed.data.message : AUTH_ERRORS.SIGN_UP_FAILED.message;
    const status = response.status === TOO_MANY_REQUESTS ? TOO_MANY_REQUESTS : 400;

    return { ...AUTH_ERRORS.SIGN_UP_FAILED, message, status };
}

function createdUser(response: Response, body: unknown): Result<CreatedUser, AuthError> {
    if (!response.ok) return Err(signUpFailure(response, body));

    const parsed = CreatedUserResponseSchema.safeParse(body);
    if (!parsed.success) return Err(AUTH_ERRORS.SIGN_UP_FAILED);

    return Ok({ userId: parsed.data.user.id, cookies: response.headers.getSetCookie() });
}

/**
 * Create the user through Better Auth's own endpoint, so its validation, duplicate check,
 * rate limit, and session cookie apply before a one-time Google token is spent.
 */
function createUser(
    source: Request,
    clientAddress: string,
    { email, password }: SignUpInput
): AsyncResult<CreatedUser, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        const headers = authRequestHeaders(source.headers, clientAddress);
        headers.set('content-type', 'application/json');

        const request = new Request(new URL(SIGN_UP_PATH, source.url), {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: email, email, password })
        });

        let response: Response;

        try {
            response = await getAuth().handler(request);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }

        const body = await readResponseJson(response);

        return body.andThen((value) => createdUser(response, value));
    });
}

function removeUser(userId: string): AsyncResult<void, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await db.delete(user).where(eq(user.id, userId));

            return Ok(undefined);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

/** Link the Google account, or remove the new user so the email can sign up again. */
function linkGoogleAccount(
    { userId }: CreatedUser,
    { email, token }: SignUpInput
): AsyncResult<void, SignUpError> {
    return connectGoogleAccount(email, token)
        .andThenAsync<void, SignUpError>((aasToken) =>
            saveGoogleAccount(userId, { email, token: aasToken })
        )
        .orElseAsync((error) => removeUser(userId).andThen(() => Err(error)));
}

/** Create a signed-in user tied to one Google account; returns the session cookies to set. */
export function signUp(
    request: Request,
    clientAddress: string,
    input: SignUpInput
): AsyncResult<string[], SignUpError> {
    const allowed: Result<void, AuthError> = signupEnabled()
        ? Ok(undefined)
        : Err(AUTH_ERRORS.SIGNUP_DISABLED);

    return allowed
        .andThenAsync(() => createUser(request, clientAddress, input))
        .andThenAsync((created) => linkGoogleAccount(created, input).map(() => created.cookies));
}
