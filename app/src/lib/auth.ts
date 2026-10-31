import { NewAccountSchema } from '@madkarmaa/phodrive-core/models';
import { z } from 'zod';

/** Better Auth's own limits, repeated so forms reject a password before Google is contacted. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const PASSWORD_LENGTH_ERROR = `Use ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;

export const PasswordSchema = z
    .string()
    .min(MIN_PASSWORD_LENGTH, { error: PASSWORD_LENGTH_ERROR })
    .max(MAX_PASSWORD_LENGTH, { error: PASSWORD_LENGTH_ERROR });

export const SignInSchema = z.object({
    email: z.email({ error: 'Enter a valid email.' }),
    password: z.string().min(1, { error: 'Enter your password.' })
});

/** The email is both the Phodrive sign-in and the Google account the token belongs to. */
export const SignUpSchema = NewAccountSchema.extend({ password: PasswordSchema });

/** The signup form also asks for the password twice; only the first copy is sent. */
export const SignUpFormSchema = SignUpSchema.extend({ confirmPassword: z.string() }).refine(
    (form) => form.password === form.confirmPassword,
    {
        error: 'Passwords do not match.',
        path: ['confirmPassword'],
        // Report a mismatch even while other fields are still invalid.
        when: ({ value }) =>
            z.object({ password: z.string(), confirmPassword: z.string() }).safeParse(value).success
    }
);

export const GoogleTokenSchema = NewAccountSchema.pick({ token: true });

/**
 * Pasted Google tokens are encrypted in the page with the server's public key, so no request
 * carries a token: the server decrypts it, exchanges it, and keeps it.
 */
export const TOKEN_ENCRYPTION = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;
export const TokenKeySchema = z.object({
    key: z.looseObject({ kty: z.literal('RSA'), n: z.string().min(1), e: z.string().min(1) })
});
export const EncryptedTokenSchema = z.base64().min(1);
export const SignUpRequestSchema = SignUpSchema.omit({ token: true }).extend({
    encryptedToken: EncryptedTokenSchema
});
export const GoogleTokenRequestSchema = z.object({ encryptedToken: EncryptedTokenSchema });

export const SignedInUserSchema = z.object({ email: z.email() });

export type SignInInput = z.infer<typeof SignInSchema>;
export type SignUpInput = z.infer<typeof SignUpSchema>;
export type SignUpRequest = z.infer<typeof SignUpRequestSchema>;
export type SignedInUser = z.infer<typeof SignedInUserSchema>;
