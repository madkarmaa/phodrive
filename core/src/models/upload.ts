import { z } from 'zod';
import { AccountSchema } from './accounts';
import {
    FileNameSchema,
    FileSizeSchema,
    RemoteBmpSchema,
    Sha1HexSchema,
    Sha256HexSchema
} from './files';
import { WorkerCountSchema } from './settings';

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

export const ProcessingModeSchema = z.enum(ProcessingMode);

export const UploadResponseSchema = z.object({
    status: z.enum(UploadStatus),
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema
});

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

export type UploadFile = z.infer<typeof UploadFileSchema>;

export type UploadChunk = z.infer<typeof UploadChunkSchema>;

export type ChunkUploadRequest = z.infer<typeof UploadRequestSchema>;

export type FileUploadRequest = z.infer<typeof FileUploadRequestSchema>;

export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export type UploadEvent = z.infer<typeof UploadEventSchema>;

export type UploadProgress = z.infer<typeof UploadProgressSchema>;
