import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { authenticatedHeaders } from '$server/photos/auth';
import { photosFetch, type Fetcher } from '$server/fetcher';
import { send, readBody } from '$server/photos/transport';
import {
    message,
    bytesField,
    bodyBytes,
    bytes,
    integer,
    nested,
    optional,
    parse,
    utf8
} from '$server/protobuf';

const DOWNLOAD_URL =
    'https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.preparedownloaddata.v1.PhotosPrepareDownloadDataService/PhotosPrepareDownload';
const DOWNLOAD_MASK = Buffer.from([10, 4, 58, 2, 18, 0, 42, 10, 18, 0, 26, 0, 42, 4, 10, 0, 24, 0]);

export function downloadBmp(
    email: string,
    token: string,
    mediaKey: string,
    sha1: string,
    fetcher: Fetcher = photosFetch,
    signal?: AbortSignal
): AsyncResult<Response, ServerError> {
    const validReference =
        mediaKey && mediaKey.length <= 1024 && /^[a-f0-9]{40}$/.test(sha1)
            ? Ok(undefined)
            : Err(SERVER_ERRORS.INVALID_FILE_REFERENCE);

    return validReference
        .andThenAsync(() =>
            authenticatedHeaders(email, token, (url, init) => fetcher(url, { ...init, signal }))
        )
        .andThenAsync(({ commonHeaders, rpcHeaders }) =>
            preparedDownloadUrl(mediaKey, sha1, rpcHeaders, (url, init) =>
                fetcher(url, { ...init, signal })
            ).map((url) => ({
                url,
                commonHeaders
            }))
        )
        .andThenAsync(async ({ url, commonHeaders }) => {
            if (url === null) return Err(SERVER_ERRORS.INVALID_DOWNLOAD_CONTENT_TYPE);

            return await send(
                fetcher,
                url,
                {
                    method: 'GET',
                    redirect: 'manual',
                    headers: commonHeaders,
                    signal
                },
                'Download'
            );
        })
        .andThenAsync(async (response) => {
            if (!response.headers.get('content-type')?.startsWith('image/')) {
                try {
                    await response.body?.cancel();
                } catch {
                    // Preserve the content-type error if the transport cannot cancel its body.
                }

                return Err(SERVER_ERRORS.INVALID_DOWNLOAD_CONTENT_TYPE);
            }

            return Ok(response);
        });
}

export function preparedDownloadUrl(
    mediaKey: string,
    sha1: string,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<URL | null, ServerError> {
    const request = message(
        bytesField(1, bytesField(1, bytesField(1, mediaKey))),
        bytesField(2, DOWNLOAD_MASK)
    );

    return send(
        fetcher,
        DOWNLOAD_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(request)
        },
        'Prepare download'
    ).andThenAsync((response) =>
        readBody(response, 'Prepare download').andThen((metadata) =>
            parsePhotoDownloadUrl(metadata, mediaKey, sha1)
        )
    );
}

const IMAGE_DOWNLOAD_TYPE = 1;
const VIDEO_DOWNLOAD_TYPE = 2;

function parseSignedDownloadUrl(text: string): Result<URL, ServerError> {
    let signed: URL;

    try {
        signed = new URL(text);
    } catch {
        return Err(SERVER_ERRORS.INVALID_DOWNLOAD_URL);
    }

    if (
        signed.protocol !== 'https:' ||
        signed.hostname !== 'lh3.googleusercontent.com' ||
        signed.port ||
        signed.username ||
        signed.password ||
        signed.hash
    )
        return Err(SERVER_ERRORS.INVALID_DOWNLOAD_URL);

    return Ok(signed);
}

/** Videos have a separate download variant and cannot contain a Phodrive BMP. */
export function parsePhotoDownloadUrl(
    metadata: Buffer,
    mediaKey: string,
    sha1: string
): Result<URL | null, ServerError> {
    return nested(metadata, 1, 1)
        .andThen(utf8)
        .andThen((remoteKey) => {
            if (remoteKey !== mediaKey) return Err(SERVER_ERRORS.DOWNLOAD_MEDIA_MISMATCH);

            return nested(metadata, 1, 2, 13, 1);
        })
        .andThen((remoteSha1) => {
            if (remoteSha1.toString('hex') !== sha1)
                return Err(SERVER_ERRORS.DOWNLOAD_FINGERPRINT_MISMATCH);

            return nested(metadata, 1, 5).andThen(parse);
        })
        .andThen((download): Result<URL | null, ServerError> => {
            const type = optional(download, 1) ? integer(download, 1) : Ok(IMAGE_DOWNLOAD_TYPE);

            return type.andThen((kind) => {
                if (kind === VIDEO_DOWNLOAD_TYPE)
                    return bytes(download, 3)
                        .andThen(parse)
                        .map(() => null);

                if (kind !== IMAGE_DOWNLOAD_TYPE)
                    return Err(SERVER_ERRORS.INVALID_DOWNLOAD_CONTENT_TYPE);

                return bytes(download, 2)
                    .andThen((image) => nested(image, 5))
                    .andThen(utf8)
                    .andThen(parseSignedDownloadUrl);
            });
        });
}
