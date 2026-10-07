import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: Object.fromEntries(
            [
                ['$lib', '../src/lib'],
                ['$browser', '../src/lib/browser'],
                ['$server', '../src/lib/server']
            ].map(([name, path]) => [name, fileURLToPath(new URL(path, import.meta.url))])
        )
    },
    test: {
        include: ['benchmarks/**/*.test.ts'],
        fileParallelism: false,
        maxWorkers: 1,
        testTimeout: 300_000
    }
});
