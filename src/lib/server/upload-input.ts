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
): AsyncResult<ReceivedFile, Error> {
    return Ok(undefined).andThenAsync(async () => {
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
            return Err(new Error('Could not receive the selected file.'));
        }

        if (stream.truncated || !Number.isSafeInteger(size))
            return Err(new Error('File is too large.'));

        return Ok({ name, path, size, fileHash: hash.digest('hex') });
    });
}

function receiveMultipartUpload(
    request: Request,
    directory: string
): AsyncResult<ReceivedUpload, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const contentType = request.headers.get('content-type');
        if (!request.body || !contentType?.startsWith('multipart/form-data'))
            return Err(new Error('Choose files and enter your account credentials.'));

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
            return Err(new Error('Invalid upload request.'));
        }

        const fields = new Map<string, string>();
        const active = new Set<BusboyFileStream>();
        const pending: PromiseLike<Result<ReceivedFile, Error>>[] = [];
        let failure: Error | null = null;

        parser.on('field', (key, value, nameTruncated, valueTruncated) => {
            if (
                nameTruncated ||
                valueTruncated ||
                fields.has(key) ||
                !['email', 'token', 'workers'].includes(key)
            ) {
                failure ??= new Error('Invalid upload request.');
                return;
            }

            fields.set(key, value);
        });
        parser.on('fieldsLimit', () => {
            failure ??= new Error('Invalid upload request.');
        });
        parser.on('file', (key, stream, name) => {
            if (key !== 'file' || !name || /[\\/\r\n\0]/.test(name)) {
                failure ??= new Error('Invalid file name.');
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
                parser.destroy(error);
            });
            pending.push(Promise.resolve(saved));
            stream.once('close', () => active.delete(stream));
        });

        try {
            await pipeline(source, parser);
        } catch {
            failure ??= new Error('Could not receive the selected files.');
            for (const stream of active) stream.destroy();
        }

        const saved = await Promise.all(pending);
        if (failure) return Err(failure);
        if (saved.length === 0) return Err(new Error('Choose at least one file.'));

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
        ).map((credentials) => ({ ...credentials, files, directory }));
    });
}

/** Credentials live only in this request; raw bytes are spooled with bounded stream buffers. */
export function receiveUpload(request: Request): AsyncResult<ReceivedUpload, Error> {
    return createTemporaryDirectory().andThenAsync(async (directory) => {
        const received = await receiveMultipartUpload(request, directory);
        if (received.isOk()) return received;

        const removed = await removeTemporaryDirectory(directory);
        return removed.andThen(() => received);
    });
}
