import { z } from 'zod';

export enum UploadJobStatus {
    Queued = 'queued',
    Active = 'active',
    Complete = 'complete',
    Error = 'error'
}

export enum UploadPhase {
    Receiving = 'receiving',
    Preparing = 'preparing',
    Uploading = 'uploading'
}

export enum UploadStatus {
    Uploaded = 'uploaded',
    AlreadyExists = 'already exists'
}

export enum UploadEventType {
    Queued = 'queued',
    Progress = 'progress',
    Chunk = 'chunk',
    FileComplete = 'file-complete',
    FileError = 'file-error',
    Complete = 'complete',
    Error = 'error'
}

/** Where files are hashed, split, and encoded on upload, and verified and decoded on download. */
export enum ProcessingMode {
    Browser = 'browser',
    Server = 'server'
}

/** What a chunk upload carries: the raw file slice, or the finished BMP from the browser. */
export enum ChunkFormat {
    Payload = 'payload',
    Bmp = 'bmp'
}

export enum FileActionKind {
    Download = 'download',
    Delete = 'delete'
}

export enum AppView {
    Files = 'files',
    Settings = 'settings'
}

export enum ThemeMode {
    Light = 'light',
    Dark = 'dark',
    Auto = 'auto'
}

export enum FileSort {
    NameAscending = 'name-asc',
    NameDescending = 'name-desc',
    ModifiedDescending = 'modified-desc',
    ModifiedAscending = 'modified-asc'
}

export enum FileLayout {
    List = 'list',
    Grid = 'grid'
}

export const DEFAULT_FILE_LAYOUT = FileLayout.List;
export const FileLayoutSchema = z.enum(FileLayout);

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
export const MAX_REFRESH_INTERVAL_SECONDS = 86_400;
export const DEFAULT_CONCURRENT_WORKERS = 8;
export const MAX_CONCURRENT_WORKERS = 32;

export const ProcessingModeSchema = z.enum(ProcessingMode);
export const ThemeSchema = z.enum(ThemeMode);
export const FileSortSchema = z.enum(FileSort);
export const RefreshIntervalSchema = z.int().min(0).max(MAX_REFRESH_INTERVAL_SECONDS);
export const ConcurrentWorkersSchema = z.int().min(1).max(MAX_CONCURRENT_WORKERS);
/** Servers limit requested workers to their own processors, so any positive count is accepted. */
export const WorkerCountSchema = z.int().positive();
export const PreferencesDefaultsSchema = z.object({
    theme: ThemeSchema,
    fileSort: FileSortSchema,
    refreshIntervalSeconds: RefreshIntervalSchema,
    concurrentWorkers: ConcurrentWorkersSchema
});
export const EmailSchema = z.email();
export const AasTokenSchema = z.string().startsWith('aas_et/');
export const SelectedAccountSchema = z.union([EmailSchema, z.literal('')]);

export const AccountSchema = z.object({
    email: EmailSchema,
    token: AasTokenSchema
});

export const NewAccountSchema = z.object({
    email: z.email({ error: 'Enter a valid Google account email.' }),
    token: z
        .string()
        .refine((value) => value.startsWith('oauth2_') || value.startsWith('aas_et/'), {
            error: 'Enter an OAuth2 token starting with oauth2_ or an AAS token starting with aas_et/.'
        })
});

export const StoredAccountsSchema = z.record(z.string(), z.unknown());
/** Names become path segments and multipart filenames, so separators and controls are unsafe. */
export const FileNameSchema = z
    .string()
    .min(1)
    .refine((name) => !/[\\/\r\n\0]/.test(name));
export const FileSizeSchema = z.int().nonnegative();
export const Sha1HexSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const SplitHeaderSchema = z
    .object({
        fileHash: Sha256HexSchema,
        fileId: Sha256HexSchema,
        chunkIndex: z.int().nonnegative(),
        flags: z.union([z.literal(0), z.literal(1)]),
        payloadSize: z.int().nonnegative(),
        fileName: z.string().min(1).optional()
    })
    .refine((header) => header.chunkIndex !== 0 || header.fileName !== undefined);

export const RemoteBmpSchema = z.object({
    fileHash: Sha256HexSchema,
    fileId: Sha256HexSchema,
    chunkIndex: z.int().nonnegative(),
    isLast: z.boolean(),
    originalName: z.string().min(1).optional(),
    size: z.number().nonnegative(),
    at: z.int().nonnegative(),
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema
});

export const LibraryResponseSchema = z.object({
    items: z.array(RemoteBmpSchema),
    nextPageToken: z.string()
});

export const UploadResponseSchema = z.object({
    status: z.enum(UploadStatus),
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema
});

export const DeleteResponseSchema = z.object({ deleted: z.literal(true) });
export const ErrorResponseSchema = z.object({ error: z.string() });
export const UploadProgressSchema = z
    .discriminatedUnion('phase', [
        z.object({
            phase: z.enum([UploadPhase.Receiving, UploadPhase.Preparing]),
            completed: z.int().nonnegative(),
            total: z.int().nonnegative()
        }),
        z.object({
            phase: z.literal(UploadPhase.Uploading),
            completed: z.int().nonnegative(),
            total: z.int().positive(),
            reused: z.int().nonnegative()
        })
    ])
    .refine(
        (progress) =>
            progress.completed + (progress.phase === UploadPhase.Uploading ? progress.reused : 0) <=
            progress.total
    );
export const UploadEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(UploadEventType.Queued), id: z.int().nonnegative() }),
    z.object({
        type: z.literal(UploadEventType.Progress),
        id: z.int().nonnegative(),
        progress: UploadProgressSchema
    }),
    z.object({
        type: z.literal(UploadEventType.Chunk),
        id: z.int().nonnegative(),
        chunk: RemoteBmpSchema
    }),
    z.object({
        type: z.literal(UploadEventType.FileComplete),
        id: z.int().nonnegative(),
        result: UploadResponseSchema
    }),
    z.object({
        type: z.literal(UploadEventType.FileError),
        id: z.int().nonnegative(),
        error: z.string()
    }),
    z.object({ type: z.literal(UploadEventType.Complete) }),
    z.object({ type: z.literal(UploadEventType.Error), error: z.string() })
]);
export const AccountRequestSchema = z.object({ email: EmailSchema, token: z.string() });
/** HTTP clients send no credentials; the server adds the signed-in user's account. */
export const LibraryPageRequestSchema = z.object({ pageToken: z.string().optional() });
export const FileActionRequestSchema = z.object({
    action: z.enum(FileActionKind),
    name: z.string().min(1),
    fileHash: Sha256HexSchema,
    fileId: Sha256HexSchema,
    chunks: z.array(RemoteBmpSchema).nonempty(),
    workers: WorkerCountSchema
});
export const FileRequestSchema = AccountRequestSchema.extend(FileActionRequestSchema.shape);
export const FileDeleteResponseSchema = z.object({
    deleted: z.array(RemoteBmpSchema),
    error: z.string().optional()
});
export const UploadFileSchema = z.object({
    name: FileNameSchema,
    size: FileSizeSchema,
    fileHash: Sha256HexSchema
});
export const UploadChunkSchema = z.object({
    file: UploadFileSchema,
    chunkIndex: z.int().nonnegative(),
    sha1: Sha1HexSchema
});
export const UploadRequestSchema = AccountSchema.extend(UploadChunkSchema.shape);
/** A whole file sent for the server to hash, split, and encode. */
export const FileUploadRequestSchema = z.object({
    name: FileNameSchema,
    size: FileSizeSchema,
    workers: WorkerCountSchema
});
/** Identifies one stored chunk for a raw download. */
export const ChunkReferenceSchema = RemoteBmpSchema.pick({ mediaKey: true, sha1: true });
export type Account = z.infer<typeof AccountSchema>;
export type UploadFile = z.infer<typeof UploadFileSchema>;
export type UploadChunk = z.infer<typeof UploadChunkSchema>;
export type ChunkUploadRequest = z.infer<typeof UploadRequestSchema>;
export type FileUploadRequest = z.infer<typeof FileUploadRequestSchema>;

export type RemoteBmp = z.infer<typeof RemoteBmpSchema>;
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;
export type SplitHeader = z.infer<typeof SplitHeaderSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type UploadEvent = z.infer<typeof UploadEventSchema>;
export type UploadProgress = z.infer<typeof UploadProgressSchema>;
export type FileActionRequest = z.infer<typeof FileActionRequestSchema>;
export type FileRequest = z.infer<typeof FileRequestSchema>;
export type RefreshInterval = z.infer<typeof RefreshIntervalSchema>;
export type ConcurrentWorkers = z.infer<typeof ConcurrentWorkersSchema>;
export type PreferencesDefaults = z.infer<typeof PreferencesDefaultsSchema>;

export const DEFAULT_FILE_SORT = FileSort.ModifiedDescending;
export const DEFAULT_PREFERENCES_DEFAULTS: PreferencesDefaults = {
    theme: ThemeMode.Auto,
    fileSort: DEFAULT_FILE_SORT,
    refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
    concurrentWorkers: DEFAULT_CONCURRENT_WORKERS
};
