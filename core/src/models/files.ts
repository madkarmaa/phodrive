import { z } from 'zod';
import { AccountRequestSchema } from './accounts';
import { WorkerCountSchema } from './settings';

export enum FileActionKind {
    Download = 'download',
    Delete = 'delete'
}

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

export const DeleteResponseSchema = z.object({ deleted: z.literal(true) });

export const ErrorResponseSchema = z.object({ error: z.string() });

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

/** Identifies one stored chunk for a raw download. */
export const ChunkReferenceSchema = RemoteBmpSchema.pick({ mediaKey: true, sha1: true });

export type RemoteBmp = z.infer<typeof RemoteBmpSchema>;

export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;

export type SplitHeader = z.infer<typeof SplitHeaderSchema>;

export type FileActionRequest = z.infer<typeof FileActionRequestSchema>;

export type FileRequest = z.infer<typeof FileRequestSchema>;
