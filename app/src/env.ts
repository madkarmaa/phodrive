import { building } from '$app/env';
import { defineEnvVars } from '@sveltejs/kit/env';
import { ProcessingMode, ProcessingModeSchema } from '@madkarmaa/phodrive-core/models';
import { z } from 'zod';
import { AuthSecretSchema, DatabaseUrlSchema } from './lib/server/environment';

const OptionalEnvironmentValueSchema = z.string().optional();

/** Builds analyze routes without deployment settings; the running server requires the value. */
function requiredAtRuntime<T>(schema: z.ZodType<T>, placeholder: T) {
    return (value: string | undefined): T => (building ? placeholder : schema.parse(value));
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
    PHODRIVE_PROCESSING: {
        schema: requiredAtRuntime(ProcessingModeSchema, ProcessingMode.Browser),
        description: 'Where files are split and encoded: browser or server. There is no default.'
    },
    DATABASE_URL: {
        schema: requiredAtRuntime(DatabaseUrlSchema, ''),
        description: 'PostgreSQL connection URL.'
    },
    BETTER_AUTH_SECRET: {
        schema: requiredAtRuntime(AuthSecretSchema, ''),
        description: 'Signs sessions and encrypts stored Google tokens.'
    },
    BETTER_AUTH_URL: {
        schema: z.url().optional(),
        description: 'Public origin; derived from each request when unset.'
    }
});
