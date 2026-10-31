import {
    FileActionKind,
    UploadJobStatus,
    DEFAULT_PREFERENCES_DEFAULTS,
    ProcessingMode,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import {
    fileKey,
    type FileAction,
    type FileGroup,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
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
        if (
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

        this.fileAction = { fileId: item.fileId, kind: action };
        this.feedbackMessage = '';

        if (action === FileActionKind.Delete) {
            const deleted = await deleteFile(
                item,
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

        const fresh = createUploadJobs([file])[0];
        this.uploadJobs = this.uploadJobs.map((current) =>
            current.id === id ? { ...fresh, id } : current
        );

        await this.runUploads([file], id);
    }

    /** Add confirmed chunks, replacing any earlier copy of the same chunk. */
    private addChunks(saved: readonly UploadedChunk[]) {
        if (!saved.length) return;

        const added = new Set(saved.map((chunk) => `${fileKey(chunk)}:${chunk.chunkIndex}`));
        this.library.chunks = [
            ...saved,
            ...this.library.chunks.filter(
                (item) => !added.has(`${fileKey(item)}:${item.chunkIndex}`)
            )
        ];
    }

    private async runUploads(files: readonly File[], retryId?: number) {
        this.uploadPanelOpen = true;
        this.feedbackMessage = '';
        this.busy = true;

        // A file appears once its upload ends, so an unfinished file is never offered for download.
        // A failed upload still shows its confirmed chunks, so they can be found and deleted.
        const pending = new Map<number, UploadedChunk[]>();
        const release = (jobId: number) => {
            this.addChunks(pending.get(jobId) ?? []);
            pending.delete(jobId);
        };

        const uploaded = await uploadFiles(
            files,
            this.email,
            this.settings.concurrentWorkers,
            (job) => {
                const id = retryId ?? job.id;
                this.uploadJobs = this.uploadJobs.map((current) =>
                    current.id === id ? { ...job, id } : current
                );

                if (job.status === UploadJobStatus.Complete || job.status === UploadJobStatus.Error)
                    release(job.id);

                if (job.status === UploadJobStatus.Error) {
                    this.feedbackMessage = job.message;
                }
            },
            (saved, jobId) => {
                pending.set(jobId, [...(pending.get(jobId) ?? []), saved]);
            },
            this.processing
        );

        for (const jobId of [...pending.keys()]) release(jobId);

        uploaded.inspectErr((error) => {
            this.feedbackMessage = error.message;
            this.uploadJobs = this.uploadJobs.map((job) =>
                (retryId !== undefined && job.id !== retryId) ||
                job.status === UploadJobStatus.Complete ||
                job.status === UploadJobStatus.Error
                    ? job
                    : { ...job, status: UploadJobStatus.Error, message: error.message }
            );
        });

        this.busy = false;
    }
}
