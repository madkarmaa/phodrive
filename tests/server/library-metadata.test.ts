import { expect, test } from 'vitest';
import { pageRequest, parseLibraryPage } from '#server/photos/library/metadata';
import { LIBRARY_PAGE_REQUEST } from '#server/photos/library/requests';
import { bytesField, message, nested } from '#server/protobuf';

test('library pagination sends the resume token at field 1.4 and preserves the metadata mask', () => {
    const resume = Buffer.from('resume-next-page');
    const request = pageRequest(resume).unwrap();
    const template = Buffer.from(LIBRARY_PAGE_REQUEST, 'base64');

    expect(nested(request, 1, 4).unwrap()).toEqual(resume);
    expect(nested(request, 1, 1).unwrap()).toEqual(nested(template, 1, 1).unwrap());
    expect(nested(request, 2).unwrap()).toEqual(nested(template, 2).unwrap());
});

test('a sync token without a resume token does not advertise another library page', () => {
    const response = bytesField(1, bytesField(6, 'next-sync-cycle'));
    const page = parseLibraryPage(response).unwrap();

    expect(page).toEqual({ items: [], nextPageToken: '' });
});

test('an empty resume token ends pagination even when the sync token remains', () => {
    const response = bytesField(1, message(bytesField(1, ''), bytesField(6, 'next-sync-cycle')));
    const page = parseLibraryPage(response).unwrap();

    expect(page.nextPageToken).toBe('');
});
