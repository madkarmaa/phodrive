import { expect, test } from 'vitest';
import { bytes, bytesField, message, nested, numberField, parse } from '#server/protobuf';

test('nested protobuf fields respect nonzero backing offsets and keep all sibling validation', () => {
    const encoded = message(bytesField(1, bytesField(2, 'value')), numberField(3, 7));
    const backing = Buffer.concat([Buffer.alloc(19, 255), encoded, Buffer.alloc(11, 255)]);
    const input = backing.subarray(19, 19 + encoded.length);
    const result = nested(input, 1, 2).unwrap();
    expect(result.toString()).toBe('value');
    expect(parse(input).unwrap()).toHaveLength(2);

    const malformedSibling = Buffer.concat([input, Buffer.from([0x22, 0x7f, 0x01])]);
    expect(nested(malformedSibling, 1, 2).isErr()).toBe(true);
    const duplicates = message(bytesField(1, 'first'), bytesField(1, 'second'));
    expect(
        parse(duplicates)
            .andThen((fields) => bytes(fields, 1))
            .isErr()
    ).toBe(true);
});
