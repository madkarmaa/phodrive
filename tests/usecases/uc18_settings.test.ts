import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
    DEFAULT_PREFERENCES_DEFAULTS,
    MAX_CONCURRENT_WORKERS,
    MAX_REFRESH_INTERVAL_SECONDS,
    ThemeMode
} from '$lib/models';
import { DriveController } from '$browser/drive/index.svelte';
import {
    BrowserPreferences,
    CONCURRENT_WORKERS_KEY,
    REFRESH_INTERVAL_KEY,
    THEME_KEY
} from '$browser/storage';

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
    vi.stubGlobal('document', {
        hidden: false,
        documentElement: {
            getAttribute: () => null,
            setAttribute: vi.fn()
        }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('controller saves boundary settings and leaves rejected extremes unchanged', () => {
    const controller = new DriveController();
    controller.initialize();

    controller.settings.chooseRefreshInterval(0);
    expect(controller.settings.refreshIntervalSeconds).toBe(0);
    expect(storage.getItem(REFRESH_INTERVAL_KEY)).toBe('0');
    expect(controller.feedbackMessage).toBe('');

    controller.settings.chooseRefreshInterval(MAX_REFRESH_INTERVAL_SECONDS);
    expect(controller.settings.refreshIntervalSeconds).toBe(MAX_REFRESH_INTERVAL_SECONDS);

    controller.settings.chooseConcurrentWorkers(1);
    expect(controller.settings.concurrentWorkers).toBe(1);

    controller.settings.chooseConcurrentWorkers(MAX_CONCURRENT_WORKERS);
    expect(controller.settings.concurrentWorkers).toBe(MAX_CONCURRENT_WORKERS);
    expect(controller.feedbackMessage).toBe('');

    controller.settings.chooseRefreshInterval(MAX_REFRESH_INTERVAL_SECONDS + 1);
    expect(controller.settings.refreshIntervalSeconds).toBe(MAX_REFRESH_INTERVAL_SECONDS);
    expect(controller.feedbackMessage).toMatch(/whole number/);

    controller.settings.chooseConcurrentWorkers(MAX_CONCURRENT_WORKERS + 1);
    expect(controller.settings.concurrentWorkers).toBe(MAX_CONCURRENT_WORKERS);
    expect(controller.feedbackMessage).toMatch(/whole number/);
});

test('controller rejects fractional, NaN, infinite, and blank numeric input without changing saved values', () => {
    const controller = new DriveController();
    controller.initialize();
    controller.settings.chooseRefreshInterval(90);
    controller.settings.chooseConcurrentWorkers(4);

    for (const seconds of [0.5, Number.NaN, Infinity]) {
        controller.settings.chooseRefreshInterval(seconds);
        expect(controller.settings.refreshIntervalSeconds).toBe(90);
        expect(controller.feedbackMessage).not.toBe('');
    }

    // An empty number field is submitted as an empty string; Number('') coerces it to 0.
    controller.settings.chooseRefreshInterval(Number(''));
    expect(controller.settings.refreshIntervalSeconds).toBe(0);
    expect(controller.feedbackMessage).toBe('');

    for (const workers of [1.5, Number.NaN, Infinity]) {
        controller.settings.chooseConcurrentWorkers(workers);
        expect(controller.settings.concurrentWorkers).toBe(4);
        expect(controller.feedbackMessage).not.toBe('');
    }

    controller.settings.chooseConcurrentWorkers(Number(''));
    expect(controller.settings.concurrentWorkers).toBe(4);
    expect(controller.feedbackMessage).not.toBe('');
});

test('reset returns settings to live deployment defaults and preserves other choices', () => {
    const defaults = {
        ...DEFAULT_PREFERENCES_DEFAULTS,
        refreshIntervalSeconds: 300,
        concurrentWorkers: 3
    };
    const controller = new DriveController(defaults);
    controller.initialize();
    controller.settings.chooseRefreshInterval(0);
    controller.settings.chooseConcurrentWorkers(16);

    controller.settings.resetRefreshInterval();
    expect(controller.settings.refreshIntervalSeconds).toBe(300);
    expect(storage.getItem(REFRESH_INTERVAL_KEY)).toBeNull();
    expect(controller.settings.concurrentWorkers).toBe(16);

    controller.settings.resetConcurrentWorkers();
    expect(controller.settings.concurrentWorkers).toBe(3);
    expect(storage.getItem(CONCURRENT_WORKERS_KEY)).toBeNull();
    expect(controller.feedbackMessage).toBe('');
});

test('theme selection updates the page and persists the chosen mode', () => {
    const controller = new DriveController();
    controller.initialize();
    controller.settings.chooseTheme(ThemeMode.Dark);

    expect(controller.settings.themeMode).toBe(ThemeMode.Dark);
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('theme', ThemeMode.Dark);
    expect(storage.getItem(THEME_KEY)).toBe(ThemeMode.Dark);
    expect(controller.feedbackMessage).toBe('');
});

test('storage write failures are reported by settings and theme actions', () => {
    const controller = new DriveController();
    controller.initialize();
    const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {});

    controller.settings.chooseRefreshInterval(120);
    expect(controller.feedbackMessage).toContain('storage');

    controller.settings.chooseTheme(ThemeMode.Light);
    expect(controller.feedbackMessage).toContain('storage');
    expect(controller.settings.themeMode).toBe(ThemeMode.Light);

    setItem.mockRestore();
    const preferences = new BrowserPreferences();
    expect(preferences.refreshIntervalSeconds).toBe(60);
});
