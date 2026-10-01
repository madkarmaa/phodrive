import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import {
    defaultClientConditions,
    defaultServerConditions,
    type PreviewServer,
    type ViteDevServer
} from 'vite';
import { defineConfig } from 'vitest/config';
import { functionsMixins } from 'vite-plugin-functions-mixins';

function disableRequestTimeouts({ httpServer }: ViteDevServer | PreviewServer) {
    if (!httpServer) return;

    if ('requestTimeout' in httpServer) httpServer.requestTimeout = 0;
    if ('headersTimeout' in httpServer) httpServer.headersTimeout = 0;
}

export default defineConfig({
    test: { include: ['tests/**/*.test.ts'] },
    // m3-svelte exposes CSS through its `style` export condition.
    resolve: { conditions: [...defaultClientConditions, 'style'] },
    ssr: { resolve: { conditions: [...defaultServerConditions, 'style'] } },
    optimizeDeps: { exclude: ['m3-svelte'] },
    plugins: [
        {
            name: 'disable-request-timeouts',
            configureServer: disableRequestTimeouts,
            configurePreviewServer: disableRequestTimeouts
        },
        // Compile Material 3 functions and mixins before Tailwind processes CSS.
        { ...functionsMixins({ deps: ['m3-svelte'] }), enforce: 'pre' },
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
