import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type Result } from 'results-ts';
import { SplitHeaderSchema, type SplitHeader } from '../../models';
import { hashHex, isSplitBmp, readSplitName, readVarint } from './fields';
import {
    encodeSplitPrefix,
    BMP_HEADER_BYTES,
    SPLIT_MAGIC,
    FILE_HASH_BYTES
} from '../../bmp/format';
export {
    BMP_HEADER_BYTES,
    MAX_PHOTOS_BMP_BYTES,
    MAX_CHUNK_PAYLOAD_BYTES,
    MAX_SPLIT_HEADER_BYTES,
    splitHeaderByteLength,
    splitBmpByteLength
} from '../../bmp/format';

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

/** Read metadata from the beginning of a BMP without loading its payload. */
export function decodeSplitHeader(
    prefix: Uint8Array,
    totalSize: number
): Result<{ header: SplitHeader; payloadOffset: number }, ServerError> {
    const invalid = () => Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);
    if (!isSplitBmp(prefix, totalSize)) return invalid();

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
