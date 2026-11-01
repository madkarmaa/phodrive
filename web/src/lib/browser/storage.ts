import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { Err, Ok, type Result } from 'results-ts';
import {
    ConcurrentWorkersSchema,
    DEFAULT_PREFERENCES_DEFAULTS,
    FileSortSchema,
    FileLayoutSchema,
    FileLayout,
    DEFAULT_FILE_LAYOUT,
    MAX_CONCURRENT_WORKERS,
    MAX_REFRESH_INTERVAL_SECONDS,
    RefreshIntervalSchema,
    ThemeSchema,
    FileSort,
    type PreferencesDefaults,
    ThemeMode
} from '@madkarmaa/phodrive-core/models';
import {
    STORAGE_UNAVAILABLE,
    enumSerializer,
    nullableNumberSerializer,
    persistedChoice,
    readState,
    resetState,
    writeState
} from '#browser/persisted-state';

export const THEME_KEY = 'phodrive-theme';
export const FILE_SORT_KEY = 'phodrive-sort';
export const FILE_LAYOUT_KEY = 'phodrive-layout';
export const REFRESH_INTERVAL_KEY = 'phodrive-refresh-interval';
export const CONCURRENT_WORKERS_KEY = 'phodrive-concurrent-workers';
/** Earlier versions kept Google accounts and their tokens here; the server holds them now. */
export const LEGACY_CREDENTIAL_KEYS = ['accounts', 'selectedAccount'] as const;
export const NEXT_THEME: Record<ThemeMode, ThemeMode> = {
    [ThemeMode.Auto]: ThemeMode.Light,
    [ThemeMode.Light]: ThemeMode.Dark,
    [ThemeMode.Dark]: ThemeMode.Auto
};

export const THEME_SERIALIZER = enumSerializer(ThemeSchema);
export const FILE_SORT_SERIALIZER = enumSerializer(FileSortSchema);
export const FILE_LAYOUT_SERIALIZER = enumSerializer(FileLayoutSchema);
export const REFRESH_INTERVAL_SERIALIZER = nullableNumberSerializer(RefreshIntervalSchema);
export const CONCURRENT_WORKERS_SERIALIZER = nullableNumberSerializer(ConcurrentWorkersSchema);

/** Per-page reactive preferences, with validated data and synchronization across tabs. */
export class BrowserPreferences {
    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {}

    // Runed skips undefined writes, so deployment defaults apply until the user saves a choice.
    private readonly themeState = persistedChoice(THEME_KEY, THEME_SERIALIZER);
    private readonly fileSortState = persistedChoice(FILE_SORT_KEY, FILE_SORT_SERIALIZER);
    private readonly refreshIntervalState = persistedChoice(
        REFRESH_INTERVAL_KEY,
        REFRESH_INTERVAL_SERIALIZER
    );
    private readonly fileLayoutState = persistedChoice(FILE_LAYOUT_KEY, FILE_LAYOUT_SERIALIZER);
    private readonly concurrentWorkersState = persistedChoice(
        CONCURRENT_WORKERS_KEY,
        CONCURRENT_WORKERS_SERIALIZER
    );

    get theme(): ThemeMode {
        return readState(this.themeState).unwrapOr(undefined) ?? this.defaults.theme;
    }

    get fileSort(): FileSort {
        return readState(this.fileSortState).unwrapOr(undefined) ?? this.defaults.fileSort;
    }

    get fileLayout(): FileLayout {
        return readState(this.fileLayoutState).unwrapOr(undefined) ?? DEFAULT_FILE_LAYOUT;
    }

    get refreshIntervalSeconds(): number {
        return (
            readState(this.refreshIntervalState).unwrapOr(undefined) ??
            this.defaults.refreshIntervalSeconds
        );
    }

    get concurrentWorkers(): number {
        return (
            readState(this.concurrentWorkersState).unwrapOr(undefined) ??
            this.defaults.concurrentWorkers
        );
    }

    saveTheme(mode: ThemeMode): Result<void, ApplicationError> {
        return writeState(this.themeState, mode);
    }

    saveFileSort(order: FileSort): Result<void, ApplicationError> {
        return writeState(this.fileSortState, order);
    }

    saveFileLayout(layout: FileLayout): Result<void, ApplicationError> {
        return writeState(this.fileLayoutState, layout);
    }

    saveRefreshInterval(seconds: number): Result<void, ApplicationError> {
        const parsed = RefreshIntervalSchema.safeParse(seconds);
        if (!parsed.success) {
            return Err({
                code: 'INVALID_REFRESH_INTERVAL',
                message: `Refresh interval must be a whole number from 0 to ${MAX_REFRESH_INTERVAL_SECONDS} seconds.`
            } as const);
        }

        return writeState(this.refreshIntervalState, parsed.data);
    }

    saveConcurrentWorkers(workers: number): Result<void, ApplicationError> {
        const parsed = ConcurrentWorkersSchema.safeParse(workers);
        if (!parsed.success) {
            return Err({
                code: 'INVALID_CONCURRENT_WORKERS',
                message: `Concurrent workers must be a whole number from 1 to ${MAX_CONCURRENT_WORKERS}.`
            } as const);
        }

        return writeState(this.concurrentWorkersState, parsed.data);
    }

    resetRefreshInterval(): Result<void, ApplicationError> {
        return resetState(this.refreshIntervalState);
    }

    resetConcurrentWorkers(): Result<void, ApplicationError> {
        return resetState(this.concurrentWorkersState);
    }
}

/** Delete tokens an earlier version left in this browser; they are not carried over. */
export function removeLegacyCredentials(): Result<void, ApplicationError> {
    try {
        for (const key of LEGACY_CREDENTIAL_KEYS) window.localStorage.removeItem(key);
    } catch {
        return Err(STORAGE_UNAVAILABLE);
    }

    return Ok(undefined);
}

export function createBrowserPreferences(
    defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS
): Result<BrowserPreferences, ApplicationError> {
    let preferences: BrowserPreferences;

    try {
        preferences = new BrowserPreferences(defaults);
    } catch {
        return Err(STORAGE_UNAVAILABLE);
    }

    return Ok(preferences);
}
