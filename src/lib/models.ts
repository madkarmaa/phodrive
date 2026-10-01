import { z } from 'zod';

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
export const MAX_REFRESH_INTERVAL_SECONDS = 86_400;
export const DEFAULT_CONCURRENT_WORKERS = 8;
export const MAX_CONCURRENT_WORKERS = 32;

export const ThemeSchema = z.enum(['light', 'dark', 'auto']);
export const FileSortSchema = z.enum(['name-asc', 'name-desc', 'modified-desc', 'modified-asc']);
export const RefreshIntervalSchema = z.int().min(0).max(MAX_REFRESH_INTERVAL_SECONDS);
export const ConcurrentWorkersSchema = z.int().min(1).max(MAX_CONCURRENT_WORKERS);
export const PreferencesDefaultsSchema = z.object({
    theme: ThemeSchema,
    fileSort: FileSortSchema,
    refreshIntervalSeconds: RefreshIntervalSchema,
    concurrentWorkers: ConcurrentWorkersSchema
});
export const SelectedAccountSchema = z.union([z.email(), z.literal('')]);

export const AccountSchema = z.object({
    email: z.email(),
    token: z.string().startsWith('aas_et/')
});

export const NewAccountSchema = z.object({
    email: z.email(),
    token: z.string().refine((value) => value.startsWith('oauth2_') || value.startsWith('aas_et/'))
});

export const StoredAccountsSchema = z.record(z.string(), z.unknown());
export const Sha1HexSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const SplitHeaderSchema = z
    .object({
        fileHash: Sha256HexSchema,
        chunkIndex: z.int().nonnegative(),
        flags: z.union([z.literal(0), z.literal(1)]),
        payloadSize: z.int().nonnegative(),
        fileName: z.string().min(1).optional()
    })
    .refine((header) => (header.chunkIndex === 0) === (header.fileName !== undefined));

export const RemoteBmpSchema = z.object({
    fileHash: Sha256HexSchema,
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
    status: z.enum(['uploaded', 'already exists']),
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema
});

export const DeleteResponseSchema = z.object({ deleted: z.literal(true) });
export const ErrorResponseSchema = z.object({ error: z.string() });
export const UploadEventSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('progress'),
            sent: z.int().nonnegative(),
            total: z.int().positive()
        })
        .refine((event) => event.sent <= event.total),
    z.object({ type: z.literal('complete'), result: UploadResponseSchema }),
    z.object({ type: z.literal('error'), error: z.string() })
]);
export const AccountConnectionSchema = z.union([
    z.object({ token: z.string().startsWith('aas_et/') }),
    ErrorResponseSchema
]);
export const AccountRequestSchema = z.object({ email: z.email(), token: z.string() });
export const LibraryRequestSchema = AccountRequestSchema.extend({
    pageToken: z.string().optional()
});
export const FileRequestSchema = AccountRequestSchema.extend({
    action: z.enum(['download', 'delete']),
    mediaKey: z.string().optional(),
    sha1: Sha1HexSchema
});

export type RemoteBmp = z.infer<typeof RemoteBmpSchema>;
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;
export type SplitHeader = z.infer<typeof SplitHeaderSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type UploadEvent = z.infer<typeof UploadEventSchema>;
export type ThemeMode = z.infer<typeof ThemeSchema>;
export type FileSort = z.infer<typeof FileSortSchema>;
export type RefreshInterval = z.infer<typeof RefreshIntervalSchema>;
export type ConcurrentWorkers = z.infer<typeof ConcurrentWorkersSchema>;
export type PreferencesDefaults = z.infer<typeof PreferencesDefaultsSchema>;
export type AccountConnection = z.infer<typeof AccountConnectionSchema>;

export const DEFAULT_FILE_SORT: FileSort = 'modified-desc';
export const DEFAULT_PREFERENCES_DEFAULTS: PreferencesDefaults = {
    theme: 'auto',
    fileSort: DEFAULT_FILE_SORT,
    refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
    concurrentWorkers: DEFAULT_CONCURRENT_WORKERS
};
