import { expect, test } from 'vitest';
import { parseDatabaseUrl, parseServerEnvironment } from '#server/environment';

test('unset server environment uses the local defaults', () => {
    const parsed = parseServerEnvironment({});

    expect(parsed.unwrap()).toEqual({ HOST: '127.0.0.1', PORT: 3000 });
});

test('server environment supports Docker, hostnames, IPv6 and ephemeral ports', () => {
    for (const HOST of ['0.0.0.0', 'localhost', '::1']) {
        const parsed = parseServerEnvironment({ HOST, PORT: '0' });

        expect(parsed.unwrap()).toEqual({ HOST, PORT: 0 });
    }

    const parsed = parseServerEnvironment({ HOST: ' 127.0.0.1 ', PORT: ' 65535 ' });

    expect(parsed.unwrap()).toEqual({ HOST: '127.0.0.1', PORT: 65535 });
});

test('invalid port values fail instead of silently choosing a port', () => {
    for (const PORT of ['', ' ', '-1', '1.5', '65536', 'NaN', 'Infinity', '0xBB8', '3e3']) {
        const parsed = parseServerEnvironment({ PORT });

        expect(parsed.unwrapErr()).toBe('Invalid server environment: PORT.');
    }
});

test('invalid host values fail and diagnostics never include environment values', () => {
    for (const HOST of ['', ' ', 'http://localhost', 'localhost:3000', 'bad host']) {
        const parsed = parseServerEnvironment({ HOST, PORT: 'private-invalid-value' });

        expect(parsed.unwrapErr()).toBe('Invalid server environment: HOST, PORT.');
    }

    const parsed = parseServerEnvironment({
        HOST: 'localhost',
        get UNRELATED_SECRET(): string {
            throw new Error('Unrelated secret must not be read');
        }
    });

    expect(parsed.unwrap()).toEqual({ HOST: 'localhost', PORT: 3000 });
});

test('the database URL must be a PostgreSQL URL and diagnostics never include it', () => {
    const url = 'postgres://phodrive:secret@127.0.0.1:5432/phodrive';

    expect(parseDatabaseUrl({ DATABASE_URL: url }).unwrap()).toBe(url);

    for (const DATABASE_URL of [undefined, '', 'mysql://user:secret@host/db', 'not a url']) {
        const parsed = parseDatabaseUrl({ DATABASE_URL });

        expect(parsed.unwrapErr()).toBe('Invalid server environment: DATABASE_URL.');
    }
});
