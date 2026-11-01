import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileRequest, RemoteBmp, SplitHeader } from '../models';
import { SplitBmpReader } from './bmp/stream';
import { MAX_SPLIT_HEADER_BYTES, splitHeaderByteLength } from './bmp/index';
import { SERVER_ERRORS, type ServerError } from './errors';
import { downloadBmp } from './photos/index';

/** Download one chunk and check its BMP header matches what the file expects. */
export function openChunk(
    input: FileRequest,
    chunk: RemoteBmp,
    signal: AbortSignal
): AsyncResult<SplitBmpReader, ServerError> {
    const expected: SplitHeader = {
        fileHash: input.fileHash,
        fileId: input.fileId,
        chunkIndex: chunk.chunkIndex,
        flags: chunk.isLast ? 1 : 0,
        payloadSize: chunk.size,
        fileName: chunk.chunkIndex === 0 ? input.name : undefined
    };

    return splitHeaderByteLength(expected)
        .andThen((length) =>
            length <= MAX_SPLIT_HEADER_BYTES
                ? Ok(undefined)
                : Err(SERVER_ERRORS.INVALID_CHUNK_METADATA)
        )
        .andThenAsync(() =>
            downloadBmp(input.email, input.token, chunk.mediaKey, chunk.sha1, undefined, signal)
        )
        .andThenAsync((response) => SplitBmpReader.open(response, expected, chunk.sha1));
}

/** Close a chunk opened after the download was already cancelled. */
async function closeLate(opened: Result<SplitBmpReader, ServerError>): Promise<void> {
    const closed = await opened.andThenAsync((reader) => reader.close());

    closed.inspectErr((error) => console.error(error.message));
}

/** Reads chunks in file order, opening each one only when its first byte is needed. */
export class ChunkCursor {
    closed = false;
    private active: SplitBmpReader | null = null;
    private index = 0;
    private readonly abort = new AbortController();

    constructor(
        private readonly input: FileRequest,
        private readonly chunks: RemoteBmp[]
    ) {}

    get signal(): AbortSignal {
        return this.abort.signal;
    }

    /** Continue from a chunk the caller opened with this cursor's signal. */
    begin(reader: SplitBmpReader): void {
        this.active = reader;
    }

    /** The next payload block, or null after the last chunk. */
    next(): AsyncResult<Uint8Array | null, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            while (!this.closed) {
                const reader = this.active;
                if (!reader) {
                    if (this.index === this.chunks.length) return Ok(null);

                    const opened = await this.openNext();
                    if (opened.isErr()) return opened;

                    continue;
                }

                const next = await reader.readPayload();
                if (this.closed || next.isErr()) return next;

                const payload = next.unwrapOr(null);
                if (payload) return Ok(payload);

                this.active = null;
                this.index++;
            }

            return Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
        });
    }

    async close(): Promise<void> {
        this.closed = true;
        this.abort.abort();
        if (!this.active) return;

        const cancelled = await this.active.close();
        cancelled.inspectErr((error) => console.error(error.message));
        this.active = null;
    }

    private openNext(): AsyncResult<void, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            const opened = await openChunk(this.input, this.chunks[this.index], this.signal);
            opened.inspect((reader) => {
                this.active = reader;
            });
            // Closing already ran, so it could not close a reader opened meanwhile.
            if (this.closed) await closeLate(opened);

            return opened.map(() => undefined);
        });
    }
}
