import { expect, test, vi } from 'vitest';
import { DEFAULT_PREFERENCES_DEFAULTS } from '$lib/models';
import { parsePreferencesDefaults, readPreferencesDefaults } from '$server/preferences';

const { environment } = vi.hoisted(() => ({
    environment: {
        PHODRIVE_DEFAULT_THEME: 'dark',
        PHODRIVE_DEFAULT_SORT: 'name-desc',
        PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: '90',
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '12'
    }
}));

vi.mock('$env/dynamic/private', () => ({ env: environment }));

test('missing deployment preferences use hardcoded defaults', () => {
    expect(parsePreferencesDefaults({})).toEqual(DEFAULT_PREFERENCES_DEFAULTS);
});

test('named runtime preferences are validated and override hardcoded defaults', () => {
    expect(readPreferencesDefaults()).toEqual({
        theme: 'dark',
        fileSort: 'name-desc',
        refreshIntervalSeconds: 90,
        concurrentWorkers: 12
    });
    expect(
        parsePreferencesDefaults({
            PHODRIVE_DEFAULT_THEME: 'light',
            PHODRIVE_DEFAULT_SORT: 'modified-asc',
            PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: '0',
            PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '32'
        })
    ).toEqual({
        theme: 'light',
        fileSort: 'modified-asc',
        refreshIntervalSeconds: 0,
        concurrentWorkers: 32
    });
});

test('invalid deployment preferences fall back independently without discarding valid settings', () => {
    for (const raw of ['', ' ', '-1', '1.5', 'NaN', 'Infinity', 'true', '"8"', '86401']) {
        const defaults = parsePreferencesDefaults({
            PHODRIVE_DEFAULT_THEME: 'dark',
            PHODRIVE_DEFAULT_SORT: 'invalid',
            PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: raw,
            PHODRIVE_DEFAULT_CONCURRENT_WORKERS: raw
        });

        expect(defaults).toEqual({ ...DEFAULT_PREFERENCES_DEFAULTS, theme: 'dark' });
    }

    expect(
        parsePreferencesDefaults({
            PHODRIVE_DEFAULT_THEME: 'invalid',
            PHODRIVE_DEFAULT_SORT: 'name-asc',
            PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: '86400',
            PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '0'
        })
    ).toEqual({
        theme: 'auto',
        fileSort: 'name-asc',
        refreshIntervalSeconds: 86400,
        concurrentWorkers: 8
    });
});

test('deployment parsing never reads unrelated private environment values', () => {
    const environment = {
        PHODRIVE_DEFAULT_THEME: 'light',
        get UNRELATED_PRIVATE_VALUE(): string {
            throw new Error('Unrelated private environment access');
        }
    };

    expect(parsePreferencesDefaults(environment)).toEqual({
        ...DEFAULT_PREFERENCES_DEFAULTS,
        theme: 'light'
    });
});
