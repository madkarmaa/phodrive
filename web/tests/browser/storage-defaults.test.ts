import {
    FileSort,
    ThemeMode,
    DEFAULT_CONCURRENT_WORKERS,
    DEFAULT_FILE_SORT,
    DEFAULT_REFRESH_INTERVAL_SECONDS,
    DEFAULT_PREFERENCES_DEFAULTS,
    MAX_CONCURRENT_WORKERS,
    MAX_REFRESH_INTERVAL_SECONDS,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { afterAll, afterEach, beforeEach, expect, vi, test } from 'vitest';
import {
    BrowserPreferences,
    CONCURRENT_WORKERS_KEY,
    CONCURRENT_WORKERS_SERIALIZER,
    FILE_SORT_KEY,
    REFRESH_INTERVAL_SERIALIZER,
    REFRESH_INTERVAL_KEY,
    THEME_KEY
} from '#browser/storage';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

const DEPLOYMENT_DEFAULTS: PreferencesDefaults = {
    theme: ThemeMode.Dark,
    fileSort: FileSort.NameAscending,
    refreshIntervalSeconds: 120,
    concurrentWorkers: 4
};

test('absent browser choices use deployment defaults without seeding local storage', () => {
    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);

    expect(preferences.theme).toBe(ThemeMode.Dark);
    expect(preferences.fileSort).toBe(FileSort.NameAscending);
    expect(preferences.refreshIntervalSeconds).toBe(120);
    expect(preferences.concurrentWorkers).toBe(4);

    for (const key of [THEME_KEY, FILE_SORT_KEY, REFRESH_INTERVAL_KEY, CONCURRENT_WORKERS_KEY]) {
        expect(storage.getItem(key)).toBeNull();
    }

    const changedDeployment = new BrowserPreferences(DEFAULT_PREFERENCES_DEFAULTS);

    expect(changedDeployment.theme).toBe(ThemeMode.Auto);
    expect(changedDeployment.fileSort).toBe(DEFAULT_FILE_SORT);
    expect(changedDeployment.refreshIntervalSeconds).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
    expect(changedDeployment.concurrentWorkers).toBe(DEFAULT_CONCURRENT_WORKERS);
});

test('explicit saved browser choices override deployment defaults, including zero refresh and auto theme', () => {
    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);

    expect(preferences.saveTheme(ThemeMode.Auto).isOk()).toBe(true);
    expect(preferences.saveFileSort(FileSort.ModifiedAscending).isOk()).toBe(true);
    expect(preferences.saveRefreshInterval(0).isOk()).toBe(true);
    expect(preferences.saveConcurrentWorkers(16).isOk()).toBe(true);

    const reloaded = new BrowserPreferences({
        theme: ThemeMode.Light,
        fileSort: FileSort.NameDescending,
        refreshIntervalSeconds: 30,
        concurrentWorkers: 2
    });

    expect(reloaded.theme).toBe(ThemeMode.Auto);
    expect(reloaded.fileSort).toBe(FileSort.ModifiedAscending);
    expect(reloaded.refreshIntervalSeconds).toBe(0);
    expect(reloaded.concurrentWorkers).toBe(16);
});

test('invalid stored choices use deployment defaults without rewriting the stored data', () => {
    storage.setItem(THEME_KEY, 'invalid');
    storage.setItem(FILE_SORT_KEY, 'invalid');
    storage.setItem(REFRESH_INTERVAL_KEY, '"60"');
    storage.setItem(CONCURRENT_WORKERS_KEY, '33');

    const preferences = new BrowserPreferences(DEPLOYMENT_DEFAULTS);

    expect(preferences.theme).toBe(ThemeMode.Dark);
    expect(preferences.fileSort).toBe(FileSort.NameAscending);
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

    preferences.saveTheme(ThemeMode.Light).unwrap();
    preferences.saveFileSort(FileSort.NameDescending).unwrap();
    preferences.saveRefreshInterval(0).unwrap();
    preferences.saveConcurrentWorkers(16).unwrap();

    preferences.resetRefreshInterval().unwrap();

    expect(preferences.refreshIntervalSeconds).toBe(120);
    expect(storage.getItem(REFRESH_INTERVAL_KEY)).toBeNull();
    expect(preferences.concurrentWorkers).toBe(16);

    preferences.resetConcurrentWorkers().unwrap();

    expect(preferences.concurrentWorkers).toBe(4);
    expect(storage.getItem(CONCURRENT_WORKERS_KEY)).toBeNull();
    expect(preferences.theme).toBe(ThemeMode.Light);
    expect(preferences.fileSort).toBe(FileSort.NameDescending);

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
