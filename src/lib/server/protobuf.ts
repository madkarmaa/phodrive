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

export function parse(data: Uint8Array): Result<Field[], Error> {
    const fields: Field[] = [];
    let offset = 0;

    function readVarint(): Result<number, Error> {
        try {
            const value = Varint.decode(data, offset);
            const length = Varint.decode.bytes;

            if (!Number.isSafeInteger(value) || value < 0 || length === undefined)
                return Err(new Error('Oversized protobuf integer'));

            offset += length;
            return Ok(value);
        } catch {
            return Err(new Error('Invalid protobuf integer'));
        }
    }

    while (offset < data.length) {
        const next = readVarint().andThen<Field | null, Error>((tag) => {
            const number = Math.floor(tag / 8);
            const wire = tag % 8;
            if (!number) return Err(new Error('Invalid protobuf field'));

            if (wire === 0) return readVarint().map((value): Field | null => ({ number, value }));

            if (wire === 2)
                return readVarint().andThen<Field | null, Error>((length) => {
                    if (offset + length > data.length)
                        return Err(new Error('Truncated protobuf field'));

                    const value = Buffer.from(data.subarray(offset, offset + length));
                    offset += length;
                    return Ok<Field | null>({ number, value });
                });

            if (wire !== 1 && wire !== 5) return Err(new Error('Unsupported protobuf field'));

            offset += wire === 1 ? 8 : 4;
            if (offset > data.length) return Err(new Error('Truncated protobuf field'));

            return Ok<Field | null>(null);
        });
        if (next.isErr()) return next;
        next.inspect((field) => {
            if (field) fields.push(field);
        });
    }

    return Ok(fields);
}

function one(fields: Field[], number: number): Result<Field, Error> {
    const matches = fields.filter((field) => field.number === number);
    if (matches.length !== 1) return Err(new Error('Missing or ambiguous protobuf field'));

    return Ok(matches[0]);
}

export function bytes(fields: Field[], number: number): Result<Buffer, Error> {
    return one(fields, number).andThen(({ value }) =>
        typeof value === 'number' ? Err(new Error('Invalid protobuf field type')) : Ok(value)
    );
}

export function nested(data: Buffer, ...path: number[]): Result<Buffer, Error> {
    return path.reduce<Result<Buffer, Error>>(
        (current, field) => current.andThen(parse).andThen((fields) => bytes(fields, field)),
        Ok(data)
    );
}

export function integer(fields: Field[], number: number): Result<number, Error> {
    return one(fields, number).andThen(({ value }) =>
        typeof value !== 'number' ? Err(new Error('Invalid protobuf field type')) : Ok(value)
    );
}

export function utf8(value: Buffer): Result<string, Error> {
    try {
        return Ok(DECODER.decode(value));
    } catch {
        return Err(new Error('Invalid UTF-8 in response'));
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
