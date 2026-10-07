import {
    ConfirmKind,
    FileActionKind,
    UploadJobStatus,
    DEFAULT_PREFERENCES_DEFAULTS,
    NewAccountSchema,
    ThemeSchema,
    type PreferencesDefaults
} from '#lib/models';
import { watch } from 'runed';
import { fileKey, type FileGroup, type FileAction } from '#lib/files';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import { validateAccount } from '#browser/accounts';
import { createBrowserPreferences, type BrowserPreferences } from '#browser/storage';
import {
    createUploadJobs,
    uploadFiles,
    downloadFile,
    saveDownloadedFile,
    deleteFile,
    type UploadJob
} from '#browser/files';
import { DriveLibrary } from '#browser/drive/library.svelte';
import { DriveSettings } from '#browser/drive/settings.svelte';

export type ConfirmTarget =
    { kind: ConfirmKind.Account; email: string } | { kind: ConfirmKind.File; item: FileGroup };

export class DriveController {
    private preferences = $state.raw<BrowserPreferences | null>(null);
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

    feedbackMessage = $state('');
    fileAction = $state<FileAction | null>(null);
    accountMenuOpen = $state(false);
    confirmOpen = $state(false);
    confirmTarget = $state<ConfirmTarget | null>(null);

    readonly library: DriveLibrary;
    readonly settings: DriveSettings;

    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {
        const feedback = (message: string) => {
            this.feedbackMessage = message;
        };

        this.settings = new DriveSettings(() => this.preferences, defaults, feedback);
        this.library = new DriveLibrary(
            () => ({ email: this.selectedEmail, token: this.accounts[this.selectedEmail] }),
            () => this.busy || !!this.fileAction,
            () => this.settings.fileSort,
            feedback
        );

        watch(
            [() => this.selectedEmail, () => this.accounts[this.selectedEmail]],
            ([email, token], [previousEmail, previousToken]) => {
                if (!this.ready || (email === previousEmail && token === previousToken)) return;

                this.resetAccountView();
            }
        );

        useAutomaticRefresh(
            () => this.settings.refreshIntervalSeconds,
            () =>
                this.ready &&
                !!this.selectedEmail &&
                !this.busy &&
                !this.fileAction &&
                !this.library.loading,
            () => this.library.refresh()
        );
    }

    get accounts() {
        return this.preferences?.accounts ?? {};
    }

    get selectedEmail() {
        return this.preferences?.selectedEmail ?? '';
    }

    initialize() {
        const parsedTheme = ThemeSchema.safeParse(document.documentElement.getAttribute('theme'));
        if (parsedTheme.success) this.settings.themeMode = parsedTheme.data;

        createBrowserPreferences(this.defaults).match({
            Ok: (preferences) => {
                this.preferences = preferences;
            },
            Err: (error) => {
                this.feedbackMessage = error.message;
            }
        });

        this.ready = true;
    }

    async saveAccount() {
        if (this.connecting || this.busy || this.fileAction) return;

        const preferences = this.preferences;
        if (!preferences) {
            this.feedbackMessage =
                'Browser storage is unavailable. Enable it to save your credentials.';

            return;
        }

        this.newEmail = this.newEmail.trim();
        this.newToken = this.newToken.trim();

        if (!NewAccountSchema.safeParse({ email: this.newEmail, token: this.newToken }).success) {
            this.feedbackMessage = 'Enter your Google account email and an OAuth2 or AAS token.';

            return;
        }

        this.connecting = true;
        this.feedbackMessage = '';

        const email = this.newEmail;
        const inputToken = this.newToken;
        const verified = await validateAccount(email, inputToken);

        this.connecting = false;

        const token = verified.match({
            Ok: (value) => value,
            Err: (error) => {
                this.feedbackMessage = error.message;

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
                this.feedbackMessage = error.message;
            }
        });
    }

    private resetAccountView() {
        this.confirmOpen = false;
        this.confirmTarget = null;
        this.library.reset();

        if (this.busy || this.fileAction) {
            this.accountReloadPending = true;

            return;
        }

        this.accountReloadPending = false;
        this.uploadJobs = [];
        this.uploadSources = [];
        this.uploadPanelOpen = false;
        this.feedbackMessage = '';
        void this.library.load();
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
                this.feedbackMessage = error.message;
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
                this.feedbackMessage = error.message;
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
        const current = this.library.files.find((file) => fileKey(file) === fileKey(item));
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
            this.feedbackMessage = 'The file changed. Review its current chunks before deleting.';

            return;
        }

        void this.actOnFile(current, FileActionKind.Delete);
    }

    async actOnFile(item: FileGroup, action: FileActionKind) {
        if (this.busy || this.fileAction || this.library.loading) return;

        const token = this.accounts[item.email];
        if (item.email !== this.selectedEmail || !token) {
            this.feedbackMessage = 'Select the file’s connected account before continuing.';

            return;
        }

        this.fileAction = { fileId: item.fileId, kind: action };
        this.feedbackMessage = '';

        if (action === FileActionKind.Delete) {
            const deleted = await deleteFile(
                item,
                token,
                (chunk) => {
                    this.library.chunks = this.library.chunks.filter(
                        (saved) =>
                            saved.email !== item.email ||
                            saved.mediaKey !== chunk.mediaKey ||
                            saved.sha1 !== chunk.sha1
                    );
                },
                this.settings.concurrentWorkers
            );

            deleted.match({
                Ok: () => {},
                Err: (error) => {
                    this.feedbackMessage = error.message;
                }
            });

            this.uploadPanelOpen = false;
            this.fileAction = null;
            this.reloadChangedAccount(item.email, token);

            return;
        }

        const downloaded = await downloadFile(item, token);

        downloaded
            .andThen((file) => saveDownloadedFile(file, item.name))
            .match({
                Ok: () => {},
                Err: (error) => {
                    this.feedbackMessage = error.message;
                }
            });

        this.fileAction = null;
        this.reloadChangedAccount(item.email, token);
    }

    async upload(files: readonly File[]) {
        if (
            this.busy ||
            this.fileAction ||
            this.library.loading ||
            !this.selectedEmail ||
            files.length === 0
        )
            return;

        this.uploadSources = [...files];
        this.uploadJobs = createUploadJobs(files);
        await this.runUploads(files);
    }

    async retryUpload(id: number) {
        if (this.busy || this.fileAction || this.library.loading || !this.selectedEmail) return;

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
        this.feedbackMessage = '';
        this.busy = true;

        const uploaded = await uploadFiles(
            files,
            email,
            token,
            this.settings.concurrentWorkers,
            (job) => {
                const id = retryId ?? job.id;
                this.uploadJobs = this.uploadJobs.map((current) =>
                    current.id === id ? { ...job, id } : current
                );

                if (job.status === UploadJobStatus.Error) {
                    this.feedbackMessage = job.message;
                }
            },
            (saved) => {
                if (this.selectedEmail !== email) return;

                this.library.chunks = [
                    saved,
                    ...this.library.chunks.filter(
                        (item) =>
                            fileKey(item) !== fileKey(saved) || item.chunkIndex !== saved.chunkIndex
                    )
                ];
            }
        );

        uploaded.match({
            Ok: () => {},
            Err: (error) => {
                this.feedbackMessage = error.message;
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
