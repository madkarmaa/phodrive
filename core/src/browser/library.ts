import type { ApplicationError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { LibraryResponseSchema, type LibraryResponse, type RemoteBmp } from '../models';
import { schemaResult } from '../validation';
import { apiJson } from './api';

export type LibrarySnapshot = LibraryResponse & { pages: number };

/** The server reads the signed-in user's Google account, so requests carry no credentials. */
export function readLibraryPage(pageToken = ''): AsyncResult<LibraryResponse, ApplicationError> {
    return apiJson(
        '/api/library',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pageToken })
        },
        'Could not load files.'
    ).andThen((value) => schemaResult(LibraryResponseSchema, value, 'Could not load files.'));
}

/** Build a fresh snapshot to the loaded depth without changing the visible library mid-request. */
export function readLibrarySnapshot(
    pageCount: number
): AsyncResult<LibrarySnapshot, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const pageTokens = new Set<string>();
        let nextPageToken = '';
        let pages = 0;

        for (let index = 0; index < Math.max(1, pageCount); index++) {
            pageTokens.add(nextPageToken);

            const received = await readLibraryPage(nextPageToken);

            const merged = received.andThen((page): Result<void, ApplicationError> => {
                if (page.nextPageToken && pageTokens.has(page.nextPageToken)) {
                    return Err({
                        code: 'REPEATED_LIBRARY_PAGE',
                        message: 'Google Photos repeated a library page. Refresh to try again.'
                    } as const);
                }

                for (const item of page.items) items.set(item.mediaKey, item);
                nextPageToken = page.nextPageToken;
                pages++;

                return Ok(undefined);
            });

            if (merged.isErr()) return merged;
            if (!nextPageToken) break;
        }

        return Ok({ items: [...items.values()], nextPageToken, pages });
    });
}
