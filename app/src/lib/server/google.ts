import * as env from '$app/env/private';
import type { Account } from '@madkarmaa/phodrive-core/models';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { SessionUser } from '#server/auth';
import { db } from '#server/db/client';
import { googleAccount } from '#server/db/schema';
import { AUTH_ERRORS, type AuthError } from '#server/errors';

type StoredGoogleAccount = { email: string; encryptedToken: string };

function findStoredAccount(userId: string): AsyncResult<StoredGoogleAccount | null, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const [stored] = await db
                .select({
                    email: googleAccount.email,
                    encryptedToken: googleAccount.encryptedToken
                })
                .from(googleAccount)
                .where(eq(googleAccount.userId, userId))
                .limit(1);

            return Ok(stored ?? null);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

function decryptToken(encryptedToken: string): AsyncResult<string, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const token = await symmetricDecrypt({
                key: env.BETTER_AUTH_SECRET,
                data: encryptedToken
            });

            return Ok(token);
        } catch {
            return Err(AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE);
        }
    });
}

function encryptToken(token: string): AsyncResult<string, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const encrypted = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: token });

            return Ok(encrypted);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

/** Decrypt the signed-in user's Google account for a server-side Google Photos request. */
export function readGoogleAccount(userId: string): AsyncResult<Account, AuthError> {
    return findStoredAccount(userId)
        .andThen((stored) => (stored ? Ok(stored) : Err(AUTH_ERRORS.GOOGLE_ACCOUNT_MISSING)))
        .andThenAsync((stored) =>
            decryptToken(stored.encryptedToken).map((token) => ({ email: stored.email, token }))
        );
}

/** The Google email stays readable when its token cannot be, so the token can be replaced. */
export function readGoogleEmail(user: SessionUser): AsyncResult<string, AuthError> {
    return findStoredAccount(user.id).map((stored) => stored?.email ?? user.email);
}

/** Store or replace the user's Google account with its AAS token encrypted at rest. */
export function saveGoogleAccount(userId: string, account: Account): AsyncResult<void, AuthError> {
    return encryptToken(account.token).andThenAsync(async (encryptedToken) => {
        try {
            await db
                .insert(googleAccount)
                .values({ userId, email: account.email, encryptedToken })
                .onConflictDoUpdate({
                    target: googleAccount.userId,
                    set: { email: account.email, encryptedToken, updatedAt: new Date() }
                });

            return Ok(undefined);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}
