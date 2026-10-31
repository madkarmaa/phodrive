import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { PersistedState } from 'runed';
import { Err, Ok, type Result } from 'results-ts';
import type { z } from 'zod';
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

const STORAGE_UNAVAILABLE = {
    code: 'STORAGE_UNAVAILABLE',
    message: 'Browser storage is unavailable. Enable it to save your preferences.'
} as const satisfies ApplicationError;

/** Runed's default parser logs raw values on malformed JSON, so stored values are parsed here. */
function parseStoredJson(raw: string): Result<unknown, ApplicationError> {
    try {
        const value: unknown = JSON.parse(raw);

        return Ok(value);
    } catch {
        return Err({
            code: 'INVALID_STORED_JSON',
            message: 'Browser storage contains invalid JSON.'
        } as const);
    }
}

function readStoredJson(raw: string): unknown {
    return parseStoredJson(raw).unwrapOr(undefined);
}

/** Enum choices are stored as their raw values; an invalid value falls back to the default. */
function enumSerializer<T extends string>(schema: z.ZodType<T>) {
    return {
        serialize: (value: T | undefined) => value ?? '',
        deserialize: (raw: string): T | undefined => {
            const parsed = schema.safeParse(raw);

            return parsed.success ? parsed.data : undefined;
        }
    };
}

/** Null is a saved reset marker, while undefined means no saved choice. */
function nullableNumberSerializer(schema: z.ZodType<number>) {
    return {
        serialize: (value: number | null | undefined) =>
            value === undefined ? '' : JSON.stringify(value),
        deserialize: (raw: string): number | null | undefined => {
            const parsed = schema.nullable().safeParse(readStoredJson(raw));

            return parsed.success ? parsed.data : undefined;
        }
    };
}

export const THEME_SERIALIZER = enumSerializer(ThemeSchema);
export const FILE_SORT_SERIALIZER = enumSerializer(FileSortSchema);
export const FILE_LAYOUT_SERIALIZER = enumSerializer(FileLayoutSchema);
export const REFRESH_INTERVAL_SERIALIZER = nullableNumberSerializer(RefreshIntervalSchema);
export const CONCURRENT_WORKERS_SERIALIZER = nullableNumberSerializer(ConcurrentWorkersSchema);

function readState<T>(state: PersistedState<T>): Result<T, ApplicationError> {
    try {
        return Ok(state.current);
    } catch {
        return Err(STORAGE_UNAVAILABLE);
    }
}

/** Runed catches write failures internally, so verify persistence before reporting success. */
function writeState<T>(state: PersistedState<T>, value: T): Result<void, ApplicationError> {
    try {
        state.current = value;
    } catch {
        return Err(STORAGE_UNAVAILABLE);
    }

    return readState(state).andThen((saved) =>
        JSON.stringify(saved) === JSON.stringify(value) ? Ok(undefined) : Err(STORAGE_UNAVAILABLE)
    );
}

function resetState<T>(
    state: PersistedState<T | null | undefined>
): Result<void, ApplicationError> {
    return readState(state).andThen((previous) => {
        // Runed ignores removal events. Publish an unset marker so other tabs update too.
        const unset = writeState(state, null);
        if (unset.isErr()) return unset;

        try {
            try {
                state.disconnect();
                state.current = undefined;
            } finally {
                state.connect();
            }
        } catch {
            return writeState(state, previous).andThen(() => Err(STORAGE_UNAVAILABLE));
        }

        return readState(state).andThen((saved) =>
            saved === undefined ? Ok(undefined) : Err(STORAGE_UNAVAILABLE)
        );
    });
}

/** Per-page reactive preferences, with validated data and synchronization across tabs. */
export class BrowserPreferences {
    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {}

    // Runed skips undefined writes, so deployment defaults apply until the user saves a choice.
    private readonly themeState = new PersistedState<ThemeMode | undefined>(THEME_KEY, undefined, {
        serializer: THEME_SERIALIZER
    });
    private readonly fileSortState = new PersistedState<FileSort | undefined>(
        FILE_SORT_KEY,
        undefined,
        {
            serializer: FILE_SORT_SERIALIZER
        }
    );
    private readonly refreshIntervalState = new PersistedState<number | null | undefined>(
        REFRESH_INTERVAL_KEY,
        undefined,
        { serializer: REFRESH_INTERVAL_SERIALIZER }
    );
    private readonly fileLayoutState = new PersistedState<FileLayout | undefined>(
        FILE_LAYOUT_KEY,
        undefined,
        { serializer: FILE_LAYOUT_SERIALIZER }
    );
    private readonly concurrentWorkersState = new PersistedState<number | null | undefined>(
        CONCURRENT_WORKERS_KEY,
        undefined,
        { serializer: CONCURRENT_WORKERS_SERIALIZER }
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
