import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { z } from 'zod';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@madkarmaa/phodrive-core/auth';
import type { Database } from './db/client';
import * as schema from './db/schema';
import type { Environment } from './environment';
import { AUTH_ERRORS, type AuthError } from './errors';

const APP_NAME = 'Phodrive';

const JsonObjectSchema = z.record(z.string(), z.unknown());

/** Set by the API from the socket address on every request, so clients cannot spoof it. */
export const CLIENT_ADDRESS_HEADER = 'x-phodrive-client-address';

export function createAuth(env: Environment, db: Database) {
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

export type Auth = ReturnType<typeof createAuth>;

export type SessionUser = { id: string; email: string };

/** Resolve the session cookie to its user; a missing or expired session is not an error. */
export function readSessionUser(
    auth: Auth,
    headers: Headers
): AsyncResult<SessionUser | null, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const session = await auth.api.getSession({ headers });
            if (!session) return Ok(null);

            return Ok({ id: session.user.id, email: session.user.email });
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

export function requireSessionUser(
    auth: Auth,
    headers: Headers
): AsyncResult<SessionUser, AuthError> {
    return readSessionUser(auth, headers).andThen((user) =>
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
    auth: Auth,
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

        let response: Response;

        try {
            response = await auth.handler(forwarded);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }

        return await withoutSessionToken(response);
    });
}

/** Remove the token from a Better Auth JSON body or its `session` object. */
function omitSessionToken(body: unknown): unknown {
    const parsed = JsonObjectSchema.safeParse(body);
    if (!parsed.success) return body;

    const { token: _token, ...rest } = parsed.data;
    const session = JsonObjectSchema.safeParse(rest.session);
    if (!session.success) return rest;

    const { token: _sessionToken, ...sessionRest } = session.data;

    return { ...rest, session: sessionRest };
}

/**
 * The HttpOnly cookie already carries the session, so JSON bodies never return its token
 * to page scripts.
 */
function withoutSessionToken(response: Response): AsyncResult<Response, AuthError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<Response, AuthError>> => {
        if (!response.headers.get('content-type')?.includes('application/json'))
            return Ok(response);

        let body: unknown;

        try {
            body = await response.json();
        } catch {
            return Err(AUTH_ERRORS.AUTH_REQUEST_FAILED);
        }

        const headers = new Headers(response.headers);
        headers.delete('content-length');

        return Ok(
            new Response(JSON.stringify(omitSessionToken(body)), {
                status: response.status,
                statusText: response.statusText,
                headers
            })
        );
    });
}
