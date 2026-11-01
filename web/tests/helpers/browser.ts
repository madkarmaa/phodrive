import { ThemeMode } from '@madkarmaa/phodrive-core/models';
import { vi } from 'vitest';

/**
 * Stub the browser globals the drive needs: a tab with in-memory localStorage and a visible
 * document in the automatic theme. Load it from `vi.hoisted`, so the globals exist before the
 * modules under test are imported.
 */
export function stubBrowser() {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, value);
        }
    };
    const tab = Object.assign(new EventTarget(), { localStorage: storage });

    vi.stubGlobal('window', tab);
    vi.stubGlobal('document', {
        hidden: false,
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage, tab };
}
