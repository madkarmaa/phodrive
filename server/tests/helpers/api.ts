import { Err, Ok } from 'results-ts';
import { ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { TOKEN_ENCRYPTION, TokenKeySchema } from '@madkarmaa/phodrive-core/auth';
import { Hono } from 'hono';
import { createApi } from '../../src/app';
import type { ApiEnv } from '../../src/middleware';
import { testContext } from './context';

export const USER = { id: 'user-id', email: 'test@example.com' };
export const ACCOUNT = { email: 'test@example.com', token: 'aas_et/stored' };
export const CLIENT_ADDRESS = '203.0.113.7';

/** Where this server processes files; tests may switch it and reset it before each test. */
export const settings = { processing: ProcessingMode.Browser };

export function resolved<T>(value: T) {
    return Ok(value).andThenAsync(async (current) => Ok(current));
}

export function rejected<E>(error: E) {
    return Ok(undefined).andThenAsync(async () => Err(error));
}

/** The API as the server mounts it, with the socket address the server would set. */
export function call(path: string, init: RequestInit = {}) {
    const app = new Hono<ApiEnv>()
        .use(async (c, next) => {
            c.set('clientAddress', CLIENT_ADDRESS);
            await next();
        })
        .route('/', createApi(testContext({ PHODRIVE_PROCESSING: settings.processing })));

    return app.fetch(new Request(`http://localhost${path}`, init));
}

/** Encrypt like the browser does, with the key the server publishes. */
export async function encrypted(token: string): Promise<string> {
    const response = await call('/api/account/key');
    const { key } = TokenKeySchema.parse(await response.json());
    const publicKey = await crypto.subtle.importKey('jwk', key, TOKEN_ENCRYPTION, false, [
        'encrypt'
    ]);
    const ciphertext = await crypto.subtle.encrypt(
        TOKEN_ENCRYPTION,
        publicKey,
        new TextEncoder().encode(token)
    );

    return Buffer.from(ciphertext).toString('base64');
}

export function postJson(path: string, body: unknown, method = 'POST') {
    return call(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}
