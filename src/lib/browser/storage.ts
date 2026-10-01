import { PersistedState } from 'runed';
import { Err, Ok, type Result } from 'results-ts';
import {
    AccountSchema,
    ConcurrentWorkersSchema,
    DEFAULT_PREFERENCES_DEFAULTS,
    FileSortSchema,
    MAX_CONCURRENT_WORKERS,
    MAX_REFRESH_INTERVAL_SECONDS,
    RefreshIntervalSchema,
    SelectedAccountSchema,
    StoredAccountsSchema,
    ThemeSchema,
    FileSort,
    type PreferencesDefaults,
    ThemeMode
} from '$lib/models';

export const ACCOUNTS_KEY = 'accounts';
export const SELECTED_KEY = 'selectedAccount';
export const THEME_KEY = 'phodrive-theme';
export const FILE_SORT_KEY = 'phodrive-sort';
export const REFRESH_INTERVAL_KEY = 'phodrive-refresh-interval';
export const CONCURRENT_WORKERS_KEY = 'phodrive-concurrent-workers';
export const NEXT_THEME: Record<ThemeMode, ThemeMode> = {
    [ThemeMode.Auto]: ThemeMode.Light,
    [ThemeMode.Light]: ThemeMode.Dark,
    [ThemeMode.Dark]: ThemeMode.Auto
};

type Accounts = Record<string, string>;
const STORAGE_ERROR = 'Browser storage is unavailable. Enable it to save your preferences.';

/** Handle malformed JSON here: Runed's default parser logs the raw stored value. */
function parseStoredJson(raw: string): Result<unknown, Error> {
    try {
        const value: unknown = JSON.parse(raw);
        return Ok(value);
    } catch {
        return Err(new Error('Browser storage contains invalid JSON.'));
    }
}

export const ACCOUNTS_SERIALIZER = {
    serialize: (accounts: Accounts) => JSON.stringify(accounts),
    deserialize: (raw: string): Accounts => {
        const value = parseStoredJson(raw).match({ Ok: (stored) => stored, Err: () => undefined });
        const parsed = StoredAccountsSchema.safeParse(value);
        if (!parsed.success) return {};

        const valid: Accounts = {};
        for (const [email, token] of Object.entries(parsed.data)) {
            const account = AccountSchema.safeParse({ email, token });
            if (!account.success) continue;

            valid[account.data.email] = account.data.token;
        }

        return valid;
    }
};

export const THEME_SERIALIZER = {
    serialize: (mode: ThemeMode | undefined) => mode ?? '',
    deserialize: (raw: string): ThemeMode | undefined => {
        const parsed = ThemeSchema.safeParse(raw);

        return parsed.success ? parsed.data : undefined;
    }
};

export const FILE_SORT_SERIALIZER = {
    serialize: (order: FileSort | undefined) => order ?? '',
    deserialize: (raw: string): FileSort | undefined => {
        const parsed = FileSortSchema.safeParse(raw);

        return parsed.success ? parsed.data : undefined;
    }
};

export const REFRESH_INTERVAL_SERIALIZER = {
    serialize: (seconds: number | null | undefined) =>
        seconds === undefined ? '' : JSON.stringify(seconds),
    deserialize: (raw: string): number | null | undefined => {
        const value = parseStoredJson(raw).match({ Ok: (stored) => stored, Err: () => undefined });
        const parsed = RefreshIntervalSchema.nullable().safeParse(value);

        return parsed.success ? parsed.data : undefined;
    }
};

export const CONCURRENT_WORKERS_SERIALIZER = {
    serialize: (workers: number | null | undefined) =>
        workers === undefined ? '' : JSON.stringify(workers),
    deserialize: (raw: string): number | null | undefined => {
        const value = parseStoredJson(raw).match({ Ok: (stored) => stored, Err: () => undefined });
        const parsed = ConcurrentWorkersSchema.nullable().safeParse(value);

        return parsed.success ? parsed.data : undefined;
    }
};

/** JSON keeps the empty selection nonempty in storage, so Runed reads it as the source of truth. */
export const SELECTED_ACCOUNT_SERIALIZER = {
    serialize: (email: string) => JSON.stringify(email),
    deserialize: (raw: string): string => {
        const value = parseStoredJson(raw).match({ Ok: (stored) => stored, Err: () => undefined });
        const parsed = SelectedAccountSchema.safeParse(value);

        return parsed.success ? parsed.data : '';
    }
};

function readState<T>(state: PersistedState<T>): Result<T, Error> {
    try {
        return Ok(state.current);
    } catch {
        return Err(new Error(STORAGE_ERROR));
    }
}

/** Runed catches write failures internally, so verify persistence before reporting success. */
function writeState<T>(state: PersistedState<T>, value: T): Result<void, Error> {
    try {
        state.current = value;
    } catch {
        return Err(new Error(STORAGE_ERROR));
    }

    return readState(state).andThen((saved) =>
        JSON.stringify(saved) === JSON.stringify(value)
            ? Ok(undefined)
            : Err(new Error(STORAGE_ERROR))
    );
}

function resetState<T>(state: PersistedState<T | null | undefined>): Result<void, Error> {
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
            return writeState(state, previous).andThen(() => Err(new Error(STORAGE_ERROR)));
        }

        return readState(state).andThen((saved) =>
            saved === undefined ? Ok(undefined) : Err(new Error(STORAGE_ERROR))
        );
    });
}

/** Per-page reactive preferences, with validated data and synchronization across tabs. */
export class BrowserPreferences {
    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {}

    private readonly accountsState = new PersistedState<Accounts>(
        ACCOUNTS_KEY,
        {},
        {
            serializer: ACCOUNTS_SERIALIZER
        }
    );
    private readonly selectedState = new PersistedState(SELECTED_KEY, '', {
        serializer: SELECTED_ACCOUNT_SERIALIZER
    });
    // Runed skips undefined writes, keeping deployment defaults free to change until a user chooses.
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
    private readonly concurrentWorkersState = new PersistedState<number | null | undefined>(
        CONCURRENT_WORKERS_KEY,
        undefined,
        { serializer: CONCURRENT_WORKERS_SERIALIZER }
    );

    get accounts(): Accounts {
        return readState(this.accountsState).match({ Ok: (value) => value, Err: () => ({}) });
    }

    get selectedEmail(): string {
        const preferred = readState(this.selectedState).match({
            Ok: (value) => value,
            Err: () => ''
        });
        const accounts = this.accounts;
        return Object.hasOwn(accounts, preferred) ? preferred : (Object.keys(accounts)[0] ?? '');
    }

    get theme(): ThemeMode {
        return readState(this.themeState).match({
            Ok: (value) => value ?? this.defaults.theme,
            Err: () => this.defaults.theme
        });
    }

    get fileSort(): FileSort {
        return readState(this.fileSortState).match({
            Ok: (value) => value ?? this.defaults.fileSort,
            Err: () => this.defaults.fileSort
        });
    }

    get refreshIntervalSeconds(): number {
        return readState(this.refreshIntervalState).match({
            Ok: (value) => value ?? this.defaults.refreshIntervalSeconds,
            Err: () => this.defaults.refreshIntervalSeconds
        });
    }

    get concurrentWorkers(): number {
        return readState(this.concurrentWorkersState).match({
            Ok: (value) => value ?? this.defaults.concurrentWorkers,
            Err: () => this.defaults.concurrentWorkers
        });
    }

    saveAccounts(accounts: Accounts, selected: string): Result<void, Error> {
        return writeState(this.accountsState, accounts).andThen(() =>
            writeState(this.selectedState, selected)
        );
    }

    selectAccount(email: string): Result<void, Error> {
        return writeState(this.selectedState, email);
    }

    saveTheme(mode: ThemeMode): Result<void, Error> {
        return writeState(this.themeState, mode);
    }

    saveFileSort(order: FileSort): Result<void, Error> {
        return writeState(this.fileSortState, order);
    }

    saveRefreshInterval(seconds: number): Result<void, Error> {
        const parsed = RefreshIntervalSchema.safeParse(seconds);
        if (!parsed.success) {
            return Err(
                new Error(
                    `Refresh interval must be a whole number from 0 to ${MAX_REFRESH_INTERVAL_SECONDS} seconds.`
                )
            );
        }

        return writeState(this.refreshIntervalState, parsed.data);
    }

    saveConcurrentWorkers(workers: number): Result<void, Error> {
        const parsed = ConcurrentWorkersSchema.safeParse(workers);
        if (!parsed.success) {
            return Err(
                new Error(
                    `Concurrent workers must be a whole number from 1 to ${MAX_CONCURRENT_WORKERS}.`
                )
            );
        }

        return writeState(this.concurrentWorkersState, parsed.data);
    }

    resetRefreshInterval(): Result<void, Error> {
        return resetState(this.refreshIntervalState);
    }

    resetConcurrentWorkers(): Result<void, Error> {
        return resetState(this.concurrentWorkersState);
    }
}

export function createBrowserPreferences(
    defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS
): Result<BrowserPreferences, Error> {
    let preferences: BrowserPreferences;
    try {
        preferences = new BrowserPreferences(defaults);
    } catch {
        return Err(new Error(STORAGE_ERROR));
    }

    return Ok(preferences);
}
