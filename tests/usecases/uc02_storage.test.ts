import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ThemeMode } from '#lib/models';
import { BrowserPreferences, THEME_KEY } from '#browser/storage';

const { storage } = vi.hoisted(() => {
    class MemoryStorage implements Storage {
        private readonly values = new Map<string, string>();
        get length(): number {
            return this.values.size;
        }
        key(index: number): string | null {
            return [...this.values.keys()][index] ?? null;
        }
        getItem(key: string): string | null {
            return this.values.get(key) ?? null;
        }
        setItem(key: string, value: string): void {
            this.values.set(key, value);
        }
        removeItem(key: string): void {
            this.values.delete(key);
        }
        clear(): void {
            this.values.clear();
        }
    }

    const storage = new MemoryStorage();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());

test('a quota failure returns a generic storage error and allows a later successful save', () => {
    const preferences = new BrowserPreferences();
    const failingWrite = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('fake secret quota detail', 'QuotaExceededError');
    });

    const failed = preferences.saveTheme(ThemeMode.Dark);
    const error = failed.match({ Ok: () => '', Err: (reason) => reason.message });

    expect(failed.isErr()).toBe(true);
    expect(error).toContain('Browser storage is unavailable');
    expect(error).not.toContain('fake secret');
    expect(preferences.saveTheme(ThemeMode.Dark).isOk()).toBe(true);
    expect(storage.getItem(THEME_KEY)).toBe(ThemeMode.Dark);
    failingWrite.mockRestore();
});

test('a denied storage read uses safe defaults and later writes recover after access returns', () => {
    storage.setItem(THEME_KEY, ThemeMode.Light);
    const preferences = new BrowserPreferences();
    const failingRead = vi.spyOn(storage, 'getItem').mockImplementationOnce(() => {
        throw new DOMException('fake token read detail', 'SecurityError');
    });

    expect(preferences.theme).toBe(ThemeMode.Auto);
    expect(preferences.saveTheme(ThemeMode.Dark).isOk()).toBe(true);
    expect(preferences.theme).toBe(ThemeMode.Dark);
    expect(failingRead).toHaveBeenCalled();
});
