import { BMP_ERRORS } from '$lib/bmp/errors';
import type { BmpError } from '$lib/bmp/errors';
import { Err, Ok, type Result } from 'results-ts';
import Varint from 'varint';
import { SplitHeaderSchema, type SplitHeader } from '$lib/models';

export const MAX_PHOTOS_BMP_BYTES = 200_000_000;
export const MAX_CHUNK_PAYLOAD_BYTES = 195_000_000;
export const MAX_SPLIT_HEADER_BYTES = 65_536;

export const BMP_HEADER_BYTES = 54;
export const SPLIT_MAGIC = new TextEncoder().encode('BMSPLIT\x01');
export const FILE_HASH_BYTES = 32;

function writeHashBytes(target: Uint8Array, offset: number, hash: string): void {
    for (let position = 0; position < FILE_HASH_BYTES; position++)
        target[offset + position] = Number.parseInt(hash.slice(position * 2, position * 2 + 2), 16);
}

function bmpLayout(
    length: number
): Result<{ width: number; height: number; total: number }, BmpError> {
    if (!Number.isSafeInteger(length) || length < 0) return Err(BMP_ERRORS.INVALID_CHUNK_SIZE);

    const width = Math.max(
        32,
        Math.ceil((Math.floor(Math.sqrt(Math.ceil(length / 3))) + 1) / 4) * 4
    );
    const stride = width * 3;
    const height = Math.max(32, Math.ceil(length / stride));
    const total = BMP_HEADER_BYTES + stride * height;

    if (total > MAX_PHOTOS_BMP_BYTES || width > 0x7fffffff || height > 0x7fffffff)
        return Err(BMP_ERRORS.CHUNK_TOO_LARGE);

    return Ok({ width, height, total });
}

function splitHeaderLayout(
    input: SplitHeader
): Result<{ prefixSize: number; nameBytes: Uint8Array }, BmpError> {
    const parsed = SplitHeaderSchema.safeParse(input);
    if (!parsed.success) return Err(BMP_ERRORS.INVALID_CHUNK_METADATA);

    const header = parsed.data;
    const nameBytes = header.fileName
        ? new TextEncoder().encode(header.fileName)
        : new Uint8Array();
    const prefixSize =
        BMP_HEADER_BYTES +
        SPLIT_MAGIC.length +
        FILE_HASH_BYTES +
        FILE_HASH_BYTES +
        Varint.encodingLength(header.chunkIndex) +
        1 +
        Varint.encodingLength(header.payloadSize) +
        (header.chunkIndex === 0 ? Varint.encodingLength(nameBytes.length) + nameBytes.length : 0);

    return Ok({ prefixSize, nameBytes });
}

/** Exact prefix size, including the BMP header, before the payload begins. */
export function splitHeaderByteLength(input: SplitHeader): Result<number, BmpError> {
    return splitHeaderLayout(input).map(({ prefixSize }) => prefixSize);
}

/** Exact projected BMP size before a file slice is read. */
export function splitBmpByteLength(input: SplitHeader): Result<number, BmpError> {
    return splitHeaderByteLength(input).andThen((length) =>
        bmpLayout(length - BMP_HEADER_BYTES + input.payloadSize).map(({ total }) => total)
    );
}

/** Encode only the header; payload and zero padding can be emitted incrementally. */
export function encodeSplitPrefix(input: SplitHeader): Result<
    {
        prefix: Uint8Array<ArrayBuffer>;
        totalSize: number;
        paddingSize: number;
    },
    BmpError
> {
    return splitHeaderLayout(input).andThen(({ prefixSize, nameBytes }) => {
        if (prefixSize > MAX_SPLIT_HEADER_BYTES) return Err(BMP_ERRORS.INVALID_CHUNK_METADATA);

        return bmpLayout(prefixSize - BMP_HEADER_BYTES + input.payloadSize).map(
            ({ width, height, total }) => {
                const prefix = new Uint8Array(prefixSize);
                const view = new DataView(prefix.buffer);
                prefix.set([66, 77]);
                view.setUint32(2, total, true);
                view.setUint32(10, BMP_HEADER_BYTES, true);
                view.setUint32(14, 40, true);
                view.setUint32(18, width, true);
                view.setUint32(22, height, true);
                view.setUint16(26, 1, true);
                view.setUint16(28, 24, true);
                view.setUint32(34, total - BMP_HEADER_BYTES, true);

                let offset = BMP_HEADER_BYTES;
                prefix.set(SPLIT_MAGIC, offset);
                offset += SPLIT_MAGIC.length;
                writeHashBytes(prefix, offset, input.fileHash);
                offset += FILE_HASH_BYTES;
                writeHashBytes(prefix, offset, input.fileId);
                offset += FILE_HASH_BYTES;

                Varint.encode(input.chunkIndex, prefix, offset);
                offset += Varint.encodingLength(input.chunkIndex);
                prefix[offset] = input.flags;
                offset++;
                Varint.encode(input.payloadSize, prefix, offset);
                offset += Varint.encodingLength(input.payloadSize);

                if (input.chunkIndex === 0) {
                    Varint.encode(nameBytes.length, prefix, offset);
                    offset += Varint.encodingLength(nameBytes.length);
                    prefix.set(nameBytes, offset);
                }

                return {
                    prefix,
                    totalSize: total,
                    paddingSize: total - prefixSize - input.payloadSize
                };
            }
        );
    });
}
