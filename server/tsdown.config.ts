import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/main.ts', 'src/index.ts'],
    platform: 'node',
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    // The published server includes the web app it serves.
    copy: [{ from: '../web/build', to: 'dist', rename: 'web' }]
});
