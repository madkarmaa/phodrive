import { mkdtemp, open, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    UploadEventType,
    UploadPhase,
    type FileUploadRequest,
    type UploadEvent
} from '../../models';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedMultipartFile } from './multipart';

const PROGRESS_INTERVAL_MS = 100;
const SPOOL_PREFIX = 'phodrive-upload-';

/** A new private temporary directory for one uploaded file. */
export function createSpoolDirectory(): AsyncResult<string, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const directory = await mkdtemp(join(tmpdir(), SPOOL_PREFIX));

            return Ok(directory);
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_SPOOL_FAILED);
        }
    });
}

export function openSpool(path: string): AsyncResult<FileHandle, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const handle = await open(path, 'wx');

            return Ok(handle);
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_SPOOL_FAILED);
        }
    });
}

function writeBlock(handle: FileHandle, block: Uint8Array): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await handle.write(block);

            return Ok(undefined);
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_SPOOL_FAILED);
        }
    });
}

/** Copy the incoming file to disk, reporting how much the server has received. */
export function writeSpool(
    received: ReceivedMultipartFile<FileUploadRequest>,
    handle: FileHandle,
    emit: (event: UploadEvent) => void
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, ServerError>> => {
        const total = received.metadata.size;
        const reader = received.payload.getReader();
        let written = 0;
        let lastProgress = 0;
        const report = (force: boolean) => {
            const now = performance.now();
            if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return;

            lastProgress = now;
            emit({
                type: UploadEventType.Progress,
                id: 0,
                progress: { phase: UploadPhase.Receiving, completed: written, total }
            });
        };
        report(true);

        try {
            while (true) {
                let next: ReadableStreamReadResult<Uint8Array>;

                try {
                    next = await reader.read();
                } catch {
                    return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
                }
                if (next.done) break;

                written += next.value.length;
                if (written > total) return Err(SERVER_ERRORS.FILE_TOO_LARGE);

                const stored = await writeBlock(handle, next.value);
                if (stored.isErr()) return stored;

                report(false);
            }
        } finally {
            reader.releaseLock();
        }

        if (written !== total) return Err(SERVER_ERRORS.INCOMPLETE_FILE);

        report(true);

        return await received.finished();
    });
}
