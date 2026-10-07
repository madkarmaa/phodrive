import { watch } from 'runed';
import {
    FileSort,
    FileLayout,
    DEFAULT_FILE_LAYOUT,
    ThemeMode,
    type PreferencesDefaults
} from '#lib/models';
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

    get fileLayout(): FileLayout {
        return this.preferences()?.fileLayout ?? DEFAULT_FILE_LAYOUT;
    }

    set fileLayout(layout: FileLayout) {
        const preferences = this.preferences();
        if (!preferences) {
            this.feedback('Could not save the layout preference in this browser.');

            return;
        }

        preferences.saveFileLayout(layout).match({
            Ok: () => {},
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }

    get concurrentWorkers(): number {
        return this.preferences()?.concurrentWorkers ?? this.defaults.concurrentWorkers;
    }

    get refreshIntervalSeconds(): number {
        return this.preferences()?.refreshIntervalSeconds ?? this.defaults.refreshIntervalSeconds;
    }

    chooseRefreshInterval(seconds: number) {
        const preferences = this.preferences();
        if (!preferences) {
            this.feedback('Could not save preferences in this browser.');

            return;
        }

        preferences.saveRefreshInterval(seconds).match({
            Ok: () => {
                this.feedback('');
            },
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }

    chooseConcurrentWorkers(workers: number) {
        const preferences = this.preferences();
        if (!preferences) {
            this.feedback('Could not save preferences in this browser.');

            return;
        }

        preferences.saveConcurrentWorkers(workers).match({
            Ok: () => {
                this.feedback('');
            },
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }

    resetRefreshInterval() {
        const preferences = this.preferences();
        if (!preferences) {
            this.feedback('Could not reset preferences in this browser.');

            return;
        }

        preferences.resetRefreshInterval().match({
            Ok: () => {
                this.feedback('');
            },
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }

    resetConcurrentWorkers() {
        const preferences = this.preferences();
        if (!preferences) {
            this.feedback('Could not reset preferences in this browser.');

            return;
        }

        preferences.resetConcurrentWorkers().match({
            Ok: () => {
                this.feedback('');
            },
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }

    set fileSort(order: FileSort) {
        const preferences = this.preferences();
        if (!preferences) {
            this.feedback('Could not save the sort preference in this browser.');

            return;
        }

        preferences.saveFileSort(order).match({
            Ok: () => {},
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }

    chooseTheme(mode: ThemeMode) {
        document.documentElement.setAttribute('theme', mode);
        this.themeMode = mode;

        const preferences = this.preferences();
        if (!preferences) {
            this.feedback('Could not save the theme preference in this browser.');

            return;
        }

        preferences.saveTheme(mode).match({
            Ok: () => {
                this.feedback('');
            },
            Err: (error) => {
                this.feedback(error.message);
            }
        });
    }
}
