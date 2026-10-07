import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '$lib/models';
import pLimit from 'p-limit';
import { authenticatedHeaders, type PhotosHeaders } from '$server/photos/auth';
import { photosFetch, type Fetcher } from '$server/fetcher';
import { send, readBody } from '$server/photos/transport';
import { bodyBytes } from '$server/protobuf';
import {
    pageRequest,
    parseLibraryPage,
    type LibraryCandidate
} from '$server/photos/library/metadata';
import { decodeSplitHeader, MAX_SPLIT_HEADER_BYTES } from '$server/bmp';
import { LIBRARY_STATE_REQUEST } from '$server/photos/library/requests';
import { preparedDownloadUrl } from '$server/photos/download';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const HEADER_PROBE_BYTES = MAX_SPLIT_HEADER_BYTES;
const LIBRARY_PROBE_CONCURRENCY = 4;
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

            const request = requestToken
                ? pageRequest(Buffer.from(requestToken, 'base64url'))
                : Ok(Buffer.from(LIBRARY_STATE_REQUEST, 'base64'));
            const received = await request.andThenAsync((body) =>
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
                    .map((page) => {
                        nextPageToken = page.nextPageToken;

                        return { ...page, requestToken };
                    })
            );

            const finished = received.match({
                Ok: (page) => page.items.length > 0 || !page.nextPageToken,
                Err: () => true
            });
            if (finished) return received;
        }
    });
}

function scanLibraryPage(
    page: { items: LibraryCandidate[]; nextPageToken: string },
    headers: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const limit = pLimit(LIBRARY_PROBE_CONCURRENCY);
        const scanned = await limit.map(page.items, (candidate) =>
            probeLibraryItem(candidate, headers.commonHeaders, headers.rpcHeaders, fetcher)
        );

        const items: RemoteBmp[] = [];

        for (const result of scanned) {
            if (result.isErr())
                return result.map(() => ({ items, nextPageToken: page.nextPageToken }));

            result.inspect((item) => {
                if (item !== null) items.push(item);
            });
        }

        return Ok({
            items,
            nextPageToken: page.nextPageToken
        });
    });
}

function readPrefix(response: Response): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync<Buffer, ServerError>(async () => {
        const reader = response.body?.getReader();
        if (!reader) return Err(SERVER_ERRORS.MISSING_DOWNLOAD_BODY);

        const parts: Uint8Array[] = [];
        let length = 0;

        try {
            while (length < HEADER_PROBE_BYTES) {
                const next = await reader.read();
                if (next.done) break;

                const part = next.value.subarray(0, HEADER_PROBE_BYTES - length);
                parts.push(part);
                length += part.length;
            }
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);
        } finally {
            try {
                await reader.cancel();
            } catch {
                // The inspected bytes are still usable if cancellation fails.
            }
        }

        return Ok(Buffer.concat(parts, length));
    });
}

function fetchPrefix(
    url: URL,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let response: Response;

        try {
            response = await fetcher(url, {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    ...commonHeaders,
                    range: `bytes=0-${HEADER_PROBE_BYTES - 1}`
                }
            });
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);
        }

        if (response.status !== 200 && response.status !== 206)
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);

        return readPrefix(response);
    });
}

function probeLibraryItem(
    candidate: LibraryCandidate,
    commonHeaders: Record<string, string>,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<RemoteBmp | null, ServerError> {
    return preparedDownloadUrl(candidate.mediaKey, candidate.sha1, rpcHeaders, fetcher)
        .andThenAsync(async (url) => {
            if (url === null) return Ok(null);

            return await fetchPrefix(url, commonHeaders, fetcher);
        })
        .map((prefix) => {
            if (prefix === null) return null;

            return decodeSplitHeader(prefix, candidate.size).match({
                Ok: ({ header }) => ({
                    ...candidate,
                    fileHash: header.fileHash,
                    fileId: header.fileId,
                    chunkIndex: header.chunkIndex,
                    isLast: header.flags === 1,
                    originalName: header.fileName,
                    size: header.payloadSize
                }),
                Err: () => null
            });
        });
}
