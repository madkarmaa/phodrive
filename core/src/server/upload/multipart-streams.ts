import { Busboy, type BusboyFileStream } from '@fastify/busboy';
import { Readable } from 'node:stream';
import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';

const MAX_UPLOAD_FIELD_BYTES = 64 * 1024;
const MAX_UPLOAD_HEADER_BYTES = 16 * 1024;

export type Parser = InstanceType<typeof Busboy>;

export function payloadStream(stream: BusboyFileStream): ReadableStream<Uint8Array> {
    const iterator = stream[Symbol.asyncIterator]();

    return new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                let next: IteratorResult<unknown>;

                try {
                    next = await iterator.next();
                } catch {
                    controller.error(SERVER_ERRORS.FILE_RECEIVE_FAILED);

                    return;
                }
                if (next.done) {
                    controller.close();

                    return;
                }
                if (!(next.value instanceof Uint8Array)) {
                    controller.error(SERVER_ERRORS.FILE_RECEIVE_FAILED);

                    return;
                }

                controller.enqueue(next.value);
            },
            cancel() {
                stream.destroy();
            }
        },
        { highWaterMark: 0 }
    );
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

/** A parser that accepts one metadata field and one file part, fed from the request body. */
export function openParser(
    body: ReadableStream<Uint8Array>,
    contentType: string,
    maxFileBytes: number
): Result<{ parser: Parser; source: Readable }, ServerError> {
    try {
        const parser = new Busboy({
            headers: { 'content-type': contentType },
            preservePath: true,
            limits: {
                fields: 1,
                files: 1,
                parts: 2,
                fieldSize: MAX_UPLOAD_FIELD_BYTES,
                headerSize: MAX_UPLOAD_HEADER_BYTES,
                fileSize: maxFileBytes
            }
        });
        const source = Readable.from(requestBytes(body), {
            objectMode: false,
            highWaterMark: 64 * 1024
        });

        return Ok({ parser, source });
    } catch {
        return Err(SERVER_ERRORS.INVALID_UPLOAD_REQUEST);
    }
}
