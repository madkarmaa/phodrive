import { SERVER_ERRORS, type ServerError } from '#server/errors';
import { Err, Ok, type Result } from 'results-ts';
import Varint from 'varint';

const DECODER = new TextDecoder('utf-8', { fatal: true });

function varint(value: number): Buffer {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid protobuf integer');

    return Buffer.from(Varint.encode(value));
}

export function numberField(field: number, value: number): Buffer {
    return Buffer.concat([varint(field * 8), varint(value)]);
}

export function bytesField(field: number, value: Uint8Array | string): Buffer {
    const bytes = Buffer.from(value);

    return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}

export function message(...fields: Buffer[]): Buffer {
    return Buffer.concat(fields);
}

export function bodyBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
    const backing = buffer.buffer;

    return backing instanceof ArrayBuffer
        ? new Uint8Array(backing, buffer.byteOffset, buffer.byteLength)
        : Uint8Array.from(buffer);
}

export type Field = { number: number; value: number | Buffer };

export function parse(data: Uint8Array): Result<Field[], ServerError> {
    const fields: Field[] = [];
    let offset = 0;

    function readVarint(): Result<number, ServerError> {
        try {
            const value = Varint.decode(data, offset);
            const length = Varint.decode.bytes;

            if (!Number.isSafeInteger(value) || value < 0 || length === undefined)
                return Err(SERVER_ERRORS.OVERSIZED_PROTOBUF_INTEGER);

            offset += length;

            return Ok(value);
        } catch {
            return Err(SERVER_ERRORS.INVALID_PROTOBUF_INTEGER);
        }
    }

    while (offset < data.length) {
        const next = readVarint().andThen<Field | null, ServerError>((tag) => {
            const number = Math.floor(tag / 8);
            const wire = tag % 8;
            if (!number) return Err(SERVER_ERRORS.INVALID_PROTOBUF_FIELD);

            if (wire === 0) return readVarint().map((value): Field | null => ({ number, value }));

            if (wire === 2)
                return readVarint().andThen<Field | null, ServerError>((length) => {
                    if (offset + length > data.length)
                        return Err(SERVER_ERRORS.TRUNCATED_PROTOBUF_FIELD);

                    const value = Buffer.from(data.subarray(offset, offset + length));
                    offset += length;

                    return Ok<Field | null>({ number, value });
                });

            if (wire !== 1 && wire !== 5) return Err(SERVER_ERRORS.UNSUPPORTED_PROTOBUF_FIELD);

            offset += wire === 1 ? 8 : 4;
            if (offset > data.length) return Err(SERVER_ERRORS.TRUNCATED_PROTOBUF_FIELD);

            return Ok<Field | null>(null);
        });
        if (next.isErr()) return next;

        next.inspect((field) => {
            if (field) fields.push(field);
        });
    }

    return Ok(fields);
}

function one(fields: Field[], number: number): Result<Field, ServerError> {
    const matches = fields.filter((field) => field.number === number);
    if (matches.length !== 1) return Err(SERVER_ERRORS.MISSING_OR_AMBIGUOUS_PROTOBUF_FIELD);

    return Ok(matches[0]);
}

export function bytes(fields: Field[], number: number): Result<Buffer, ServerError> {
    return one(fields, number).andThen(({ value }) =>
        typeof value === 'number' ? Err(SERVER_ERRORS.INVALID_PROTOBUF_FIELD_TYPE) : Ok(value)
    );
}

export function nested(data: Buffer, ...path: number[]): Result<Buffer, ServerError> {
    return path.reduce<Result<Buffer, ServerError>>(
        (current, field) => current.andThen(parse).andThen((fields) => bytes(fields, field)),
        Ok(data)
    );
}

export function integer(fields: Field[], number: number): Result<number, ServerError> {
    return one(fields, number).andThen(({ value }) =>
        typeof value !== 'number' ? Err(SERVER_ERRORS.INVALID_PROTOBUF_FIELD_TYPE) : Ok(value)
    );
}

export function utf8(value: Buffer): Result<string, ServerError> {
    try {
        return Ok(DECODER.decode(value));
    } catch {
        return Err(SERVER_ERRORS.INVALID_UTF_8_IN_RESPONSE);
    }
}

export function optional(fields: Field[], number: number): Field | undefined {
    return fields.find((field) => field.number === number);
}

export function encodeFields(fields: Field[]): Buffer {
    return message(
        ...fields.map((field) =>
            typeof field.value === 'number'
                ? numberField(field.number, field.value)
                : bytesField(field.number, field.value)
        )
    );
}
