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

export const GoogleTokenSchema = NewAccountSchema.pick({ token: true });

export const SignedInUserSchema = z.object({ email: z.email() });

export type SignInInput = z.infer<typeof SignInSchema>;
export type SignUpInput = z.infer<typeof SignUpSchema>;
export type SignedInUser = z.infer<typeof SignedInUserSchema>;
