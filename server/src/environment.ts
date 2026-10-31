import { ProcessingModeSchema, type PreferencesDefaults } from '@madkarmaa/phodrive-core/models';
import { parsePreferencesDefaults } from '@madkarmaa/phodrive-core/preferences';
import { Err, Ok, type Result } from 'results-ts';
import { z } from 'zod';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;
const MIN_AUTH_SECRET_LENGTH = 32;

export const DatabaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });
export const AuthSecretSchema = z.string().min(MIN_AUTH_SECRET_LENGTH);

export const EnvironmentSchema = z.object({
    HOST: z
        .string()
        .trim()
        .pipe(z.union([z.hostname(), z.ipv4(), z.ipv6()]))
        .default(DEFAULT_HOST),
    PORT: z
        .string()
        .trim()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.int().min(0).max(MAX_PORT))
        .default(DEFAULT_PORT),
    DATABASE_URL: DatabaseUrlSchema,
    /** Signs sessions and encrypts stored Google tokens. */
    BETTER_AUTH_SECRET: AuthSecretSchema,
    /** Public origin; derived from each request when unset. */
    BETTER_AUTH_URL: z.url().optional(),
    /** Where files are split and encoded. There is no default: it depends on the hardware. */
    PHODRIVE_PROCESSING: ProcessingModeSchema,
    PHODRIVE_DISABLE_SIGNUP: z.stringbool().default(false)
});

export type Environment = z.infer<typeof EnvironmentSchema> & {
    preferencesDefaults: PreferencesDefaults;
};

/** Diagnostics name invalid variables but never include their values. */
export function parseEnvironment(
    environment: Record<string, string | undefined>
): Result<Environment, string> {
    const parsed = EnvironmentSchema.safeParse(environment);

    if (!parsed.success) {
        const invalidVariables = parsed.error.issues.map((issue) => issue.path.join('.'));

        return Err(`Invalid server environment: ${invalidVariables.join(', ')}.`);
    }

    return Ok({ ...parsed.data, preferencesDefaults: parsePreferencesDefaults(environment) });
}
