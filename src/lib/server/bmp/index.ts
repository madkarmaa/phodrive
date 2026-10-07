import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { Err, Ok, type Result } from 'results-ts';
import Varint from 'varint';
import { SplitHeaderSchema, type SplitHeader } from '$lib/models';
import { encodeSplitPrefix, BMP_HEADER_BYTES, SPLIT_MAGIC, FILE_HASH_BYTES } from '$lib/bmp/format';
export {
    MAX_PHOTOS_BMP_BYTES,
    MAX_CHUNK_PAYLOAD_BYTES,
    MAX_SPLIT_HEADER_BYTES,
    splitHeaderByteLength,
    splitBmpByteLength
} from '$lib/bmp/format';

const UTF8 = new TextDecoder('utf-8', { fatal: true });

function hashHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readVarint(
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

/** Encode a complete BMP for protocol fixtures and compatibility checks. */
export function encodeSplitBmp(
    payload: Uint8Array,
    input: SplitHeader
): Result<Uint8Array<ArrayBuffer>, ServerError> {
    if (input.payloadSize !== payload.length) return Err(SERVER_ERRORS.INVALID_CHUNK_METADATA);

    return encodeSplitPrefix(input).andThen(({ prefix, totalSize }) => {
        let bmp: Uint8Array<ArrayBuffer>;

        try {
            bmp = new Uint8Array(totalSize);
        } catch {
            return Err(SERVER_ERRORS.BMP_ALLOCATION_FAILED);
        }
        bmp.set(prefix);
        bmp.set(payload, prefix.length);

        return Ok(bmp);
    });
}

function readSplitName(
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

/** Read metadata from the beginning of a BMP without loading its payload. */
export function decodeSplitHeader(
    prefix: Uint8Array,
    totalSize: number
): Result<{ header: SplitHeader; payloadOffset: number }, ServerError> {
    const invalid = () => Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);
    if (prefix.length < BMP_HEADER_BYTES + SPLIT_MAGIC.length + 2 * FILE_HASH_BYTES + 3)
        return invalid();

    const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    const width = view.getInt32(18, true);
    const height = view.getInt32(22, true);
    if (
        prefix[0] !== 66 ||
        prefix[1] !== 77 ||
        view.getUint32(2, true) !== totalSize ||
        view.getUint32(10, true) !== BMP_HEADER_BYTES ||
        view.getUint32(14, true) !== 40 ||
        view.getUint16(26, true) !== 1 ||
        view.getUint16(28, true) !== 24 ||
        view.getUint32(30, true) !== 0 ||
        width < 32 ||
        height < 32 ||
        width % 4 !== 0 ||
        width * 3 * height !== totalSize - BMP_HEADER_BYTES ||
        view.getUint32(34, true) !== totalSize - BMP_HEADER_BYTES ||
        SPLIT_MAGIC.some((byte, index) => prefix[BMP_HEADER_BYTES + index] !== byte)
    )
        return invalid();

    let offset = BMP_HEADER_BYTES + SPLIT_MAGIC.length;
    const fileHash = hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES));
    offset += FILE_HASH_BYTES;

    const fileId = hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES));
    offset += FILE_HASH_BYTES;

    const metadata = readVarint(prefix, offset).andThen((index) => {
        if (index.next >= prefix.length) return invalid();

        const flags = prefix[index.next];

        return readVarint(prefix, index.next + 1).map((size) => ({
            fileHash,
            fileId,
            chunkIndex: index.value,
            flags,
            payloadSize: size.value,
            payloadOffset: size.next
        }));
    });

    return metadata
        .andThen((header) =>
            readSplitName(prefix, header.payloadOffset, header.chunkIndex).map((name) => ({
                ...header,
                ...name
            }))
        )
        .andThen(
            ({
                payloadOffset,
                ...header
            }): Result<{ header: SplitHeader; payloadOffset: number }, ServerError> => {
                if (header.payloadSize > totalSize - payloadOffset) return invalid();

                const parsed = SplitHeaderSchema.safeParse(header);
                if (!parsed.success) return Err(SERVER_ERRORS.INVALID_CHUNK_METADATA);

                return Ok({ header: parsed.data, payloadOffset });
            }
        );
}

/** Parse a complete chunk and reject damaged payload bounds or nonzero padding. */
export function decodeSplitBmp(
    bmp: Uint8Array
): Result<{ header: SplitHeader; payload: Uint8Array }, ServerError> {
    return decodeSplitHeader(bmp, bmp.length).andThen(({ header, payloadOffset }) => {
        const payloadEnd = payloadOffset + header.payloadSize;
        if (bmp.subarray(payloadEnd).some(Boolean))
            return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

        return Ok({ header, payload: bmp.subarray(payloadOffset, payloadEnd) });
    });
}
