import { Err, Ok, type Result } from 'results-ts';
import Varint from 'varint';
import { BMP_HEADER_BYTES, FILE_HASH_BYTES, SPLIT_MAGIC } from '../../bmp/format';
import { SERVER_ERRORS, type ServerError } from '../errors';

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** A 24-bit bottom-up bitmap of the declared size whose pixels start with the split magic. */
export function isSplitBmp(prefix: Uint8Array, totalSize: number): boolean {
    if (prefix.length < BMP_HEADER_BYTES + SPLIT_MAGIC.length + 2 * FILE_HASH_BYTES + 3)
        return false;

    const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    const width = view.getInt32(18, true);
    const height = view.getInt32(22, true);
    const pixelBytes = totalSize - BMP_HEADER_BYTES;

    return (
        prefix[0] === 66 &&
        prefix[1] === 77 &&
        view.getUint32(2, true) === totalSize &&
        view.getUint32(10, true) === BMP_HEADER_BYTES &&
        view.getUint32(14, true) === 40 &&
        view.getUint16(26, true) === 1 &&
        view.getUint16(28, true) === 24 &&
        view.getUint32(30, true) === 0 &&
        width >= 32 &&
        height >= 32 &&
        width % 4 === 0 &&
        width * 3 * height === pixelBytes &&
        view.getUint32(34, true) === pixelBytes &&
        SPLIT_MAGIC.every((byte, index) => prefix[BMP_HEADER_BYTES + index] === byte)
    );
}

export function hashHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readVarint(
    data: Uint8Array,
    start: number
): Result<{ value: number; next: number }, ServerError> {
    try {
        const value = Varint.decode(data, start);
        const length = Varint.decode.bytes;

        if (
            !Number.isSafeInteger(value) ||
            value < 0 ||
            length === undefined ||
            length !== Varint.encodingLength(value)
        )
            return Err(SERVER_ERRORS.INVALID_CHUNK_VARINT);

        return Ok({ value, next: start + length });
    } catch {
        return Err(SERVER_ERRORS.INVALID_CHUNK_VARINT);
    }
}

export function readSplitName(
    prefix: Uint8Array,
    offset: number,
    chunkIndex: number
): Result<{ fileName: string | undefined; payloadOffset: number }, ServerError> {
    if (chunkIndex !== 0) return Ok({ fileName: undefined, payloadOffset: offset });

    return readVarint(prefix, offset).andThen((length) => {
        if (length.value > prefix.length - length.next)
            return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

        const payloadOffset = length.next + length.value;

        try {
            const fileName = UTF8.decode(prefix.subarray(length.next, payloadOffset));

            return Ok({ fileName, payloadOffset });
        } catch {
            return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);
        }
    });
}
