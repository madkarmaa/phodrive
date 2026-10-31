#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createContext } from './context';
import { migrateDatabase } from './db/migrate';
import { parseEnvironment, type Environment } from './environment';
import { createServerApp } from './server';

// Both resolve inside the package, from src/ in development and from dist/ once built.
const WEB_ROOT = fileURLToPath(new URL('./web', import.meta.url));
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

function listeningOn({ address, family, port }: AddressInfo): string {
    const host = family === 'IPv6' ? `[${address}]` : address;

    return `http://${host}:${port}`;
}

function start(env: Environment) {
    const context = createContext(env);
    // In development the web app has its own server, so only the API runs here.
    const webBuilt = existsSync(WEB_ROOT);
    if (!webBuilt) console.log('No web build next to the server; serving only the API.');

    const app = createServerApp(context, webBuilt ? WEB_ROOT : undefined);

    const server = serve(
        {
            fetch: app.fetch,
            hostname: env.HOST,
            port: env.PORT,
            // Uploads and downloads of large files can take far longer than the default limits.
            serverOptions: { requestTimeout: 0, headersTimeout: 0 }
        },
        (info) => console.log(`Listening on ${listeningOn(info)}`)
    );

    const shutdown = () => {
        server.close();
        void context.db.$client.end();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

const ready = await parseEnvironment(process.env).andThenAsync((env) =>
    migrateDatabase(env.DATABASE_URL, MIGRATIONS_FOLDER).map(() => env)
);

ready.match({
    Ok: start,
    Err: (message) => {
        console.error(message);
        process.exitCode = 1;
    }
});
