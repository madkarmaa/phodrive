import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThemeMode } from '@madkarmaa/phodrive-core/models';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServerApp } from '../src/server';
import { SPA_FALLBACK } from '../src/web';
import { TEST_ENVIRONMENT, testContext } from './helpers/context';

let webRoot = '';

// What @hono/node-server passes as bindings; the server reads the socket's address.
const BINDINGS = { incoming: { socket: { remoteAddress: '203.0.113.7' } } };

beforeAll(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'phodrive-web-test-'));
    await mkdir(join(webRoot, '_app', 'immutable'), { recursive: true });
    await writeFile(
        join(webRoot, SPA_FALLBACK),
        '<html theme="%phodrive.theme%"><body>app</body></html>'
    );
    await writeFile(join(webRoot, '_app', 'immutable', 'entry.js'), 'export {};');
    await writeFile(join(webRoot, 'robots.txt'), 'User-agent: *');
});

afterAll(() => rm(webRoot, { recursive: true, force: true }));

function server(root = webRoot) {
    const context = testContext({
        preferencesDefaults: { ...TEST_ENVIRONMENT.preferencesDefaults, theme: ThemeMode.Dark }
    });

    return createServerApp(context, root);
}

function get(path: string, root?: string) {
    return server(root).fetch(new Request(`http://localhost${path}`), BINDINGS);
}

test('every app route gets the web app with the deployment theme', async () => {
    for (const path of ['/', '/settings', '/some/deep/route']) {
        const response = await get(path);

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-cache');
        expect(await response.text()).toBe('<html theme="dark"><body>app</body></html>');
    }
});

test('built files are served, and hashed assets are cached forever', async () => {
    const asset = await get('/_app/immutable/entry.js');
    const robots = await get('/robots.txt');

    expect(await asset.text()).toBe('export {};');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await robots.text()).toBe('User-agent: *');
    expect(robots.headers.get('cache-control')).toBeNull();
});

test('unknown API paths stay JSON errors instead of the web app', async () => {
    const response = await get('/api/missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
});

test('a server without a web build says so', async () => {
    const response = await get('/', join(webRoot, 'missing'));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('The web app is not built.');
});
