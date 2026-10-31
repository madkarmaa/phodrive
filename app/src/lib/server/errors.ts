import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Account and session failures carry the HTTP status the API responds with. */
export type AuthError = {
    readonly code:
        | 'SIGNED_OUT'
        | 'SIGNUP_DISABLED'
        | 'EMAIL_TAKEN'
        | 'SIGN_UP_FAILED'
        | 'AUTH_REQUEST_FAILED'
        | 'DATABASE_UNAVAILABLE'
        | 'GOOGLE_ACCOUNT_MISSING'
        | 'GOOGLE_ACCOUNT_UNREADABLE'
        | 'TOKEN_DECRYPTION_FAILED'
        | 'NOT_FOUND';
    readonly message: string;
    readonly status: ContentfulStatusCode;
};

export const AUTH_ERRORS = {
    SIGNED_OUT: { code: 'SIGNED_OUT', message: 'Sign in to continue.', status: 401 },
    SIGNUP_DISABLED: {
        code: 'SIGNUP_DISABLED',
        message: 'Signup is disabled on this server.',
        status: 403
    },
    EMAIL_TAKEN: {
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists. Sign in instead.',
        status: 409
    },
    SIGN_UP_FAILED: {
        code: 'SIGN_UP_FAILED',
        message: 'Could not create your account. Try again.',
        status: 400
    },
    AUTH_REQUEST_FAILED: {
        code: 'AUTH_REQUEST_FAILED',
        message: 'Could not read the request.',
        status: 400
    },
    DATABASE_UNAVAILABLE: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is unavailable. Try again later.',
        status: 503
    },
    GOOGLE_ACCOUNT_MISSING: {
        code: 'GOOGLE_ACCOUNT_MISSING',
        message: 'Connect your Google account in Settings.',
        status: 409
    },
    GOOGLE_ACCOUNT_UNREADABLE: {
        code: 'GOOGLE_ACCOUNT_UNREADABLE',
        message: 'Your saved Google token could not be read. Replace it in Settings.',
        status: 409
    },
    TOKEN_DECRYPTION_FAILED: {
        code: 'TOKEN_DECRYPTION_FAILED',
        message: 'The server could not read the token. Reload the page and try again.',
        status: 400
    },
    NOT_FOUND: { code: 'NOT_FOUND', message: 'Not found.', status: 404 }
} as const satisfies Record<string, AuthError>;
