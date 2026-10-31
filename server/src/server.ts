import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import { createApi } from './app';
import type { ServerContext } from './context';
import type { ApiEnv } from './middleware';
import { createWebApp } from './web';

/** The API under /api and, when a web build is given, the web app everywhere else. */
export function createServerApp(context: ServerContext, webRoot?: string) {
    const app = new Hono<ApiEnv>()
        // Rate limits key on the socket address, which a client cannot forge.
        .use('/api/*', async (c, next) => {
            c.set('clientAddress', getConnInfo(c).remote.address ?? '');
            await next();
        })
        .route('/', createApi(context));

    if (!webRoot) return app;

    return app.route('/', createWebApp(webRoot, context.env.preferencesDefaults.theme));
}
