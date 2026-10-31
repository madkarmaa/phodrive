import * as env from '$app/env/private';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { APP_NAME } from '#lib/app';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '#lib/auth';
import { db } from '#server/db/client';
import * as schema from '#server/db/schema';
import { AUTH_ERRORS, type AuthError } from '#server/errors';

/** Set by the API from the socket address on every request, so clients cannot spoof it. */
export const CLIENT_ADDRESS_HEADER = 'x-phodrive-client-address';

function createAuth() {
    return betterAuth({
        appName: APP_NAME,
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
        database: drizzleAdapter(db, { provider: 'pg', schema }),
        emailAndPassword: {
            enabled: true,
            disableSignUp: env.PHODRIVE_DISABLE_SIGNUP,
            minPasswordLength: MIN_PASSWORD_LENGTH,
            maxPasswordLength: MAX_PASSWORD_LENGTH
        },
        advanced: { ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] } },
        telemetry: { enabled: false }
    });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Better Auth starts on first use, so builds can analyze routes without deployment secrets. */
export function getAuth(): ReturnType<typeof createAuth> {
    instance ??= createAuth();

    return instance;
}

export type SessionUser = { id: string; email: string };

export function signupEnabled(): boolean {
    return !env.PHODRIVE_DISABLE_SIGNUP;
}

/** Resolve the session cookie to its user; a missing or expired session is not an error. */
export function readSessionUser(headers: Headers): AsyncResult<SessionUser | null, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const session = await getAuth().api.getSession({ headers });
            if (!session) return Ok(null);

            return Ok({ id: session.user.id, email: session.user.email });
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

export function requireSessionUser(headers: Headers): AsyncResult<SessionUser, AuthError> {
    return readSessionUser(headers).andThen((user) =>
        user ? Ok(user) : Err(AUTH_ERRORS.SIGNED_OUT)
    );
}

/** Copy a browser request's headers for Better Auth, replacing the body length and client address. */
export function authRequestHeaders(source: Headers, clientAddress: string): Headers {
    const headers = new Headers(source);
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    headers.set(CLIENT_ADDRESS_HEADER, clientAddress);

    return headers;
}

/** Forward a browser request to Better Auth with the server-provided client address. */
export function handleAuthRequest(
    request: Request,
    clientAddress: string
): AsyncResult<Response, AuthError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<Response, AuthError>> => {
        let body: ArrayBuffer | undefined;

        try {
            body =
                request.method === 'GET' || request.method === 'HEAD'
                    ? undefined
                    : await request.arrayBuffer();
        } catch {
            return Err(AUTH_ERRORS.AUTH_REQUEST_FAILED);
        }

        const forwarded = new Request(request.url, {
            method: request.method,
            headers: authRequestHeaders(request.headers, clientAddress),
            body
        });

        try {
            const response = await getAuth().handler(forwarded);

            return Ok(response);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}
