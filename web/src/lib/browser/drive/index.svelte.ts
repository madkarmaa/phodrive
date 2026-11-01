import {
    FileActionKind,
    UploadJobStatus,
    DEFAULT_PREFERENCES_DEFAULTS,
    ProcessingMode,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import { DriveAccount } from '#browser/drive/account.svelte';
import { createBrowserPreferences, type BrowserPreferences } from '#browser/storage';
import { createUploadJobs, type UploadJob } from '#browser/files';
import { downloadAndSave, trashFile, uploadBatch } from '#browser/drive/actions';
import { DriveLibrary } from '#browser/drive/library.svelte';
import { DriveSettings } from '#browser/drive/settings.svelte';
import { failUnfinishedJobs, replaceJob, unchangedFile } from '#browser/drive/chunks';

/** The signed-in user's drive; their Google account and token stay on the server. */
export class DriveController {
    private preferences = $state.raw<BrowserPreferences | null>(null);

    ready = $state(false);
    busy = $state(false);
    uploadPanelOpen = $state(false);
    uploadJobs = $state<UploadJob[]>([]);
    private uploadSources: readonly File[] = [];

    feedbackMessage = $state('');
    fileAction = $state<FileAction | null>(null);
    accountMenuOpen = $state(false);
    confirmOpen = $state(false);
    confirmTarget = $state<FileGroup | null>(null);

    readonly library: DriveLibrary;
    readonly settings: DriveSettings;
    readonly account: DriveAccount;

    constructor(
        readonly email: string,
        private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS,
        readonly processing: ProcessingMode = ProcessingMode.Browser
    ) {
        const feedback = (message: string) => {
            this.feedbackMessage = message;
        };

        this.settings = new DriveSettings(() => this.preferences, defaults, feedback);
        this.library = new DriveLibrary(
            email,
            () => this.working,
            () => this.settings.fileSort,
            feedback
        );

        this.account = new DriveAccount(this.library, () => !this.working, feedback);

        useAutomaticRefresh(
            () => this.settings.refreshIntervalSeconds,
            () => this.ready && !this.working && !this.library.loading,
            () => this.library.refresh()
        );
    }

    /** An upload or a file action is running. */
    private get working(): boolean {
        return this.busy || this.fileAction !== null;
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

    confirmAction() {
        const item = this.confirmTarget;
        this.confirmOpen = false;
        this.confirmTarget = null;
        if (!item) return;

        const current = this.library.files.find((file) => fileKey(file) === fileKey(item));
        if (!unchangedFile(current, item)) {
            this.feedbackMessage = 'The file changed. Review its current chunks before deleting.';

            return;
        }

        void this.actOnFile(current, FileActionKind.Delete);
    }

    async actOnFile(item: FileGroup, action: FileActionKind) {
        if (this.working || this.library.loading) return;

        this.fileAction = { fileId: item.fileId, kind: action };
        this.feedbackMessage = '';

        const deleting = action === FileActionKind.Delete;
        const done = deleting
            ? await trashFile(this.library, item, this.settings.concurrentWorkers)
            : await downloadAndSave(item, this.processing);

        done.inspectErr((error) => {
            this.feedbackMessage = error.message;
        });

        if (deleting) this.uploadPanelOpen = false;
        this.fileAction = null;
    }

    async upload(files: readonly File[]) {
        if (this.working || files.length === 0) return;

        if (this.library.loading) {
            this.feedbackMessage =
                'Files are refreshing. Wait for the refresh to finish, then select your files again.';

            return;
        }

        this.uploadSources = [...files];
        this.uploadJobs = createUploadJobs(files);
        await this.runUploads(files);
    }

    async retryUpload(id: number) {
        if (this.working || this.library.loading) return;

        const job = this.uploadJobs.find((current) => current.id === id);
        const file = this.uploadSources[id];
        if (!job || job.status !== UploadJobStatus.Error || !file) return;

        this.uploadJobs = replaceJob(this.uploadJobs, id, createUploadJobs([file])[0]);

        await this.runUploads([file], id);
    }

    private async runUploads(files: readonly File[], retryId?: number) {
        this.uploadPanelOpen = true;
        this.feedbackMessage = '';
        this.busy = true;

        const uploaded = await uploadBatch({
            files,
            email: this.email,
            workers: this.settings.concurrentWorkers,
            processing: this.processing,
            library: this.library,
            retryId,
            onJob: (job, id) => {
                this.uploadJobs = replaceJob(this.uploadJobs, id, job);
                if (job.status === UploadJobStatus.Error) this.feedbackMessage = job.message;
            }
        });

        uploaded.inspectErr((error) => {
            this.feedbackMessage = error.message;
            this.uploadJobs = failUnfinishedJobs(this.uploadJobs, error.message, retryId);
        });

        this.busy = false;
    }
}
