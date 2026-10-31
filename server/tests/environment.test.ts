import { FileSort, ProcessingMode, ThemeMode } from '@madkarmaa/phodrive-core/models';
import { expect, test } from 'vitest';
import { parseEnvironment } from '../src/environment';

const REQUIRED = {
    DATABASE_URL: 'postgres://phodrive:secret@127.0.0.1:5432/phodrive',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    PHODRIVE_PROCESSING: 'browser'
};

test('unset optional settings use the local defaults', () => {
    const parsed = parseEnvironment(REQUIRED).unwrap();

    expect(parsed).toMatchObject({
        HOST: '127.0.0.1',
        PORT: 3000,
        PHODRIVE_PROCESSING: ProcessingMode.Browser,
        PHODRIVE_DISABLE_SIGNUP: false
    });
    expect(parsed.BETTER_AUTH_URL).toBeUndefined();
});

test('server environment supports Docker, hostnames, IPv6 and ephemeral ports', () => {
    for (const HOST of ['0.0.0.0', 'localhost', '::1']) {
        const parsed = parseEnvironment({ ...REQUIRED, HOST, PORT: '0' }).unwrap();

        expect(parsed).toMatchObject({ HOST, PORT: 0 });
    }

    const parsed = parseEnvironment({ ...REQUIRED, HOST: ' 127.0.0.1 ', PORT: ' 65535 ' });

    expect(parsed.unwrap()).toMatchObject({ HOST: '127.0.0.1', PORT: 65535 });
});

test('invalid port values fail instead of silently choosing a port', () => {
    for (const PORT of ['', ' ', '-1', '1.5', '65536', 'NaN', 'Infinity', '0xBB8', '3e3']) {
        const parsed = parseEnvironment({ ...REQUIRED, PORT });

        expect(parsed.unwrapErr()).toBe('Invalid server environment: PORT.');
    }
});

test('processing, database, and secret are required and diagnostics never include values', () => {
    const missing = parseEnvironment({});

    expect(missing.unwrapErr()).toBe(
        'Invalid server environment: DATABASE_URL, BETTER_AUTH_SECRET, PHODRIVE_PROCESSING.'
    );

    const invalid = parseEnvironment({
        DATABASE_URL: 'mysql://user:private-value@host/db',
        BETTER_AUTH_SECRET: 'private-short',
        PHODRIVE_PROCESSING: 'private-mode',
        HOST: 'bad host'
    });

    expect(invalid.unwrapErr()).toBe(
        'Invalid server environment: HOST, DATABASE_URL, BETTER_AUTH_SECRET, PHODRIVE_PROCESSING.'
    );
    expect(invalid.unwrapErr()).not.toContain('private');
});

test('unrelated environment variables are never read', () => {
    const parsed = parseEnvironment({
        ...REQUIRED,
        get UNRELATED_SECRET(): string {
            throw new Error('Unrelated secret must not be read');
        }
    });

    expect(parsed.isOk()).toBe(true);
});

test('signup can be disabled and deployment display defaults are read', () => {
    const parsed = parseEnvironment({
        ...REQUIRED,
        PHODRIVE_PROCESSING: 'server',
        PHODRIVE_DISABLE_SIGNUP: 'true',
        PHODRIVE_DEFAULT_THEME: 'dark',
        PHODRIVE_DEFAULT_SORT: 'name-desc',
        PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: '90',
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '12'
    }).unwrap();

    expect(parsed.PHODRIVE_PROCESSING).toBe(ProcessingMode.Server);
    expect(parsed.PHODRIVE_DISABLE_SIGNUP).toBe(true);
    expect(parsed.preferencesDefaults).toEqual({
        theme: ThemeMode.Dark,
        fileSort: FileSort.NameDescending,
        refreshIntervalSeconds: 90,
        concurrentWorkers: 12
    });
});
