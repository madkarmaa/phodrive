import { SignUpSchema } from '@madkarmaa/phodrive-core/auth';
import { z } from 'zod';

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
