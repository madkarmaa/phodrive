import { defineConfig } from 'drizzle-kit';
import { loadEnv } from 'vite';

// Read the repository root environment files the same way the app does.
const { DATABASE_URL = '' } = loadEnv('development', '..', '');

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/server/db/schema.ts',
    out: './drizzle',
    dbCredentials: { url: DATABASE_URL }
});
