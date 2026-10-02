import { SERVER_ERRORS, type ServerError } from '$server/errors';
import Busboy, { type BusboyFileStream } from '@fastify/busboy';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadRequestSchema } from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import { createTemporaryDirectory, removeTemporaryDirectory } from '$server/temporary-files';

const MAX_UPLOAD_FIELD_BYTES = 64 * 1024;
const MAX_UPLOAD_HEADER_BYTES = 16 * 1024;

export interface ReceivedFile {
    name: string;
    path: string;
    size: number;
    fileHash: string;
}

export interface ReceivedUpload {
    email: string;
    token: string;
    workers: number;
    files: ReceivedFile[];
    directory: string;
}

async function* requestBytes(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) return;

            yield next.value;
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

function saveFile(
    stream: BusboyFileStream,
    name: string,
    path: string
): AsyncResult<ReceivedFile, ServerError> {
    return Ok(undefined).andThenAsync<ReceivedFile, ServerError>(async () => {
        const hash = createHash('sha256');
        let size = 0;
        const hashing = new Transform({
            transform(bytes: Buffer, _encoding, callback) {
                size += bytes.length;
                hash.update(bytes);
                callback(null, bytes);
            }
        });

        try {
            await pipeline(stream, hashing, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
        } catch {
            return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
        }

        if (stream.truncated || !Number.isSafeInteger(size))
            return Err(SERVER_ERRORS.FILE_TOO_LARGE);

        return Ok({ name, path, size, fileHash: hash.digest('hex') });
    });
}

function receiveMultipartUpload(
    request: Request,
    directory: string
): AsyncResult<ReceivedUpload, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const contentType = request.headers.get('content-type');
        if (!request.body || !contentType?.startsWith('multipart/form-data'))
            return Err(SERVER_ERRORS.UPLOAD_INPUT_REQUIRED);

        let parser: InstanceType<typeof Busboy>;
        let source: Readable;
        try {
            parser = new Busboy({
                headers: { 'content-type': contentType },
                preservePath: true,
                limits: {
                    fields: 3,
                    fieldSize: MAX_UPLOAD_FIELD_BYTES,
                    headerSize: MAX_UPLOAD_HEADER_BYTES
                }
            });
            source = Readable.from(requestBytes(request.body));
        } catch {
            return Err(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);
        }

        const fields = new Map<string, string>();
        const active = new Set<BusboyFileStream>();
        const pending: PromiseLike<Result<ReceivedFile, ServerError>>[] = [];
        let failure: ServerError | null = null;

        parser.on('field', (key, value, nameTruncated, valueTruncated) => {
            if (
                nameTruncated ||
                valueTruncated ||
                fields.has(key) ||
                !['email', 'token', 'workers'].includes(key)
            ) {
                failure ??= SERVER_ERRORS.INVALID_UPLOAD_REQUEST;
                return;
            }

            fields.set(key, value);
        });
        parser.on('fieldsLimit', () => {
            failure ??= SERVER_ERRORS.INVALID_UPLOAD_REQUEST;
        });
        parser.on('file', (key, stream, name) => {
            if (key !== 'file' || !name || /[\\/\r\n\0]/.test(name)) {
                failure ??= SERVER_ERRORS.INVALID_UPLOAD_FILE_NAME;
                stream.resume();
                return;
            }

            active.add(stream);
            const saved = saveFile(
                stream,
                name,
                join(directory, String(pending.length))
            ).inspectErr((error) => {
                failure ??= error;
                parser.destroy(new Error(error.message));
            });
            pending.push(Promise.resolve(saved));
            stream.once('close', () => active.delete(stream));
        });

        try {
            await pipeline(source, parser);
        } catch {
            failure ??= SERVER_ERRORS.FILE_RECEIVE_FAILEDS;
            for (const stream of active) stream.destroy();
        }

        const saved = await Promise.all(pending);
        if (failure) return Err(failure);
        if (saved.length === 0) return Err(SERVER_ERRORS.FILES_REQUIRED);

        const files: ReceivedFile[] = [];
        for (const result of saved) {
            if (result.isErr()) return result;

            result.inspect((file) => files.push(file));
        }

        return schemaResult(
            UploadRequestSchema,
            {
                email: fields.get('email')?.trim(),
                token: fields.get('token')?.trim(),
                workers: Number(fields.get('workers'))
            },
            'Enter a valid account and worker count.'
        )
            .mapErr(() => SERVER_ERRORS.INVALID_UPLOAD_CREDENTIALS)
            .map((credentials) => ({ ...credentials, files, directory }));
    });
}

/** Credentials live only in this request; raw bytes are spooled with bounded stream buffers. */
export function receiveUpload(request: Request): AsyncResult<ReceivedUpload, ServerError> {
    return createTemporaryDirectory().andThenAsync(async (directory) => {
        const received = await receiveMultipartUpload(request, directory);
        if (received.isOk()) return received;

        const removed = await removeTemporaryDirectory(directory);
        return removed.andThen(() => received);
    });
}
