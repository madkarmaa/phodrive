import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['benchmarks/**/*.test.ts'],
        fileParallelism: false,
        maxWorkers: 1,
        testTimeout: 300_000
    }
});
