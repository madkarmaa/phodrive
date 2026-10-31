import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ThemeMode } from '@madkarmaa/phodrive-core/models';
import { Hono } from 'hono';
import { Err, Ok, type AsyncResult } from 'results-ts';

/** The single page that boots the web app on any route; the web build writes it with this name. */
export const SPA_FALLBACK = '200.html';
const THEME_PLACEHOLDER = '%phodrive.theme%';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

function readFallback(root: string, theme: ThemeMode): AsyncResult<string, string> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const html = await readFile(join(root, SPA_FALLBACK), 'utf8');

            // The deployment theme applies until the browser has a saved choice.
            return Ok(html.replaceAll(THEME_PLACEHOLDER, theme));
        } catch {
            return Err('The web app is not built.');
        }
    });
}

/** Serve the built web app: hashed assets are cached forever, every other route gets the SPA. */
export function createWebApp(root: string, theme: ThemeMode) {
    let fallback: AsyncResult<string, string> | undefined;

    return new Hono()
        .use('/_app/immutable/*', async (c, next) => {
            await next();
            if (c.res.ok) c.header('cache-control', IMMUTABLE_CACHE);
        })
        .use('*', serveStatic({ root }))
        .get('*', async (c) => {
            fallback ??= readFallback(root, theme);
            const page = await fallback;

            return page.match({
                Ok: (html) => c.html(html, 200, { 'cache-control': 'no-cache' }),
                Err: (message) => {
                    fallback = undefined;

                    return c.text(message, 404);
                }
            });
        });
}
