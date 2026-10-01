import { Err, Ok, type AsyncResult } from 'results-ts';
import { LibraryResponseSchema, type LibraryResponse, type RemoteBmp } from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import { apiJson } from '$browser/api';

export type LibrarySnapshot = LibraryResponse & { pages: number };

export function readLibraryPage(
    email: string,
    token: string,
    pageToken = ''
): AsyncResult<LibraryResponse, Error> {
    return apiJson(
        '/api/library',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, token, pageToken })
        },
        'Could not load files.'
    ).andThen((value) => schemaResult(LibraryResponseSchema, value, 'Could not load files.'));
}

/** Build a fresh snapshot to the loaded depth without changing the visible library mid-request. */
export function readLibrarySnapshot(
    email: string,
    token: string,
    pageCount: number
): AsyncResult<LibrarySnapshot, Error> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const pageTokens = new Set<string>();
        let nextPageToken = '';
        let pages = 0;

        for (let index = 0; index < Math.max(1, pageCount); index++) {
            pageTokens.add(nextPageToken);
            const received = await readLibraryPage(email, token, nextPageToken);
            const snapshot = received.andThen((page) => {
                if (page.nextPageToken && pageTokens.has(page.nextPageToken)) {
                    return Err(
                        new Error('Google Photos repeated a library page. Refresh to try again.')
                    );
                }

                for (const item of page.items) items.set(item.mediaKey, item);
                nextPageToken = page.nextPageToken;
                pages++;

                return Ok({ items: [...items.values()], nextPageToken, pages });
            });

            if (snapshot.isErr()) return snapshot;
            if (!nextPageToken) break;
        }

        return Ok({ items: [...items.values()], nextPageToken, pages });
    });
}
