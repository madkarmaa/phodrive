import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import { bytes, integer, nested, parse, utf8, type Field } from '../../protobuf';

/** The upload session Google returns after a transfer, needed to commit the media. */
export type Transfer = { scotty: Buffer; type: number; token: Buffer };

function readMediaKey(item: Field[], field: number): Result<string, ServerError> {
    return bytes(item, field)
        .andThen((data) => nested(data, 1))
        .andThen(utf8)
        .andThen((key) => {
            if (!key) return Err(SERVER_ERRORS.MISSING_MEDIA_KEY);

            return Ok(key);
        });
}

export function existingMedia(response: Buffer, sha1: Buffer): Result<string | null, ServerError> {
    return nested(response, 1, 2)
        .andThen(parse)
        .andThen((matched) =>
            bytes(matched, 1)
                .andThen((data) => nested(data, 1))
                .map((foundHash) => ({ matched, foundHash }))
        )
        .andThen(({ matched, foundHash }) => {
            if (!foundHash.equals(sha1)) return Err(SERVER_ERRORS.HASH_LOOKUP_MISMATCH);
            if (!matched.some((field) => field.number === 2)) return Ok(null);

            return readMediaKey(matched, 2);
        });
}

export function mediaFromCommit(response: Buffer, scotty: Buffer): Result<string, ServerError> {
    return nested(response, 1)
        .andThen(parse)
        .andThen((item) =>
            bytes(item, 1).andThen((token) => {
                if (!token.equals(scotty)) return Err(SERVER_ERRORS.COMMIT_TOKEN_MISMATCH);

                return integer(item, 2).map((status) => ({ item, status }));
            })
        )
        .andThen(({ item, status }): Result<string, ServerError> => {
            if (status === 10 && !item.some((field) => field.number === 3))
                return Err(SERVER_ERRORS.COMMIT_REJECTED);
            if (status !== 0) return Err(SERVER_ERRORS.UNKNOWN_COMMIT_STATUS);

            return readMediaKey(item, 3);
        });
}

export function parseTransfer(scotty: Buffer): Result<Transfer, ServerError> {
    return parse(scotty).andThen((fields) =>
        integer(fields, 1).andThen((type) =>
            bytes(fields, 2).andThen((token) =>
                type === 2 && token.length
                    ? Ok({ scotty, type, token })
                    : Err(SERVER_ERRORS.INVALID_TRANSFER_TOKEN)
            )
        )
    );
}
