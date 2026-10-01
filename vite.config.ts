import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import type { PreviewServer, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';

function disableRequestTimeouts({ httpServer }: ViteDevServer | PreviewServer) {
    if (!httpServer) return;

    if ('requestTimeout' in httpServer) httpServer.requestTimeout = 0;
    if ('headersTimeout' in httpServer) httpServer.headersTimeout = 0;
}

export default defineConfig({
    test: { include: ['tests/**/*.test.ts'] },
    plugins: [
        {
            name: 'disable-request-timeouts',
            configureServer: disableRequestTimeouts,
            configurePreviewServer: disableRequestTimeouts
        },
        tailwindcss(),
        sveltekit({
            alias: {
                $components: 'src/lib/components',
                $browser: 'src/lib/browser',
                $server: 'src/lib/server',
                $assets: 'src/lib/assets',
                $package: 'package.json'
            },
            compilerOptions: {
                // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
                runes: ({ filename }) =>
                    filename.split(/[/\\]/).includes('node_modules') ? undefined : true
            },
            adapter: adapter()
        }),
        Icons({ compiler: 'svelte' })
    ]
});
