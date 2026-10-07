import type { ServerError } from '#server/errors';
import { Ok, type Result } from 'results-ts';
import { MAX_PHOTOS_BMP_BYTES } from '#server/bmp';
import { LIBRARY_PAGE_REQUEST } from '#server/photos/library/requests';
import {
    bytes,
    parse,
    nested,
    integer,
    utf8,
    optional,
    encodeFields,
    type Field
} from '#server/protobuf';

export function pageRequest(resume: Buffer): Result<Buffer, ServerError> {
    const envelope = parse(Buffer.from(LIBRARY_PAGE_REQUEST, 'base64')).andThen((fields) =>
        bytes(fields, 1)
            .andThen(parse)
            .map((outer) => ({ fields, outer }))
    );

    return envelope.map(({ fields, outer }) => {
        // The resume token belongs at 1.4; 1.1 contains the media metadata mask.
        const updatedOuter = outer.filter((field) => field.number !== 4);
        updatedOuter.push({ number: 4, value: resume });

        return encodeFields(
            fields.map((field) =>
                field.number === 1 ? { number: 1, value: encodeFields(updatedOuter) } : field
            )
        );
    });
}

export type LibraryCandidate = { size: number; at: number; mediaKey: string; sha1: string };

function libraryItem(value: Buffer): Result<LibraryCandidate | null, ServerError> {
    const parsed = parse(value).andThen((item) =>
        bytes(item, 2)
            .andThen(parse)
            .map((details) => ({ item, details }))
    );
    const visibility = parsed.andThen(({ item, details }) =>
        visibleInLibrary(details).map((visible) => ({ item, details, visible }))
    );

    return visibility.andThen(({ item, details, visible }) => {
        if (!visible) return Ok(null);

        return libraryMetadata(item, details).map(({ fingerprint, size, at, mediaKey }) => {
            const sha1 = fingerprint.toString('hex');
            if (
                !/^[a-f0-9]{40}$/.test(sha1) ||
                !mediaKey ||
                !Number.isSafeInteger(at) ||
                size < 54 ||
                size > MAX_PHOTOS_BMP_BYTES
            )
                return null;

            return { size, at, mediaKey, sha1 };
        });
    });
}

function visibleInLibrary(details: Field[]): Result<boolean, ServerError> {
    const trashed = optional(details, 16);
    if (!trashed || typeof trashed.value === 'number') return Ok(true);

    return parse(trashed.value).map((state) => !optional(state, 3)?.value);
}

function libraryMetadata(
    item: Field[],
    details: Field[]
): Result<{ fingerprint: Buffer; size: number; at: number; mediaKey: string }, ServerError> {
    const fingerprint = bytes(details, 13).andThen((data) => nested(data, 1));
    const sized = fingerprint.andThen((fingerprint) =>
        integer(details, 10).map((size) => ({ fingerprint, size }))
    );
    const dated = sized.andThen((metadata) =>
        integer(details, 9).map((at) => ({ ...metadata, at }))
    );

    return dated.andThen((metadata) =>
        bytes(item, 1)
            .andThen(utf8)
            .map((mediaKey) => ({ ...metadata, mediaKey }))
    );
}

export function parseLibraryPage(
    data: Buffer
): Result<{ items: LibraryCandidate[]; nextPageToken: string }, ServerError> {
    return parse(data)
        .andThen((fields) => bytes(fields, 1))
        .andThen(parse)
        .map((fields) => {
            const items: LibraryCandidate[] = [];
            for (const entry of fields) {
                if (entry.number !== 2 || typeof entry.value === 'number') continue;

                const value = entry.value;

                const parsed = libraryItem(value);
                parsed.inspect((item) => {
                    if (item) items.push(item);
                });
            }

            const next = optional(fields, 1);

            return {
                items,
                nextPageToken:
                    next && typeof next.value !== 'number' ? next.value.toString('base64url') : ''
            };
        });
}
