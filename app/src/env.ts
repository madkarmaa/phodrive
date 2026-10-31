import { building } from '$app/env';
import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';
import { AuthSecretSchema, DatabaseUrlSchema } from './lib/server/environment';

const OptionalEnvironmentValueSchema = z.string().optional();

/** Builds analyze routes without deployment secrets; the running server requires the value. */
function requiredAtRuntime(schema: z.ZodType<string>) {
    return (value: string | undefined): string => (building ? (value ?? '') : schema.parse(value));
}

export const variables = defineEnvVars({
    PHODRIVE_DEFAULT_THEME: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_DEFAULT_SORT: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_DEFAULT_CONCURRENT_WORKERS: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_DISABLE_SIGNUP: {
        schema: z.stringbool().default(false),
        description: 'Set to true to stop new signups.'
    },
    DATABASE_URL: {
        schema: requiredAtRuntime(DatabaseUrlSchema),
        description: 'PostgreSQL connection URL.'
    },
    BETTER_AUTH_SECRET: {
        schema: requiredAtRuntime(AuthSecretSchema),
        description: 'Signs sessions and encrypts stored Google tokens.'
    },
    BETTER_AUTH_URL: {
        schema: z.url().optional(),
        description: 'Public origin; derived from each request when unset.'
    }
});
