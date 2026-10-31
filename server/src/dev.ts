import { fileURLToPath } from 'node:url';

// Development reads the repository's environment file; real environment variables take priority.
const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));

try {
    process.loadEnvFile(ENV_FILE);
} catch {
    // The file is optional; the server reports any missing setting itself.
}

await import('./main');
