import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to source, as the core package exports it under this condition.
const SOURCE_CONDITION = '@madkarmaa/phodrive-core';

export default defineConfig({
    ssr: { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } },
    test: { include: ['tests/**/*.test.ts'] }
});
