import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { photosFetch, type Fetcher } from '../../fetcher';
import { send, readBody } from '../transport';
import { bodyBytes } from '../../protobuf';
import { pageRequest, parseLibraryPage } from './metadata';
import { scanLibraryPage } from './probe';
import { LIBRARY_STATE_REQUEST } from './requests';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const MAX_PAGE_TOKEN_LENGTH = 8192;

/** A page of files with a continuation only when another file page exists. */
export function listBmps(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    const validated =
        pageToken.length > MAX_PAGE_TOKEN_LENGTH ||
        (pageToken && !/^[A-Za-z0-9_-]+$/.test(pageToken))
            ? Err(SERVER_ERRORS.INVALID_PAGE_TOKEN)
            : Ok(pageToken);

    return validated
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync((headers) => {
            const visited = new Set<string>();

            return findFilePage(pageToken, headers, fetcher, visited).andThenAsync(async (page) => {
                if (!page.nextPageToken) return Ok({ items: page.items, nextPageToken: '' });

                // Google Photos can return a resume token followed only by an empty sync page.
                // Look ahead so the UI offers Load more only for confirmed Phodrive files.
                return await findFilePage(page.nextPageToken, headers, fetcher, visited).map(
                    (next) => ({
                        items: page.items,
                        nextPageToken: next.items.length ? next.requestToken : ''
                    })
                );
            });
        });
}

/** Fetch one library page and keep only its Phodrive files. */
function readLibraryPage(
    requestToken: string,
    headers: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    const request = requestToken
        ? pageRequest(Buffer.from(requestToken, 'base64url'))
        : Ok(Buffer.from(LIBRARY_STATE_REQUEST, 'base64'));

    return request.andThenAsync((body) =>
        send(
            fetcher,
            LIBRARY_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: headers.rpcHeaders,
                body: bodyBytes(body)
            },
            'Library list'
        )
            .andThenAsync((response) => readBody(response, 'Library list'))
            .andThen(parseLibraryPage)
            .andThenAsync((page) => scanLibraryPage(page, headers, fetcher))
    );
}

function findFilePage(
    pageToken: string,
    headers: PhotosHeaders,
    fetcher: Fetcher,
    visited: Set<string>
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string; requestToken: string }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let nextPageToken = pageToken;

        while (true) {
            const requestToken = nextPageToken;
            if (visited.has(requestToken)) return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);

            visited.add(requestToken);

            const received = await readLibraryPage(requestToken, headers, fetcher).map((page) => {
                nextPageToken = page.nextPageToken;

                return { ...page, requestToken };
            });

            const finished = received.match({
                Ok: (page) => page.items.length > 0 || !page.nextPageToken,
                Err: () => true
            });
            if (finished) return received;
        }
    });
}
