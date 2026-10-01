import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import pLimit, { type LimitFunction } from 'p-limit';
import {
    decodeSplitBmp,
    encodeSplitBmp,
    MAX_CHUNK_PAYLOAD_BYTES,
    splitBmpByteLength
} from '$lib/bmp';
import { chunkFileName } from '$lib/chunks';
import { hashFile } from '$lib/file-hash';
import type { FileGroup, UploadedChunk } from '$lib/file-groups';
import {
    ConcurrentWorkersSchema,
    DeleteResponseSchema,
    type SplitHeader,
    type UploadResponse
} from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import { apiJson, apiBytes } from '$browser/api';
import { uploadRequest } from '$browser/upload';

export type UploadProgress =
    | { phase: 'hashing'; completed: number; total: number }
    | { phase: 'uploading'; completed: number; total: number; reused: number };

export interface UploadJob {
    id: number;
    name: string;
    status: 'queued' | 'active' | 'complete' | 'error';
    progress: UploadProgress;
    message: string;
    result: UploadResponse | null;
}

export function createUploadJobs(files: readonly File[]): UploadJob[] {
    return files.map((file, id) => ({
        id,
        name: file.name,
        status: 'queued',
        progress: { phase: 'hashing', completed: 0, total: file.size },
        message: '',
        result: null
    }));
}

export function checkFileSize(file: File): Result<number, Error> {
    if (!Number.isSafeInteger(file.size) || !file.name || /[\\/\r\n]/.test(file.name))
        return Err(new Error('Invalid file name or size.'));

    const chunkCount = Math.max(1, Math.ceil(file.size / MAX_CHUNK_PAYLOAD_BYTES));
    if (!Number.isSafeInteger(chunkCount)) return Err(new Error('File is too large.'));

    for (const index of new Set([0, Math.max(0, chunkCount - 2), chunkCount - 1])) {
        const payloadSize = Math.min(
            MAX_CHUNK_PAYLOAD_BYTES,
            file.size - index * MAX_CHUNK_PAYLOAD_BYTES
        );
        const projected = splitBmpByteLength({
            fileHash: '0'.repeat(64),
            chunkIndex: index,
            flags: index === chunkCount - 1 ? 1 : 0,
            payloadSize,
            fileName: index === 0 ? file.name : undefined
        });

        if (projected.isErr()) return projected.map(() => chunkCount);
    }

    return Ok(chunkCount);
}

function sendChunk(
    payload: Uint8Array,
    header: SplitHeader,
    remoteName: string,
    email: string,
    token: string,
    onProgress: (sent: number) => void
): AsyncResult<UploadResponse, Error> {
    return encodeSplitBmp(payload, header).andThenAsync(async (bmp) => {
        const form = new FormData();
        form.set('email', email);
        form.set('token', token);

        try {
            form.set('file', new File([bmp], remoteName, { type: 'image/bmp' }));
        } catch {
            return Err(new Error('Could not prepare the BMP upload.'));
        }

        return uploadRequest(form, bmp.byteLength, onProgress);
    });
}

function readChunk(file: File, index: number): AsyncResult<Uint8Array, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const start = index * MAX_CHUNK_PAYLOAD_BYTES;
        const end = Math.min(file.size, start + MAX_CHUNK_PAYLOAD_BYTES);

        try {
            const bytes = await file.slice(start, end).arrayBuffer();
            return Ok(new Uint8Array(bytes));
        } catch {
            return Err(new Error('Could not read the selected file.'));
        }
    });
}

type UploadPlan = { headers: SplitHeader[]; sizes: number[] };

function planUpload(file: File, chunkCount: number, fileHash: string): Result<UploadPlan, Error> {
    const headers: SplitHeader[] = Array.from({ length: chunkCount }, (_, index) => ({
        fileHash,
        chunkIndex: index,
        flags: index === chunkCount - 1 ? 1 : 0,
        payloadSize: Math.min(MAX_CHUNK_PAYLOAD_BYTES, file.size - index * MAX_CHUNK_PAYLOAD_BYTES),
        fileName: index === 0 ? file.name : undefined
    }));
    let projected: Result<number[], Error> = Ok([]);

    // Include metadata and padding in the total before parallel transfers start.
    for (const header of headers)
        projected = projected.andThen((sizes) =>
            splitBmpByteLength(header).map((size) => [...sizes, size])
        );

    return projected.map((sizes) => ({ headers, sizes }));
}

function uploadChunk(
    file: File,
    header: SplitHeader,
    chunkCount: number,
    email: string,
    token: string,
    onProgress: (sent: number) => void
): AsyncResult<{ response: UploadResponse; chunk: UploadedChunk }, Error> {
    const { fileHash, chunkIndex, flags, fileName } = header;
    const remoteName = chunkFileName(file.name, fileHash, chunkIndex, chunkCount);

    return readChunk(file, chunkIndex).andThenAsync((payload) =>
        sendChunk(
            payload,
            { ...header, payloadSize: payload.length },
            remoteName,
            email,
            token,
            onProgress
        ).map((response) => ({
            response,
            chunk: {
                email,
                fileHash,
                chunkIndex,
                isLast: flags === 1,
                originalName: fileName,
                size: payload.length,
                at: Date.now(),
                mediaKey: response.mediaKey,
                sha1: response.sha1
            }
        }))
    );
}

function uploadChunks(
    file: File,
    plan: UploadPlan,
    email: string,
    token: string,
    onProgress: (progress: UploadProgress) => void,
    onChunk: (chunk: UploadedChunk) => void,
    limit: LimitFunction
): AsyncResult<UploadResponse, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const { headers, sizes } = plan;
        let failure: Error | null = null;
        let completed = 0;
        let reused = 0;
        let uploadedAny = false;
        const total = sizes.reduce((sum, size) => sum + size, 0);
        const sentByChunk = headers.map(() => 0);
        const report = () => onProgress({ phase: 'uploading', completed, total, reused });
        report();

        const upload = (
            header: SplitHeader
        ): Result<UploadResponse, Error> | AsyncResult<UploadResponse, Error> => {
            // Leave queued payloads unread after failure; settle every active request.
            if (failure) return Err(failure);

            const index = header.chunkIndex;
            return uploadChunk(file, header, headers.length, email, token, (sent) => {
                completed += sent - sentByChunk[index];
                sentByChunk[index] = sent;
                report();
            })
                .map(({ response, chunk }) => {
                    uploadedAny ||= response.status === 'uploaded';
                    if (response.status === 'already exists') reused += sizes[index];

                    onChunk(chunk);
                    report();
                    return response;
                })
                .mapErr((error) => {
                    failure ??= error;
                    return error;
                });
        };

        const responses = await limit.map(headers, upload);
        let final: Result<UploadResponse | null, Error> = Ok(null);
        for (const response of responses) final = final.andThen(() => response);

        return final.andThen((last) => {
            if (!last) return Err(new Error('No chunks were uploaded.'));

            return Ok({
                ...last,
                status: uploadedAny ? ('uploaded' as const) : ('already exists' as const)
            });
        });
    });
}

function uploadFile(
    selectedFile: File,
    chunkCount: number,
    email: string,
    token: string,
    onProgress: (progress: UploadProgress) => void,
    onChunk: (chunk: UploadedChunk) => void,
    chunkLimit: LimitFunction
): AsyncResult<UploadResponse, Error> {
    return hashFile(selectedFile, (completed) => {
        onProgress({ phase: 'hashing', completed, total: selectedFile.size });
    }).andThenAsync((fileHash) =>
        planUpload(selectedFile, chunkCount, fileHash).andThenAsync((plan) =>
            uploadChunks(selectedFile, plan, email, token, onProgress, onChunk, chunkLimit)
        )
    );
}

/** One transfer pool bounds the entire selection; file failures remain independent. */
export function uploadFiles(
    files: readonly File[],
    email: string,
    token: string,
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void
): AsyncResult<void, Error> {
    return schemaResult(
        ConcurrentWorkersSchema,
        workers,
        'Invalid concurrent worker count.'
    ).andThenAsync(async (concurrency) => {
        const jobs = createUploadJobs(files);
        // Validate every file before scheduling any reads or transfers.
        const checked = files.map(checkFileSize);
        const chunkLimit = pLimit(concurrency);
        const fileLimit = pLimit(concurrency);

        await fileLimit.map(files, async (file, index) => {
            let job = jobs[index];
            const count = checked[index].match({
                Ok: (value) => value,
                Err: (error) => {
                    job = { ...job, status: 'error', message: error.message };
                    onJob(job);
                    return null;
                }
            });
            if (count === null) return;

            job = { ...job, status: 'active' };
            onJob(job);

            const uploaded = await uploadFile(
                file,
                count,
                email,
                token,
                (progress) => {
                    job = { ...job, progress };
                    onJob(job);
                },
                onChunk,
                chunkLimit
            );

            uploaded.match({
                Ok: (result) => onJob({ ...job, status: 'complete', result }),
                Err: (error) => onJob({ ...job, status: 'error', message: error.message })
            });
        });

        return Ok(undefined);
    });
}

export function fileRequest(
    chunk: UploadedChunk,
    action: 'download' | 'delete',
    token: string
): RequestInit {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            action,
            email: chunk.email,
            token,
            mediaKey: chunk.mediaKey,
            sha1: chunk.sha1
        })
    };
}

/** Attempt every known chunk, retaining failed chunks in the caller for retry. */
export function deleteFile(
    item: FileGroup,
    token: string,
    onDeleted: (chunk: UploadedChunk) => void,
    workers: number
): AsyncResult<void, Error> {
    return schemaResult(
        ConcurrentWorkersSchema,
        workers,
        'Invalid concurrent worker count.'
    ).andThenAsync(async (concurrency) => {
        const limit = pLimit(concurrency);
        const responses = await limit.map(item.chunks, (chunk) =>
            apiJson('/api/files', fileRequest(chunk, 'delete', token), 'Delete failed')
                .andThen((data) => schemaResult(DeleteResponseSchema, data, 'Delete failed'))
                .map(() => onDeleted(chunk))
        );

        let deleted: Result<void, Error> = Ok(undefined);
        for (const response of responses) deleted = deleted.andThen(() => response);

        return deleted;
    });
}

export function downloadFile(item: FileGroup, token: string): AsyncResult<Blob, Error> {
    return Ok(undefined).andThenAsync(async () => {
        if (!item.complete || item.chunkCount === null)
            return Err(new Error('Load the remaining chunks before downloading.'));

        const hash = sha256.create();
        const pieces: BlobPart[] = [];
        for (const chunk of item.chunks) {
            const received = await apiBytes(
                '/api/files',
                fileRequest(chunk, 'download', token),
                'Download failed'
            );
            const decoded = received.andThen(decodeSplitBmp).andThen(({ header, payload }) => {
                if (
                    header.fileHash !== item.fileHash ||
                    header.chunkIndex !== chunk.chunkIndex ||
                    header.flags !== Number(chunk.isLast) ||
                    (chunk.chunkIndex === 0 && header.fileName !== item.name)
                )
                    return Err(new Error('Downloaded chunks do not match this file.'));

                hash.update(payload);
                pieces.push(Uint8Array.from(payload));
                return Ok(undefined);
            });
            const failure = decoded.match({ Ok: () => null, Err: (error) => error });
            if (failure) return Err(failure);
        }

        const actualHash = Array.from(hash.digest(), (byte) =>
            byte.toString(16).padStart(2, '0')
        ).join('');

        if (actualHash !== item.fileHash)
            return Err(new Error('Reconstructed file failed SHA-256 verification.'));

        try {
            return Ok(new Blob(pieces));
        } catch {
            return Err(new Error('Could not assemble the downloaded file.'));
        }
    });
}
