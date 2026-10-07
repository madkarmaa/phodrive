import { Ok, type Result } from 'results-ts';
import type { SplitHeader, UploadFile } from '#lib/models';
import type { BmpError } from '#lib/bmp/errors';
import { MAX_CHUNK_PAYLOAD_BYTES, splitBmpByteLength } from '#lib/bmp/format';

export type UploadPlan = { headers: SplitHeader[]; sizes: number[] };

export function chunkCount(size: number): number {
    return Math.max(1, Math.ceil(size / MAX_CHUNK_PAYLOAD_BYTES));
}

/** Callers validate the file and index before constructing its deterministic split metadata. */
export function chunkHeader(file: UploadFile, fileId: string, chunkIndex: number): SplitHeader {
    return {
        fileHash: file.fileHash,
        fileId,
        chunkIndex,
        flags: chunkIndex === chunkCount(file.size) - 1 ? 1 : 0,
        payloadSize: Math.min(
            MAX_CHUNK_PAYLOAD_BYTES,
            file.size - chunkIndex * MAX_CHUNK_PAYLOAD_BYTES
        ),
        fileName: chunkIndex === 0 ? file.name : undefined
    };
}

/** Project transfer sizes without reading or buffering the original file. */
export function planChunks(file: UploadFile, fileId: string): Result<UploadPlan, BmpError> {
    const count = chunkCount(file.size);
    const headers: SplitHeader[] = [];
    const sizes: number[] = [];
    for (let index = 0; index < count; index++) {
        const header = chunkHeader(file, fileId, index);
        const projected = splitBmpByteLength(header);
        if (projected.isErr()) return projected;

        projected.inspect((size) => sizes.push(size));
        headers.push(header);
    }

    return Ok({ headers, sizes });
}
