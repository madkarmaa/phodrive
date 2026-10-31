import { defineConfig } from 'drizzle-kit';
import { loadEnv } from 'vite';

// Read the repository root environment files, as the development server does.
const { DATABASE_URL = '' } = loadEnv('development', '..', '');

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/db/schema.ts',
    out: './drizzle',
    dbCredentials: { url: DATABASE_URL }
});
