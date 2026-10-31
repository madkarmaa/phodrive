import { Err, Ok, type Result } from 'results-ts';
import { z } from 'zod';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;
const MIN_AUTH_SECRET_LENGTH = 32;

export const DatabaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });
export const AuthSecretSchema = z.string().min(MIN_AUTH_SECRET_LENGTH);

export const ServerEnvironmentSchema = z.object({
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
        .default(DEFAULT_PORT)
});

export type ServerEnvironment = z.infer<typeof ServerEnvironmentSchema>;

export function parseServerEnvironment(
    environment: Record<string, string | undefined>
): Result<ServerEnvironment, string> {
    const parsed = ServerEnvironmentSchema.safeParse(environment);

    if (!parsed.success) {
        const invalidVariables = parsed.error.issues.map((issue) => issue.path.join('.'));

        return Err(`Invalid server environment: ${invalidVariables.join(', ')}.`);
    }

    return Ok(parsed.data);
}

/** Startup migrations read the database URL before the app's own environment is loaded. */
export function parseDatabaseUrl(
    environment: Record<string, string | undefined>
): Result<string, string> {
    const parsed = DatabaseUrlSchema.safeParse(environment.DATABASE_URL);
    if (!parsed.success) return Err('Invalid server environment: DATABASE_URL.');

    return Ok(parsed.data);
}
