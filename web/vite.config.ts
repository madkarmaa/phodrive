import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import {
    defaultClientConditions,
    defaultServerConditions,
    loadEnv,
    type ViteDevServer
} from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve core to source for hot reload, as the core package exports it under this condition.
const SOURCE_CONDITION = '@madkarmaa/phodrive-core';
/** The API server serves this file for every path that is not an asset or an API route. */
export const SPA_FALLBACK = '200.html';

// In development the API runs separately; its HOST and PORT come from the root environment file.
const { HOST = '127.0.0.1', PORT = '3000' } = loadEnv('development', '..', '');
const API_ORIGIN = `http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}`;

function disableRequestTimeouts({ httpServer }: ViteDevServer) {
    if (!httpServer) return;

    if ('requestTimeout' in httpServer) httpServer.requestTimeout = 0;
    if ('headersTimeout' in httpServer) httpServer.headersTimeout = 0;
}

export default defineConfig({
    envDir: '..',
    resolve: { conditions: [SOURCE_CONDITION, ...defaultClientConditions] },
    ssr: {
        noExternal: ['@madkarmaa/phodrive-core'],
        resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] }
    },
    server: {
        // Uploads and their progress events stream through the proxy without timeouts.
        proxy: { '/api': { target: API_ORIGIN, timeout: 0, proxyTimeout: 0 } }
    },
    test: { include: ['tests/**/*.test.ts'] },
    plugins: [
        { name: 'disable-request-timeouts', configureServer: disableRequestTimeouts },
        tailwindcss(),
        sveltekit({
            env: { dir: '..' },
            compilerOptions: {
                // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
                runes: ({ filename }) =>
                    filename.split(/[/\\]/).includes('node_modules') ? undefined : true
            },
            adapter: adapter({ fallback: SPA_FALLBACK })
        }),
        Icons({ compiler: 'svelte' })
    ]
});
