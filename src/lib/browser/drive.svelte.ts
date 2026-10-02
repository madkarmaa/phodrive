import {
    ConfirmKind,
    FileActionKind,
    UploadJobStatus,
    DEFAULT_PREFERENCES_DEFAULTS,
    NewAccountSchema,
    ThemeSchema,
    FileSort,
    type PreferencesDefaults,
    ThemeMode
} from '$lib/models';
import { watch } from 'runed';
import {
    groupChunks,
    fileKey,
    sortFiles,
    fileType,
    type FileGroup,
    type FileAction,
    type UploadedChunk
} from '$lib/file-groups';
import { readLibraryPage, readLibrarySnapshot } from '$browser/library';
import { useAutomaticRefresh } from '$browser/automatic-refresh.svelte';
import { validateAccount } from '$browser/accounts';
import { createBrowserPreferences, type BrowserPreferences } from '$browser/storage';
import {
    createUploadJobs,
    uploadFiles,
    downloadFile,
    deleteFile,
    type UploadJob
} from '$browser/files';

export type ConfirmTarget =
    { kind: ConfirmKind.Account; email: string } | { kind: ConfirmKind.File; item: FileGroup };

export class DriveController {
    private preferences = $state.raw<BrowserPreferences | null>(null);
    uploads = $state<UploadedChunk[]>([]);
    nextPageToken = $state('');
    libraryLoading = $state(false);
    private libraryRequest = 0;
    private loadedPages = 0;
    private libraryPageTokens = new Set<string>();
    private accountReloadPending = false;
    adding = $state(false);
    newEmail = $state('');
    newToken = $state('');
    connecting = $state(false);
    ready = $state(false);
    busy = $state(false);
    uploadPanelOpen = $state(false);
    uploadJobs = $state<UploadJob[]>([]);
    private uploadSources: readonly File[] = [];
    message = $state('');
    galleryMessage = $state('');
    fileAction = $state<FileAction | null>(null);
    searchTerm = $state('');
    typeFilter = $state('');
    modifiedDays = $state('');
    accountMenuOpen = $state(false);
    themeMode = $state<ThemeMode>(ThemeMode.Auto);
    themeError = $state('');
    settingsError = $state('');
    confirmOpen = $state(false);
    confirmTarget = $state<ConfirmTarget | null>(null);
    files = $derived(groupChunks(this.uploads));
    availableTypes = $derived([...new Set(this.files.map((item) => fileType(item.name)))].sort());
    visibleUploads = $derived(
        sortFiles(
            this.files.filter(
                (item) =>
                    item.name.toLocaleLowerCase().includes(this.searchTerm.toLocaleLowerCase()) &&
                    (!this.typeFilter || fileType(item.name) === this.typeFilter) &&
                    (!this.modifiedDays ||
                        item.at >= Date.now() - Number(this.modifiedDays) * 86_400_000)
            ),
            this.fileSort
        )
    );

    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {
        this.themeMode = defaults.theme;

        watch(
            () => this.preferences?.theme,
            (mode) => {
                if (!mode) return;
                this.themeMode = mode;
                document.documentElement.setAttribute('theme', mode);
            }
        );

        watch(
            [() => this.selectedEmail, () => this.accounts[this.selectedEmail]],
            ([email, token], [previousEmail, previousToken]) => {
                if (!this.ready || (email === previousEmail && token === previousToken)) return;
                this.resetAccountView();
            }
        );

        useAutomaticRefresh(
            () => this.refreshIntervalSeconds,
            () =>
                this.ready &&
                !!this.selectedEmail &&
                !this.busy &&
                !this.fileAction &&
                !this.libraryLoading,
            () => this.refreshFiles()
        );
    }

    get accounts() {
        return this.preferences?.accounts ?? {};
    }

    get selectedEmail() {
        return this.preferences?.selectedEmail ?? '';
    }

    get fileSort(): FileSort {
        return this.preferences?.fileSort ?? this.defaults.fileSort;
    }

    get concurrentWorkers(): number {
        return this.preferences?.concurrentWorkers ?? this.defaults.concurrentWorkers;
    }

    get refreshIntervalSeconds(): number {
        return this.preferences?.refreshIntervalSeconds ?? this.defaults.refreshIntervalSeconds;
    }

    chooseRefreshInterval(seconds: number) {
        const preferences = this.preferences;
        if (!preferences) {
            this.settingsError = 'Could not save preferences in this browser.';
            return;
        }

        preferences.saveRefreshInterval(seconds).match({
            Ok: () => {
                this.settingsError = '';
            },
            Err: (error) => {
                this.settingsError = error.message;
            }
        });
    }

    chooseConcurrentWorkers(workers: number) {
        const preferences = this.preferences;
        if (!preferences) {
            this.settingsError = 'Could not save preferences in this browser.';
            return;
        }

        preferences.saveConcurrentWorkers(workers).match({
            Ok: () => {
                this.settingsError = '';
            },
            Err: (error) => {
                this.settingsError = error.message;
            }
        });
    }

    resetRefreshInterval() {
        const preferences = this.preferences;
        if (!preferences) {
            this.settingsError = 'Could not reset preferences in this browser.';
            return;
        }

        preferences.resetRefreshInterval().match({
            Ok: () => {
                this.settingsError = '';
            },
            Err: (error) => {
                this.settingsError = error.message;
            }
        });
    }

    resetConcurrentWorkers() {
        const preferences = this.preferences;
        if (!preferences) {
            this.settingsError = 'Could not reset preferences in this browser.';
            return;
        }

        preferences.resetConcurrentWorkers().match({
            Ok: () => {
                this.settingsError = '';
            },
            Err: (error) => {
                this.settingsError = error.message;
            }
        });
    }

    set fileSort(order: FileSort) {
        const preferences = this.preferences;
        if (!preferences) {
            this.galleryMessage = 'Could not save the sort preference in this browser.';
            return;
        }

        preferences.saveFileSort(order).match({
            Ok: () => {},
            Err: (error) => {
                this.galleryMessage = error.message;
            }
        });
    }

    chooseTheme(mode: ThemeMode) {
        document.documentElement.setAttribute('theme', mode);
        this.themeMode = mode;

        if (!this.preferences) {
            this.themeError = 'Could not save the theme preference in this browser.';
            return;
        }

        this.preferences.saveTheme(mode).match({
            Ok: () => {
                this.themeError = '';
            },
            Err: (error) => {
                this.themeError = error.message;
            }
        });
    }

    initialize() {
        const parsedTheme = ThemeSchema.safeParse(document.documentElement.getAttribute('theme'));
        if (parsedTheme.success) this.themeMode = parsedTheme.data;

        createBrowserPreferences(this.defaults).match({
            Ok: (preferences) => {
                this.preferences = preferences;
            },
            Err: (error) => {
                this.message = error.message;
            }
        });

        this.ready = true;
    }

    async loadFiles(reset = true) {
        if (
            this.busy ||
            this.fileAction ||
            (!reset && (this.libraryLoading || !this.nextPageToken))
        )
            return;

        const email = this.selectedEmail;
        const token = this.accounts[email];
        const pageToken = reset ? '' : this.nextPageToken;
        const request = ++this.libraryRequest;
        if (reset) {
            this.uploads = [];
            this.nextPageToken = '';
            this.loadedPages = 0;
            this.libraryPageTokens.clear();
        }

        if (!email || !token) {
            this.libraryLoading = false;
            return;
        }

        this.libraryLoading = true;
        this.galleryMessage = '';

        const loaded = await readLibraryPage(email, token, pageToken);

        if (request !== this.libraryRequest || email !== this.selectedEmail) return;

        loaded.match({
            Ok: (data) => {
                const found: UploadedChunk[] = data.items.map((item) => ({
                    ...item,
                    email
                }));
                const chunks = reset ? found : [...this.uploads, ...found];
                this.uploads = [
                    ...new Map(
                        chunks.map((item) => [`${item.email}:${item.mediaKey}`, item])
                    ).values()
                ];
                this.nextPageToken = data.nextPageToken;
                if (data.nextPageToken && this.libraryPageTokens.has(data.nextPageToken)) {
                    this.nextPageToken = '';
                    this.galleryMessage =
                        'Google Photos repeated a library page. Refresh to try again.';
                }
                if (this.nextPageToken) this.libraryPageTokens.add(this.nextPageToken);
                this.loadedPages++;
            },
            Err: (error) => {
                this.galleryMessage = error.message;
            }
        });
        this.libraryLoading = false;
    }

    async refreshFiles() {
        if (this.busy || this.fileAction || this.libraryLoading || document.hidden) return;

        const email = this.selectedEmail;
        const token = this.accounts[email];
        if (!email || !token) return;

        const request = ++this.libraryRequest;
        this.libraryLoading = true;

        const refreshed = await readLibrarySnapshot(email, token, this.loadedPages);
        if (request !== this.libraryRequest || email !== this.selectedEmail) return;

        refreshed.match({
            Ok: (snapshot) => {
                this.uploads = snapshot.items.map((item) => ({ ...item, email }));
                this.nextPageToken = snapshot.nextPageToken;
                this.loadedPages = snapshot.pages;
                this.libraryPageTokens.clear();
                if (snapshot.nextPageToken) this.libraryPageTokens.add(snapshot.nextPageToken);
                this.galleryMessage = '';
            },
            Err: (error) => {
                this.galleryMessage = error.message;
            }
        });

        this.libraryLoading = false;
    }

    async saveAccount() {
        if (this.connecting || this.busy || this.fileAction) return;
        const preferences = this.preferences;
        if (!preferences) {
            this.message = 'Browser storage is unavailable. Enable it to save your credentials.';
            return;
        }
        this.newEmail = this.newEmail.trim();
        this.newToken = this.newToken.trim();

        if (!NewAccountSchema.safeParse({ email: this.newEmail, token: this.newToken }).success) {
            this.message = 'Enter your Google account email and an OAuth2 or AAS token.';
            return;
        }

        this.connecting = true;
        this.message = '';
        const email = this.newEmail;
        const inputToken = this.newToken;
        const verified = await validateAccount(email, inputToken);

        this.connecting = false;
        const token = verified.match({
            Ok: (value) => value,
            Err: (error) => {
                this.message = error.message;
                return null;
            }
        });
        if (token === null) return;

        const updated = { ...this.accounts, [email]: token };
        const saved = preferences.saveAccounts(updated, email);
        saved.match({
            Ok: () => {
                this.newEmail = '';
                this.newToken = '';
                this.adding = false;
            },
            Err: (error) => {
                this.message = error.message;
            }
        });
    }

    private resetAccountView() {
        this.confirmOpen = false;
        this.confirmTarget = null;
        this.searchTerm = '';
        this.typeFilter = '';
        this.modifiedDays = '';
        this.uploads = [];
        this.nextPageToken = '';
        this.loadedPages = 0;
        this.libraryPageTokens.clear();
        this.libraryRequest++;
        this.libraryLoading = false;

        if (this.busy || this.fileAction) {
            this.accountReloadPending = true;
            return;
        }

        this.accountReloadPending = false;
        this.uploadJobs = [];
        this.uploadSources = [];
        this.uploadPanelOpen = false;
        this.message = '';
        this.galleryMessage = '';
        void this.loadFiles();
    }

    private reloadChangedAccount(email: string, token: string) {
        if (
            this.accountReloadPending ||
            this.selectedEmail !== email ||
            this.accounts[email] !== token
        ) {
            this.resetAccountView();
        }
    }

    selectAccount(email: string) {
        if (this.busy || this.fileAction) return;
        if (!Object.hasOwn(this.accounts, email)) return;
        const saved = this.preferences?.selectAccount(email);
        if (!saved) return;
        saved.match({
            Ok: () => {},
            Err: (error) => {
                this.message = error.message;
            }
        });
    }

    removeAccount(email: string) {
        if (this.busy || this.fileAction) return;
        if (!Object.hasOwn(this.accounts, email)) return;
        const updated = { ...this.accounts };
        delete updated[email];
        const removed = this.preferences?.saveAccounts(updated, Object.keys(updated)[0] ?? '');
        if (!removed) return;
        removed.match({
            Ok: () => {},
            Err: (error) => {
                this.message = error.message;
            }
        });
    }

    confirmAction() {
        const target = this.confirmTarget;
        this.confirmOpen = false;
        this.confirmTarget = null;
        if (!target) return;
        if (target.kind === ConfirmKind.Account) {
            this.removeAccount(target.email);
            return;
        }

        const item = target.item;
        const current = this.files.find((file) => fileKey(file) === fileKey(item));
        if (
            item.email !== this.selectedEmail ||
            !current ||
            current.name !== item.name ||
            current.chunks.length !== item.chunks.length ||
            current.chunks.some(
                (chunk) =>
                    !item.chunks.some(
                        (saved) =>
                            saved.mediaKey === chunk.mediaKey &&
                            saved.sha1 === chunk.sha1 &&
                            saved.chunkIndex === chunk.chunkIndex
                    )
            )
        ) {
            this.galleryMessage = 'The file changed. Review its current chunks before deleting.';
            return;
        }

        void this.actOnFile(current, FileActionKind.Delete);
    }

    async actOnFile(item: FileGroup, action: FileActionKind) {
        if (this.busy || this.fileAction || this.libraryLoading) return;

        const token = this.accounts[item.email];
        if (item.email !== this.selectedEmail || !token) {
            this.galleryMessage = 'Select the file’s connected account before continuing.';
            return;
        }

        this.fileAction = { fileId: item.fileId, kind: action };
        this.galleryMessage = '';

        if (action === FileActionKind.Delete) {
            const deleted = await deleteFile(
                item,
                token,
                (chunk) => {
                    this.uploads = this.uploads.filter(
                        (saved) =>
                            saved.email !== item.email ||
                            saved.mediaKey !== chunk.mediaKey ||
                            saved.sha1 !== chunk.sha1
                    );
                },
                this.concurrentWorkers
            );

            deleted.match({
                Ok: () => {},
                Err: (error) => {
                    this.galleryMessage = error.message;
                }
            });

            this.uploadPanelOpen = false;
            this.fileAction = null;
            this.reloadChangedAccount(item.email, token);
            return;
        }

        const downloaded = await downloadFile(item, token);
        downloaded.match({
            Ok: (file) => {
                try {
                    const url = URL.createObjectURL(file);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = item.name;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 60_000);
                } catch {
                    this.galleryMessage = 'Could not save the downloaded file.';
                }
            },
            Err: (error) => {
                this.galleryMessage = error.message;
            }
        });

        this.fileAction = null;
        this.reloadChangedAccount(item.email, token);
    }

    async upload(files: readonly File[]) {
        if (
            this.busy ||
            this.fileAction ||
            this.libraryLoading ||
            !this.selectedEmail ||
            files.length === 0
        )
            return;

        this.uploadSources = [...files];
        this.uploadJobs = createUploadJobs(files);
        await this.runUploads(files);
    }

    async retryUpload(id: number) {
        if (this.busy || this.fileAction || this.libraryLoading || !this.selectedEmail) return;

        const job = this.uploadJobs.find((current) => current.id === id);
        const file = this.uploadSources[id];
        if (!job || job.status !== UploadJobStatus.Error || !file) return;

        const fresh = createUploadJobs([file])[0];
        this.uploadJobs = this.uploadJobs.map((current) =>
            current.id === id ? { ...fresh, id } : current
        );

        await this.runUploads([file], id);
    }

    private async runUploads(files: readonly File[], retryId?: number) {
        const email = this.selectedEmail;
        const token = this.accounts[email];
        if (!token) return;

        this.uploadPanelOpen = true;
        this.message = '';
        this.busy = true;

        const uploaded = await uploadFiles(
            files,
            email,
            token,
            this.concurrentWorkers,
            (job) => {
                const id = retryId ?? job.id;
                this.uploadJobs = this.uploadJobs.map((current) =>
                    current.id === id ? { ...job, id } : current
                );
            },
            (saved) => {
                if (this.selectedEmail !== email) return;
                this.uploads = [
                    saved,
                    ...this.uploads.filter(
                        (item) =>
                            fileKey(item) !== fileKey(saved) || item.chunkIndex !== saved.chunkIndex
                    )
                ];
            }
        );

        uploaded.match({
            Ok: () => {},
            Err: (error) => {
                this.uploadJobs = this.uploadJobs.map((job) =>
                    (retryId !== undefined && job.id !== retryId) ||
                    job.status === UploadJobStatus.Complete ||
                    job.status === UploadJobStatus.Error
                        ? job
                        : { ...job, status: UploadJobStatus.Error, message: error.message }
                );
            }
        });

        this.busy = false;
        this.reloadChangedAccount(email, token);
    }
}
