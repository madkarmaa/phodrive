import { watch } from 'runed';
import {
    FileSort,
    FileLayout,
    DEFAULT_FILE_LAYOUT,
    ThemeMode,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { Result } from 'results-ts';
import type { BrowserPreferences } from '#browser/storage';

/** User-facing preference changes and their immediate theme preview. */
export class DriveSettings {
    themeMode = $state<ThemeMode>(ThemeMode.Auto);

    constructor(
        private readonly preferences: () => BrowserPreferences | null,
        private readonly defaults: PreferencesDefaults,
        private readonly feedback: (message: string) => void
    ) {
        this.themeMode = defaults.theme;

        watch(
            () => this.preferences()?.theme,
            (mode) => {
                if (!mode) return;

                this.themeMode = mode;
                document.documentElement.setAttribute('theme', mode);
            }
        );
    }

    get fileSort(): FileSort {
        return this.preferences()?.fileSort ?? this.defaults.fileSort;
    }

    set fileSort(order: FileSort) {
        this.persist(
            'Could not save the sort preference in this browser.',
            (preferences) => preferences.saveFileSort(order),
            false
        );
    }

    get fileLayout(): FileLayout {
        return this.preferences()?.fileLayout ?? DEFAULT_FILE_LAYOUT;
    }

    set fileLayout(layout: FileLayout) {
        this.persist(
            'Could not save the layout preference in this browser.',
            (preferences) => preferences.saveFileLayout(layout),
            false
        );
    }

    get concurrentWorkers(): number {
        return this.preferences()?.concurrentWorkers ?? this.defaults.concurrentWorkers;
    }

    get refreshIntervalSeconds(): number {
        return this.preferences()?.refreshIntervalSeconds ?? this.defaults.refreshIntervalSeconds;
    }

    chooseRefreshInterval(seconds: number) {
        this.persist('Could not save preferences in this browser.', (preferences) =>
            preferences.saveRefreshInterval(seconds)
        );
    }

    chooseConcurrentWorkers(workers: number) {
        this.persist('Could not save preferences in this browser.', (preferences) =>
            preferences.saveConcurrentWorkers(workers)
        );
    }

    resetRefreshInterval() {
        this.persist('Could not reset preferences in this browser.', (preferences) =>
            preferences.resetRefreshInterval()
        );
    }

    resetConcurrentWorkers() {
        this.persist('Could not reset preferences in this browser.', (preferences) =>
            preferences.resetConcurrentWorkers()
        );
    }

    chooseTheme(mode: ThemeMode) {
        document.documentElement.setAttribute('theme', mode);
        this.themeMode = mode;

        this.persist('Could not save the theme preference in this browser.', (preferences) =>
            preferences.saveTheme(mode)
        );
    }

    /** Report an unavailable store or failed save; successful saves may dismiss old feedback. */
    private persist(
        unavailableMessage: string,
        save: (preferences: BrowserPreferences) => Result<void, ApplicationError>,
        clearFeedback = true
    ) {
        const preferences = this.preferences();
        if (!preferences) {
            this.feedback(unavailableMessage);

            return;
        }

        save(preferences).match({
            Ok: () => {
                if (clearFeedback) this.feedback('');
            },
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }
}
