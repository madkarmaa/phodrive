import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import type { ProcessingMode } from '@madkarmaa/phodrive-core/models';
import type { AsyncResult } from 'results-ts';
import {
    deleteFile,
    downloadFile,
    saveDownloadedFile,
    uploadFiles,
    type UploadJob
} from '#browser/files';
import { holdUploadedChunks, withChunks, withoutChunk } from '#browser/drive/chunks';
import type { DriveLibrary } from '#browser/drive/library.svelte';

/** Move a file's chunks to the trash, dropping each from the library once Google confirms it. */
export function trashFile(
    library: DriveLibrary,
    item: FileGroup,
    workers: number
): AsyncResult<void, ApplicationError> {
    return deleteFile(
        item,
        (chunk) => {
            library.chunks = withoutChunk(library.chunks, item, chunk);
        },
        workers
    );
}

export function downloadAndSave(
    item: FileGroup,
    processing: ProcessingMode
): AsyncResult<void, ApplicationError> {
    return downloadFile(item, processing).andThen((file) => saveDownloadedFile(file, item.name));
}

export interface UploadBatch {
    files: readonly File[];
    email: string;
    workers: number;
    processing: ProcessingMode;
    library: DriveLibrary;
    /** A retry reports its single file under the job ID it already has. */
    retryId?: number;
    onJob: (job: UploadJob, id: number) => void;
}

/** Upload files, adding each file's confirmed chunks to the library once its upload ends. */
export function uploadBatch({
    files,
    email,
    workers,
    processing,
    library,
    retryId,
    onJob
}: UploadBatch): AsyncResult<void, ApplicationError> {
    const uploadedChunks = holdUploadedChunks((saved) => {
        library.chunks = withChunks(library.chunks, saved);
    });

    return uploadFiles(
        files,
        email,
        workers,
        (job) => {
            onJob(job, retryId ?? job.id);
            uploadedChunks.settle(job);
        },
        uploadedChunks.hold,
        processing
    )
        .inspect(uploadedChunks.releaseAll)
        .inspectErr(uploadedChunks.releaseAll);
}
