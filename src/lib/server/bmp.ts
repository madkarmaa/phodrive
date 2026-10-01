import { Err, Ok, type Result } from 'results-ts';
import Varint from 'varint';
import { SplitHeaderSchema, type SplitHeader } from '$lib/models';

export const MAX_PHOTOS_BMP_BYTES = 200_000_000;
export const MAX_CHUNK_PAYLOAD_BYTES = 64_000_000;

const BMP_HEADER_BYTES = 54;
const LEGACY_SPLIT_MAGIC = new TextEncoder().encode('BMSPLIT\0');
const SPLIT_MAGIC = new TextEncoder().encode('BMSPLIT\x01');
const FILE_HASH_BYTES = 32;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function hashBytes(hash: string): Uint8Array {
    return Uint8Array.from({ length: FILE_HASH_BYTES }, (_, position) =>
        Number.parseInt(hash.slice(position * 2, position * 2 + 2), 16)
    );
}

function hashHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bmpLayout(
    length: number
): Result<{ width: number; height: number; total: number }, Error> {
    if (!Number.isSafeInteger(length) || length < 0) return Err(new Error('Invalid chunk size'));

    const width = Math.max(
        32,
        Math.ceil((Math.floor(Math.sqrt(Math.ceil(length / 3))) + 1) / 4) * 4
    );
    const stride = width * 3;
    const height = Math.max(32, Math.ceil(length / stride));
    const total = BMP_HEADER_BYTES + stride * height;

    if (total > MAX_PHOTOS_BMP_BYTES || width > 0x7fffffff || height > 0x7fffffff)
        return Err(new Error('Chunk would exceed the 200 MB photo limit'));

    return Ok({ width, height, total });
}

function readVarint(
    data: Uint8Array,
    start: number
): Result<{ value: number; next: number }, Error> {
    try {
        const value = Varint.decode(data, start);
        const length = Varint.decode.bytes;

        if (
            !Number.isSafeInteger(value) ||
            value < 0 ||
            length === undefined ||
            length !== Varint.encodingLength(value)
        )
            return Err(new Error('Invalid chunk varint'));

        return Ok({ value, next: start + length });
    } catch {
        return Err(new Error('Invalid chunk varint'));
    }
}

/** Exact projected BMP size before a file slice is read. */
export function splitBmpByteLength(input: SplitHeader): Result<number, Error> {
    const parsed = SplitHeaderSchema.safeParse(input);
    if (!parsed.success) return Err(new Error('Invalid chunk metadata'));

    const header = parsed.data;
    const nameBytes = header.fileName
        ? new TextEncoder().encode(header.fileName)
        : new Uint8Array();
    const contentLength =
        SPLIT_MAGIC.length +
        FILE_HASH_BYTES +
        (header.fileId ? FILE_HASH_BYTES : 0) +
        Varint.encodingLength(header.chunkIndex) +
        1 +
        Varint.encodingLength(header.payloadSize) +
        (header.chunkIndex === 0 ? Varint.encodingLength(nameBytes.length) + nameBytes.length : 0) +
        header.payloadSize;

    return bmpLayout(contentLength).map(({ total }) => total);
}

/** Encode one chunk; the Zod schema is the source of truth for its metadata shape. */
export function encodeSplitBmp(
    payload: Uint8Array,
    input: SplitHeader
): Result<Uint8Array<ArrayBuffer>, Error> {
    const parsed = SplitHeaderSchema.safeParse(input);
    if (!parsed.success || parsed.data.payloadSize !== payload.length)
        return Err(new Error('Invalid chunk metadata'));

    const header = parsed.data;
    const identity = header.fileId ? hashBytes(header.fileId) : new Uint8Array();
    const magic = header.fileId ? SPLIT_MAGIC : LEGACY_SPLIT_MAGIC;
    const fileName = header.fileName ? new TextEncoder().encode(header.fileName) : new Uint8Array();
    const index = Uint8Array.from(Varint.encode(header.chunkIndex));
    const size = Uint8Array.from(Varint.encode(header.payloadSize));
    const nameLength =
        header.chunkIndex === 0
            ? Uint8Array.from(Varint.encode(fileName.length))
            : new Uint8Array();
    const contentLength =
        SPLIT_MAGIC.length +
        FILE_HASH_BYTES +
        identity.length +
        index.length +
        1 +
        size.length +
        nameLength.length +
        fileName.length +
        payload.length;

    return bmpLayout(contentLength).andThen(({ width, height, total }) => {
        let bmp: Uint8Array<ArrayBuffer>;

        try {
            bmp = new Uint8Array(total);
        } catch {
            return Err(new Error('Not enough memory to create BMP'));
        }

        const view = new DataView(bmp.buffer);
        bmp.set([66, 77]);
        view.setUint32(2, total, true);
        view.setUint32(10, BMP_HEADER_BYTES, true);
        view.setUint32(14, 40, true);
        view.setUint32(18, width, true);
        view.setUint32(22, height, true);
        view.setUint16(26, 1, true);
        view.setUint16(28, 24, true);
        view.setUint32(34, total - BMP_HEADER_BYTES, true);

        let offset = BMP_HEADER_BYTES;

        for (const bytes of [
            magic,
            hashBytes(header.fileHash),
            identity,
            index,
            Uint8Array.of(header.flags),
            size,
            nameLength,
            fileName,
            payload
        ]) {
            bmp.set(bytes, offset);
            offset += bytes.length;
        }

        return Ok(bmp);
    });
}

function readSplitName(
    prefix: Uint8Array,
    offset: number,
    chunkIndex: number
): Result<{ fileName: string | undefined; payloadOffset: number }, Error> {
    if (chunkIndex !== 0) return Ok({ fileName: undefined, payloadOffset: offset });

    return readVarint(prefix, offset).andThen((length) => {
        if (length.value > prefix.length - length.next)
            return Err(new Error('Downloaded BMP is invalid or damaged'));

        const payloadOffset = length.next + length.value;
        try {
            const fileName = UTF8.decode(prefix.subarray(length.next, payloadOffset));
            return Ok({ fileName, payloadOffset });
        } catch {
            return Err(new Error('Downloaded BMP is invalid or damaged'));
        }
    });
}

/** Read metadata from the beginning of a BMP without loading its payload. */
export function decodeSplitHeader(
    prefix: Uint8Array,
    totalSize: number
): Result<{ header: SplitHeader; payloadOffset: number }, Error> {
    const invalid = () => Err(new Error('Downloaded BMP is invalid or damaged'));
    if (prefix.length < BMP_HEADER_BYTES + SPLIT_MAGIC.length + FILE_HASH_BYTES + 3)
        return invalid();

    const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    const width = view.getInt32(18, true);
    const height = view.getInt32(22, true);
    const hasIdentity = SPLIT_MAGIC.every(
        (byte, index) => prefix[BMP_HEADER_BYTES + index] === byte
    );
    const magic = hasIdentity ? SPLIT_MAGIC : LEGACY_SPLIT_MAGIC;

    if (
        hasIdentity &&
        prefix.length < BMP_HEADER_BYTES + SPLIT_MAGIC.length + 2 * FILE_HASH_BYTES + 3
    )
        return invalid();

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
        magic.some((byte, index) => prefix[BMP_HEADER_BYTES + index] !== byte)
    )
        return invalid();

    let offset = BMP_HEADER_BYTES + SPLIT_MAGIC.length;
    const fileHash = hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES));
    offset += FILE_HASH_BYTES;
    const fileId = hasIdentity
        ? hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES))
        : undefined;
    if (hasIdentity) offset += FILE_HASH_BYTES;

    const metadata = readVarint(prefix, offset).andThen((index) => {
        if (index.next >= prefix.length) return invalid();

        const flags = prefix[index.next];
        return readVarint(prefix, index.next + 1).map((size) => ({
            fileHash,
            ...(fileId ? { fileId } : {}),
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
        .andThen(({ payloadOffset, ...header }) => {
            if (header.payloadSize > totalSize - payloadOffset) return invalid();

            const parsed = SplitHeaderSchema.safeParse(header);
            if (!parsed.success) return Err(new Error('Invalid chunk metadata'));

            return Ok({ header: parsed.data, payloadOffset });
        });
}

/** Parse a complete chunk and reject damaged payload bounds or nonzero padding. */
export function decodeSplitBmp(
    bmp: Uint8Array
): Result<{ header: SplitHeader; payload: Uint8Array }, Error> {
    return decodeSplitHeader(bmp, bmp.length).andThen(({ header, payloadOffset }) => {
        const payloadEnd = payloadOffset + header.payloadSize;
        if (bmp.subarray(payloadEnd).some(Boolean))
            return Err(new Error('Downloaded BMP is invalid or damaged'));

        return Ok({ header, payload: bmp.subarray(payloadOffset, payloadEnd) });
    });
}
