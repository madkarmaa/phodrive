import { env } from '$env/dynamic/private';
import {
    ConcurrentWorkersSchema,
    DEFAULT_PREFERENCES_DEFAULTS,
    FileSortSchema,
    RefreshIntervalSchema,
    ThemeSchema,
    type PreferencesDefaults
} from '$lib/models';

/** Blank deployment values are absent, rather than Number('') becoming an explicit zero. */
function environmentNumber(value: string | undefined): number | undefined {
    if (!value?.trim()) return undefined;

    return Number(value);
}

/** Read only public preference configuration, never enumerate the private environment. */
export function parsePreferencesDefaults(
    environment: Record<string, string | undefined>
): PreferencesDefaults {
    const theme = ThemeSchema.safeParse(environment.PHODRIVE_DEFAULT_THEME);
    const fileSort = FileSortSchema.safeParse(environment.PHODRIVE_DEFAULT_SORT);
    const refreshInterval = RefreshIntervalSchema.safeParse(
        environmentNumber(environment.PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS)
    );
    const concurrentWorkers = ConcurrentWorkersSchema.safeParse(
        environmentNumber(environment.PHODRIVE_DEFAULT_CONCURRENT_WORKERS)
    );

    return {
        theme: theme.success ? theme.data : DEFAULT_PREFERENCES_DEFAULTS.theme,
        fileSort: fileSort.success ? fileSort.data : DEFAULT_PREFERENCES_DEFAULTS.fileSort,
        refreshIntervalSeconds: refreshInterval.success
            ? refreshInterval.data
            : DEFAULT_PREFERENCES_DEFAULTS.refreshIntervalSeconds,
        concurrentWorkers: concurrentWorkers.success
            ? concurrentWorkers.data
            : DEFAULT_PREFERENCES_DEFAULTS.concurrentWorkers
    };
}

export function readPreferencesDefaults(): PreferencesDefaults {
    return parsePreferencesDefaults({
        PHODRIVE_DEFAULT_THEME: env.PHODRIVE_DEFAULT_THEME,
        PHODRIVE_DEFAULT_SORT: env.PHODRIVE_DEFAULT_SORT,
        PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: env.PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS,
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: env.PHODRIVE_DEFAULT_CONCURRENT_WORKERS
    });
}
