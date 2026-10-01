import { afterAll, afterEach, beforeEach, expect, vi, test } from 'vitest';
import {
    ACCOUNTS_SERIALIZER,
    BrowserPreferences,
    CONCURRENT_WORKERS_KEY,
    CONCURRENT_WORKERS_SERIALIZER,
    FILE_SORT_SERIALIZER,
    FILE_SORT_KEY,
    REFRESH_INTERVAL_SERIALIZER,
    REFRESH_INTERVAL_KEY,
    SELECTED_ACCOUNT_SERIALIZER,
    THEME_SERIALIZER,
    THEME_KEY
} from '$browser/storage';
import {
    DEFAULT_CONCURRENT_WORKERS,
    DEFAULT_FILE_SORT,
    DEFAULT_REFRESH_INTERVAL_SECONDS,
    DEFAULT_PREFERENCES_DEFAULTS,
    FileSortSchema,
    MAX_CONCURRENT_WORKERS,
    MAX_REFRESH_INTERVAL_SECONDS,
    type PreferencesDefaults
} from '$lib/models';

const { storage } = vi.hoisted(() => {
    class MemoryStorage implements Storage {
        private readonly items = new Map<string, string>();

        get length(): number {
            return this.items.size;
        }

        key(index: number): string | null {
            return [...this.items.keys()][index] ?? null;
        }

        getItem(key: string): string | null {
            return this.items.get(key) ?? null;
        }

        setItem(key: string, value: string): void {
            this.items.set(key, value);
        }

        removeItem(key: string): void {
            this.items.delete(key);
        }

        clear(): void {
            this.items.clear();
        }
    }

    const storage = new MemoryStorage();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

const DEPLOYMENT_DEFAULTS: PreferencesDefaults = {
    theme: 'dark',
    fileSort: 'name-asc',
    refreshIntervalSeconds: 120,
    concurrentWorkers: 4
};

test('stored accounts retain valid entries and reject malformed data without logging credentials', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stored = {
        'valid@example.com': 'aas_et/test',
        'invalid-email': 'aas_et/test',
        'oauth@example.com': 'oauth2_4/test',
        'number@example.com': 123
    };

    expect(ACCOUNTS_SERIALIZER.deserialize(JSON.stringify(stored))).toEqual({
        'valid@example.com': 'aas_et/test'
    });
    expect(ACCOUNTS_SERIALIZER.deserialize('{"secret":"aas_et/test"')).toEqual({});
    expect(ACCOUNTS_SERIALIZER.deserialize('null')).toEqual({});
    expect(ACCOUNTS_SERIALIZER.deserialize('[]')).toEqual({});
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
});

test('account JSON and plain-text theme serialization retain their storage formats', () => {
    const accounts = { 'valid@example.com': 'aas_et/test' };
    const serialized = ACCOUNTS_SERIALIZER.serialize(accounts);

    expect(ACCOUNTS_SERIALIZER.deserialize(serialized)).toEqual(accounts);
    for (const mode of ['light', 'dark', 'auto'] as const) {
        expect(THEME_SERIALIZER.serialize(mode)).toBe(mode);
        expect(THEME_SERIALIZER.deserialize(mode)).toBe(mode);
    }
    expect(THEME_SERIALIZER.deserialize('invalid')).toBeUndefined();
    expect(THEME_SERIALIZER.deserialize('"dark"')).toBeUndefined();
});

test('selected account serialization distinguishes an empty selection from missing storage', () => {
    const empty = SELECTED_ACCOUNT_SERIALIZER.serialize('');

    expect(empty).not.toBe('');
    expect(SELECTED_ACCOUNT_SERIALIZER.deserialize(empty)).toBe('');
    expect(
        SELECTED_ACCOUNT_SERIALIZER.deserialize(
            SELECTED_ACCOUNT_SERIALIZER.serialize('valid@example.com')
        )
    ).toBe('valid@example.com');
    expect(SELECTED_ACCOUNT_SERIALIZER.deserialize('null')).toBe('');
    expect(SELECTED_ACCOUNT_SERIALIZER.deserialize('123')).toBe('');
    expect(SELECTED_ACCOUNT_SERIALIZER.deserialize('"invalid-email"')).toBe('');
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

test('absent browser choices use deployment defaults without seeding local storage', () => {
    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);

    expect(preferences.theme).toBe('dark');
    expect(preferences.fileSort).toBe('name-asc');
    expect(preferences.refreshIntervalSeconds).toBe(120);
    expect(preferences.concurrentWorkers).toBe(4);

    for (const key of [THEME_KEY, FILE_SORT_KEY, REFRESH_INTERVAL_KEY, CONCURRENT_WORKERS_KEY]) {
        expect(storage.getItem(key)).toBeNull();
    }

    const changedDeployment = new BrowserPreferences(DEFAULT_PREFERENCES_DEFAULTS);

    expect(changedDeployment.theme).toBe('auto');
    expect(changedDeployment.fileSort).toBe(DEFAULT_FILE_SORT);
    expect(changedDeployment.refreshIntervalSeconds).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
    expect(changedDeployment.concurrentWorkers).toBe(DEFAULT_CONCURRENT_WORKERS);
});

test('explicit saved browser choices override deployment defaults, including zero refresh and auto theme', () => {
    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);

    expect(preferences.saveTheme('auto').isOk()).toBe(true);
    expect(preferences.saveFileSort('modified-asc').isOk()).toBe(true);
    expect(preferences.saveRefreshInterval(0).isOk()).toBe(true);
    expect(preferences.saveConcurrentWorkers(16).isOk()).toBe(true);

    const reloaded = new BrowserPreferences({
        theme: 'light',
        fileSort: 'name-desc',
        refreshIntervalSeconds: 30,
        concurrentWorkers: 2
    });

    expect(reloaded.theme).toBe('auto');
    expect(reloaded.fileSort).toBe('modified-asc');
    expect(reloaded.refreshIntervalSeconds).toBe(0);
    expect(reloaded.concurrentWorkers).toBe(16);
});

test('invalid stored choices use deployment defaults without rewriting the stored data', () => {
    storage.setItem(THEME_KEY, 'invalid');
    storage.setItem(FILE_SORT_KEY, 'invalid');
    storage.setItem(REFRESH_INTERVAL_KEY, '"60"');
    storage.setItem(CONCURRENT_WORKERS_KEY, '33');

    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);

    expect(preferences.theme).toBe('dark');
    expect(preferences.fileSort).toBe('name-asc');
    expect(preferences.refreshIntervalSeconds).toBe(120);
    expect(preferences.concurrentWorkers).toBe(4);
    expect(storage.getItem(THEME_KEY)).toBe('invalid');
    expect(storage.getItem(FILE_SORT_KEY)).toBe('invalid');
    expect(storage.getItem(REFRESH_INTERVAL_KEY)).toBe('"60"');
    expect(storage.getItem(CONCURRENT_WORKERS_KEY)).toBe('33');
});

test('invalid refresh and worker saves return errors while retaining the current preference', () => {
    const preferences = new BrowserPreferences();

    for (const seconds of [-1, 0.5, Number.NaN, Infinity, MAX_REFRESH_INTERVAL_SECONDS + 1]) {
        const saved = preferences.saveRefreshInterval(seconds);

        expect(saved.isErr()).toBe(true);
        expect(preferences.refreshIntervalSeconds).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
    }

    for (const workers of [0, -1, 1.5, Number.NaN, Infinity, MAX_CONCURRENT_WORKERS + 1]) {
        const saved = preferences.saveConcurrentWorkers(workers);

        expect(saved.isErr()).toBe(true);
        expect(preferences.concurrentWorkers).toBe(DEFAULT_CONCURRENT_WORKERS);
    }
});

test('reset clears only its browser override and follows current and future deployment defaults', () => {
    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);

    preferences.saveTheme('light').unwrap();
    preferences.saveFileSort('name-desc').unwrap();
    preferences.saveRefreshInterval(0).unwrap();
    preferences.saveConcurrentWorkers(16).unwrap();

    preferences.resetRefreshInterval().unwrap();

    expect(preferences.refreshIntervalSeconds).toBe(120);
    expect(storage.getItem(REFRESH_INTERVAL_KEY)).toBeNull();
    expect(preferences.concurrentWorkers).toBe(16);

    preferences.resetConcurrentWorkers().unwrap();

    expect(preferences.concurrentWorkers).toBe(4);
    expect(storage.getItem(CONCURRENT_WORKERS_KEY)).toBeNull();
    expect(preferences.theme).toBe('light');
    expect(preferences.fileSort).toBe('name-desc');

    const changedDeployment = new BrowserPreferences(DEFAULT_PREFERENCES_DEFAULTS);

    expect(changedDeployment.refreshIntervalSeconds).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
    expect(changedDeployment.concurrentWorkers).toBe(DEFAULT_CONCURRENT_WORKERS);

    preferences.saveRefreshInterval(30).unwrap();
    preferences.saveConcurrentWorkers(2).unwrap();

    expect(storage.getItem(REFRESH_INTERVAL_KEY)).toBe('30');
    expect(storage.getItem(CONCURRENT_WORKERS_KEY)).toBe('2');
});

test('failed storage removal reports a reset error and preserves persistence for later saves', () => {
    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);
    preferences.saveConcurrentWorkers(16).unwrap();

    const removal = vi.spyOn(storage, 'removeItem').mockImplementationOnce(() => {
        throw new Error('Storage denied');
    });
    const reset = preferences.resetConcurrentWorkers();

    expect(reset.isErr()).toBe(true);
    expect(preferences.concurrentWorkers).toBe(16);

    removal.mockRestore();
    preferences.saveConcurrentWorkers(2).unwrap();

    expect(storage.getItem(CONCURRENT_WORKERS_KEY)).toBe('2');
});

test('reset publishes the schema-validated unset marker before removal for cross-tab subscribers', () => {
    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);
    preferences.saveRefreshInterval(30).unwrap();
    preferences.saveConcurrentWorkers(16).unwrap();

    const writes = vi.spyOn(storage, 'setItem');
    const removal = vi.spyOn(storage, 'removeItem');

    preferences.resetRefreshInterval().unwrap();
    preferences.resetConcurrentWorkers().unwrap();

    expect(writes.mock.calls).toEqual([
        [REFRESH_INTERVAL_KEY, 'null'],
        [CONCURRENT_WORKERS_KEY, 'null']
    ]);
    expect(writes.mock.invocationCallOrder[0]).toBeLessThan(removal.mock.invocationCallOrder[0]);
    expect(writes.mock.invocationCallOrder[1]).toBeLessThan(removal.mock.invocationCallOrder[1]);
    expect(REFRESH_INTERVAL_SERIALIZER.deserialize('null')).toBeNull();
    expect(CONCURRENT_WORKERS_SERIALIZER.deserialize('null')).toBeNull();
    expect(storage.getItem(REFRESH_INTERVAL_KEY)).toBeNull();
    expect(storage.getItem(CONCURRENT_WORKERS_KEY)).toBeNull();
});
