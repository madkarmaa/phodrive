import {
    FileLayout,
    DEFAULT_FILE_LAYOUT,
    ThemeMode,
    DEFAULT_CONCURRENT_WORKERS,
    DEFAULT_REFRESH_INTERVAL_SECONDS,
    FileSortSchema,
    MAX_CONCURRENT_WORKERS,
    MAX_REFRESH_INTERVAL_SECONDS
} from '@madkarmaa/phodrive-core/models';
import { afterAll, afterEach, beforeEach, expect, vi, test } from 'vitest';
import {
    BrowserPreferences,
    CONCURRENT_WORKERS_SERIALIZER,
    FILE_SORT_SERIALIZER,
    FILE_LAYOUT_KEY,
    FILE_LAYOUT_SERIALIZER,
    LEGACY_CREDENTIAL_KEYS,
    REFRESH_INTERVAL_SERIALIZER,
    THEME_SERIALIZER,
    THEME_KEY,
    removeLegacyCredentials
} from '#browser/storage';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('file layout rejects invalid stored values and persists the selected view', () => {
    storage.setItem(FILE_LAYOUT_KEY, 'invalid-layout');
    const preferences = new BrowserPreferences();

    expect(preferences.fileLayout).toBe(DEFAULT_FILE_LAYOUT);
    expect(FILE_LAYOUT_SERIALIZER.deserialize('null')).toBeUndefined();

    expect(preferences.saveFileLayout(FileLayout.Grid).isOk()).toBe(true);
    expect(storage.getItem(FILE_LAYOUT_KEY)).toBe(FileLayout.Grid);
    expect(new BrowserPreferences().fileLayout).toBe(FileLayout.Grid);

    expect(preferences.saveFileLayout(FileLayout.List).isOk()).toBe(true);
    expect(new BrowserPreferences().fileLayout).toBe(FileLayout.List);
});

test('tokens left by earlier versions are deleted while preferences stay', () => {
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/legacy' }));
    storage.setItem('selectedAccount', JSON.stringify('test@example.com'));
    storage.setItem(THEME_KEY, ThemeMode.Dark);

    expect(removeLegacyCredentials().isOk()).toBe(true);

    for (const key of LEGACY_CREDENTIAL_KEYS) expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(THEME_KEY)).toBe(ThemeMode.Dark);
});

test('plain-text theme serialization retains its storage format', () => {
    for (const mode of [ThemeMode.Light, ThemeMode.Dark, ThemeMode.Auto] as const) {
        expect(THEME_SERIALIZER.serialize(mode)).toBe(mode);
        expect(THEME_SERIALIZER.deserialize(mode)).toBe(mode);
    }
    expect(THEME_SERIALIZER.deserialize('invalid')).toBeUndefined();
    expect(THEME_SERIALIZER.deserialize('"dark"')).toBeUndefined();
});

test('stored sort choices are validated and invalid values leave deployment defaults available', () => {
    for (const order of FileSortSchema.options) {
        const stored = FILE_SORT_SERIALIZER.serialize(order);

        expect(FILE_SORT_SERIALIZER.deserialize(stored)).toBe(order);
    }

    expect(FILE_SORT_SERIALIZER.deserialize('invalid')).toBeUndefined();
    expect(FILE_SORT_SERIALIZER.deserialize('null')).toBeUndefined();
});

test('refresh and worker preferences validate persisted boundaries and reject malformed data', () => {
    for (const seconds of [0, 1, DEFAULT_REFRESH_INTERVAL_SECONDS, MAX_REFRESH_INTERVAL_SECONDS]) {
        const stored = REFRESH_INTERVAL_SERIALIZER.serialize(seconds);

        expect(REFRESH_INTERVAL_SERIALIZER.deserialize(stored)).toBe(seconds);
    }

    for (const workers of [1, DEFAULT_CONCURRENT_WORKERS, MAX_CONCURRENT_WORKERS]) {
        const stored = CONCURRENT_WORKERS_SERIALIZER.serialize(workers);

        expect(CONCURRENT_WORKERS_SERIALIZER.deserialize(stored)).toBe(workers);
    }

    expect(REFRESH_INTERVAL_SERIALIZER.deserialize('null')).toBeNull();
    expect(CONCURRENT_WORKERS_SERIALIZER.deserialize('null')).toBeNull();

    for (const raw of ['-1', '1.5', '"8"', '[]', '{}', 'true', 'NaN', '{']) {
        expect(REFRESH_INTERVAL_SERIALIZER.deserialize(raw)).toBeUndefined();
        expect(CONCURRENT_WORKERS_SERIALIZER.deserialize(raw)).toBeUndefined();
    }

    expect(
        REFRESH_INTERVAL_SERIALIZER.deserialize(String(MAX_REFRESH_INTERVAL_SECONDS + 1))
    ).toBeUndefined();
    expect(CONCURRENT_WORKERS_SERIALIZER.deserialize('0')).toBeUndefined();
    expect(
        CONCURRENT_WORKERS_SERIALIZER.deserialize(String(MAX_CONCURRENT_WORKERS + 1))
    ).toBeUndefined();
});
