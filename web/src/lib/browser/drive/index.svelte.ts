import {
    FileActionKind,
    UploadJobStatus,
    DEFAULT_PREFERENCES_DEFAULTS,
    ProcessingMode,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { invalidateAll } from '$app/navigation';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import { replaceGoogleToken, signOut } from '#browser/auth';
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
import {
    failUnfinishedJobs,
    holdUploadedChunks,
    replaceJob,
    unchangedFile,
    withChunks,
    withoutChunk
} from '#browser/drive/chunks';

/** The signed-in user's drive; their Google account and token stay on the server. */
export class DriveController {
    private preferences = $state.raw<BrowserPreferences | null>(null);

    replacingToken = $state(false);
    signingOut = $state(false);

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
            () => this.busy || !!this.fileAction,
            () => this.settings.fileSort,
            feedback
        );

        useAutomaticRefresh(
            () => this.settings.refreshIntervalSeconds,
            () => this.ready && !this.busy && !this.fileAction && !this.library.loading,
            () => this.library.refresh()
        );
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

    /** Validate a new Google token on the server, then reload files with it. */
    async replaceToken(token: string): Promise<boolean> {
        if (this.replacingToken || this.busy || this.fileAction) return false;

        this.replacingToken = true;
        this.feedbackMessage = '';

        const replaced = await replaceGoogleToken(token);

        this.replacingToken = false;

        return replaced.match({
            Ok: () => {
                this.library.reset();
                void this.library.load();

                return true;
            },
            Err: (error) => {
                this.feedbackMessage = error.message;

                return false;
            }
        });
    }

    async signOut() {
        if (this.signingOut || this.busy || this.fileAction) return;

        this.signingOut = true;

        const signedOut = await signOut();

        this.signingOut = false;

        await signedOut.match({
            Ok: () => invalidateAll(),
            Err: async (error) => {
                this.feedbackMessage = error.message;
            }
        });
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
        if (this.busy || this.fileAction || this.library.loading) return;

        this.fileAction = { fileId: item.fileId, kind: action };
        this.feedbackMessage = '';

        if (action === FileActionKind.Delete) {
            const deleted = await deleteFile(
                item,
                (chunk) => {
                    this.library.chunks = withoutChunk(this.library.chunks, item, chunk);
                },
                this.settings.concurrentWorkers
            );

            deleted.inspectErr((error) => {
                this.feedbackMessage = error.message;
            });

            this.uploadPanelOpen = false;
            this.fileAction = null;

            return;
        }

        const downloaded = await downloadFile(item, this.processing);

        downloaded
            .andThen((file) => saveDownloadedFile(file, item.name))
            .inspectErr((error) => {
                this.feedbackMessage = error.message;
            });

        this.fileAction = null;
    }

    async upload(files: readonly File[]) {
        if (this.busy || this.fileAction || files.length === 0) return;

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
        if (this.busy || this.fileAction || this.library.loading) return;

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

        const uploadedChunks = holdUploadedChunks((saved) => {
            this.library.chunks = withChunks(this.library.chunks, saved);
        });
        const uploaded = await uploadFiles(
            files,
            this.email,
            this.settings.concurrentWorkers,
            (job) => {
                this.uploadJobs = replaceJob(this.uploadJobs, retryId ?? job.id, job);
                uploadedChunks.settle(job);
                if (job.status === UploadJobStatus.Error) this.feedbackMessage = job.message;
            },
            uploadedChunks.hold,
            this.processing
        );
        uploadedChunks.releaseAll();

        uploaded.inspectErr((error) => {
            this.feedbackMessage = error.message;
            this.uploadJobs = failUnfinishedJobs(this.uploadJobs, error.message, retryId);
        });

        this.busy = false;
    }
}
