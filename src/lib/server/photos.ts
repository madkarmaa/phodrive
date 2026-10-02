import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { UploadStatus, type RemoteBmp, type UploadResponse } from '$lib/models';
import { createHash, randomBytes } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import pLimit from 'p-limit';
import {
    message,
    numberField,
    bytesField,
    bodyBytes,
    parse,
    bytes,
    nested,
    integer,
    utf8,
    type Field
} from '$server/protobuf';
import { pageRequest, parseLibraryPage, type LibraryCandidate } from '$server/library-metadata';
import { decodeSplitHeader } from '$server/bmp';
import { photosFetch, type Fetcher } from '$server/fetcher';
import { LIBRARY_STATE_REQUEST } from '$server/library-requests';

const AUTH_URL = 'https://android.googleapis.com/auth';
const UPLOAD_URL = 'https://photos.googleapis.com/data/upload/uploadmedia/interactive';
const HASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/5084965799730810217';
const COMMIT_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/16538846908252377752';
const DOWNLOAD_URL =
    'https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.preparedownloaddata.v1.PhotosPrepareDownloadDataService/PhotosPrepareDownload';
const TRASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/17490284929287180316';
const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const APP = 'com.google.android.apps.photos';
const SIGNATURE = '24bb24c05e47e0aefa68a58a766179d9b613a600';
const DOWNLOAD_MASK = Buffer.from([10, 4, 58, 2, 18, 0, 42, 10, 18, 0, 26, 0, 42, 4, 10, 0, 24, 0]);
const HEADER_PROBE_BYTES = 65_536;
const LIBRARY_PROBE_CONCURRENCY = 4;

type PhotosHeaders = {
    commonHeaders: Record<string, string>;
    rpcHeaders: Record<string, string>;
};

/** One live page, identified from embedded BMP metadata rather than editable filenames. */
export function listBmps(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    const request =
        pageToken.length > 8192 || (pageToken && !/^[A-Za-z0-9_-]+$/.test(pageToken))
            ? Err(SERVER_ERRORS.INVALID_PAGE_TOKEN)
            : pageToken
              ? pageRequest(Buffer.from(pageToken, 'base64url'))
              : Ok(Buffer.from(LIBRARY_STATE_REQUEST, 'base64'));

    return request
        .andThenAsync((body) =>
            authenticatedHeaders(email, token, fetcher).map((headers) => ({ body, headers }))
        )
        .andThenAsync(({ body, headers }) =>
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

function readMediaKey(item: Field[], field: number): Result<string, ServerError> {
    return bytes(item, field)
        .andThen((data) => nested(data, 1))
        .andThen(utf8)
        .andThen((key) => {
            if (!key) return Err(SERVER_ERRORS.MISSING_MEDIA_KEY);

            return Ok(key);
        });
}

function existingMedia(response: Buffer, sha1: Buffer): Result<string | null, ServerError> {
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

function mediaFromCommit(response: Buffer, scotty: Buffer): Result<string, ServerError> {
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

function send(
    fetcher: Fetcher,
    url: string | URL,
    init: RequestInit,
    stage: string
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let response: Response;
        try {
            response = await fetcher(url, init);
        } catch {
            return Err({
                code: 'REQUEST_FAILED',
                message: init.signal?.aborted ? `${stage} timed out` : `${stage} failed`
            } as const);
        }
        if (response.status !== 200)
            return Err({
                code: 'REQUEST_FAILED',
                message: `${stage} failed (HTTP ${response.status})`
            } as const);

        return Ok(response);
    });
}

function readBody(response: Response, stage: string): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const body = await response.arrayBuffer();
            return Ok(Buffer.from(body));
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: `${stage} failed` } as const);
        }
    });
}

function authenticatedHeaders(
    email: string,
    token: string,
    fetcher: Fetcher
): AsyncResult<PhotosHeaders, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !token.startsWith('aas_et/')) {
            return Err(SERVER_ERRORS.INVALID_ACCOUNT);
        }
        const androidId = randomBytes(8).toString('hex');
        const form = new URLSearchParams({
            Email: email,
            Token: token,
            androidId,
            app: APP,
            callerPkg: APP,
            callerSig: SIGNATURE,
            client_sig: SIGNATURE,
            device_country: 'us',
            operatorCountry: 'us',
            google_play_services_version: '240913000',
            lang: 'en_US',
            oauth2_foreground: '1',
            sdk_version: '33',
            source: 'android',
            service:
                'oauth2:openid https://www.googleapis.com/auth/mobileapps.native https://www.googleapis.com/auth/photos.native'
        });
        return send(
            fetcher,
            AUTH_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    app: APP,
                    device: androidId,
                    'user-agent': 'GoogleAuth/1.4 (Pixel XL PQ2A.190205.001); gzip',
                    'content-type': 'application/x-www-form-urlencoded',
                    'accept-encoding': 'identity'
                },
                body: form
            },
            'Authentication'
        ).andThenAsync((response) =>
            readBody(response, 'Authentication').andThen(utf8).andThen(authHeadersFromResponse)
        );
    });
}

function authHeadersFromResponse(text: string): Result<PhotosHeaders, ServerError> {
    const authFields = Object.fromEntries(
        text
            .split('\n')
            .filter((line) => line.includes('='))
            .map((line) => {
                const index = line.indexOf('=');
                return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
            })
    );
    if (authFields.Error || !authFields.Auth || Number(authFields.Expiry) <= Date.now() / 1000)
        return Err(SERVER_ERRORS.AAS_AUTHENTICATION_FAILED);

    const commonHeaders = {
        Authorization: `Bearer ${authFields.Auth}`,
        'user-agent':
            'com.google.android.apps.photos/49029607 (Linux; U; Android 9; en_US; Pixel XL; Build/PQ2A.190205.001; Cronet/127.0.6510.5) (gzip)',
        'accept-encoding': 'identity',
        'accept-language': 'en_US'
    };
    const rpcHeaders = {
        ...commonHeaders,
        'content-type': 'application/x-protobuf',
        'x-goog-ext-173412678-bin': 'CgcIAhClARgC',
        'x-goog-ext-174067345-bin': 'CgIIAg=='
    };
    return Ok({ commonHeaders, rpcHeaders });
}

/** Confirm Google accepts this email and AAS token for Photos without exposing the bearer token. */
export function validateAasAccount(
    email: string,
    token: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return authenticatedHeaders(email, token, fetcher).map(() => undefined);
}

export function uploadBmp(
    email: string,
    token: string,
    name: string,
    bmp: Buffer,
    fetcher: Fetcher = photosFetch
): AsyncResult<UploadResponse, ServerError> {
    const validName =
        name && !/[\\/\r\n]/.test(name) ? Ok(name) : Err(SERVER_ERRORS.INVALID_FILE_NAME);

    return validName
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync((headers) => uploadAuthenticatedBmp(name, bmp, headers, fetcher));
}

function uploadAuthenticatedBmp(
    name: string,
    bmp: Buffer,
    { commonHeaders, rpcHeaders }: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<UploadResponse, ServerError> {
    const sha1 = createHash('sha1').update(bmp).digest();
    const sha1Hex = sha1.toString('hex');

    return hashLookup(sha1, rpcHeaders, fetcher).andThenAsync<UploadResponse, ServerError>(
        async (foundKey) => {
            if (foundKey)
                return Ok<UploadResponse>({
                    status: UploadStatus.AlreadyExists,
                    mediaKey: foundKey,
                    sha1: sha1Hex
                });

            return startUpload(bmp, sha1, commonHeaders, fetcher)
                .andThenAsync((uploadId) => transferBmp(bmp, uploadId, commonHeaders, fetcher))
                .andThenAsync((transfer) => commitBmp(name, sha1, transfer, rpcHeaders, fetcher))
                .map((mediaKey) => ({
                    status: UploadStatus.Uploaded as const,
                    mediaKey,
                    sha1: sha1Hex
                }));
        }
    );
}

function startUpload(
    bmp: Buffer,
    sha1: Buffer,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const request = message(
        numberField(1, 2),
        numberField(2, 2),
        numberField(3, 1),
        numberField(4, 3),
        numberField(7, bmp.length)
    );

    return send(
        fetcher,
        UPLOAD_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: {
                ...commonHeaders,
                'content-type': 'application/x-protobuf',
                'x-goog-hash': `sha1=${sha1.toString('base64')}`,
                'x-upload-content-length': String(bmp.length)
            },
            body: bodyBytes(request)
        },
        'Upload start'
    ).andThenAsync((response) =>
        readBody(response, 'Upload start').andThen(() => {
            const uploadId = response.headers.get('x-guploader-uploadid');
            return uploadId ? Ok(uploadId) : Err(SERVER_ERRORS.UPLOAD_START_RESPONSE_FAILED);
        })
    );
}

type Transfer = { scotty: Buffer; type: number; token: Buffer };

function transferBmp(
    bmp: Buffer,
    uploadId: string,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<Transfer, ServerError> {
    const url = new URL(UPLOAD_URL);
    url.searchParams.set('upload_id', uploadId);

    return send(
        fetcher,
        url,
        {
            method: 'PUT',
            redirect: 'manual',
            headers: commonHeaders,
            body: bodyBytes(bmp)
        },
        'Upload transfer'
    ).andThenAsync((response) => readBody(response, 'Upload transfer').andThen(parseTransfer));
}

function parseTransfer(scotty: Buffer): Result<Transfer, ServerError> {
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

function commitBmp(
    name: string,
    sha1: Buffer,
    transfer: Transfer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const field1 = message(
        bytesField(1, message(numberField(1, transfer.type), bytesField(2, transfer.token))),
        bytesField(2, name),
        bytesField(3, sha1),
        bytesField(
            4,
            message(numberField(1, Math.floor(Date.now() / 1000)), numberField(2, 46_000_000))
        ),
        numberField(7, 3),
        numberField(10, 1)
    );
    const device = message(bytesField(3, 'Pixel XL'), bytesField(4, 'Google'), numberField(5, 28));
    const request = message(
        bytesField(1, field1),
        bytesField(2, device),
        bytesField(3, Buffer.from([1, 3]))
    );

    return send(
        fetcher,
        COMMIT_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(request)
        },
        'Commit'
    )
        .andThenAsync((response) =>
            readBody(response, 'Commit').andThen((body) => mediaFromCommit(body, transfer.scotty))
        )
        .mapErr((error) =>
            error.code === 'COMMIT_REJECTED' ? error : SERVER_ERRORS.COMMIT_OUTCOME_UNCERTAIN
        );
}

function hashLookup(
    sha1: Buffer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string | null, ServerError> {
    const hashRequest = bytesField(
        1,
        message(bytesField(1, bytesField(1, sha1)), bytesField(2, Buffer.alloc(0)))
    );

    return send(
        fetcher,
        HASH_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(hashRequest)
        },
        'Hash lookup'
    ).andThenAsync((response) =>
        readBody(response, 'Hash lookup').andThen((body) => existingMedia(body, sha1))
    );
}

/** A read-only duplicate check, including after a commit with an uncertain result. */
export function findBmpBySha1(
    email: string,
    token: string,
    sha1: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<string | null, ServerError> {
    const validHash = /^[a-f0-9]{40}$/.test(sha1) ? Ok(sha1) : Err(SERVER_ERRORS.INVALID_SHA_1);

    return validHash
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync(({ rpcHeaders }) =>
            hashLookup(Buffer.from(sha1, 'hex'), rpcHeaders, fetcher)
        );
}

export function downloadBmp(
    email: string,
    token: string,
    mediaKey: string,
    sha1: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<Buffer, ServerError> {
    const validReference =
        mediaKey && mediaKey.length <= 1024 && /^[a-f0-9]{40}$/.test(sha1)
            ? Ok(undefined)
            : Err(SERVER_ERRORS.INVALID_FILE_REFERENCE);

    return validReference
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync(({ commonHeaders, rpcHeaders }) =>
            preparedDownloadUrl(mediaKey, sha1, rpcHeaders, fetcher).map((url) => ({
                url,
                commonHeaders
            }))
        )
        .andThenAsync(({ url, commonHeaders }) =>
            send(
                fetcher,
                url,
                {
                    method: 'GET',
                    redirect: 'manual',
                    headers: commonHeaders
                },
                'Download'
            )
        )
        .andThen((response) => {
            if (!response.headers.get('content-type')?.startsWith('image/'))
                return Err(SERVER_ERRORS.INVALID_DOWNLOAD_CONTENT_TYPE);

            return Ok(response);
        })
        .andThenAsync((response) => readBody(response, 'Download'))
        .andThen((bmp) => {
            if (createHash('sha1').update(bmp).digest('hex') !== sha1)
                return Err(SERVER_ERRORS.DOWNLOAD_INTEGRITY_FAILED);

            return Ok(bmp);
        });
}

function preparedDownloadUrl(
    mediaKey: string,
    sha1: string,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<URL, ServerError> {
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
            downloadUrl(metadata, mediaKey, sha1)
        )
    );
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
        .andThenAsync((url) => fetchPrefix(url, commonHeaders, fetcher))
        .map((prefix) =>
            decodeSplitHeader(prefix, candidate.size).match({
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
            })
        );
}

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

function downloadUrl(metadata: Buffer, mediaKey: string, sha1: string): Result<URL, ServerError> {
    return nested(metadata, 1, 1)
        .andThen(utf8)
        .andThen((remoteKey) => {
            if (remoteKey !== mediaKey) return Err(SERVER_ERRORS.DOWNLOAD_MEDIA_MISMATCH);

            return nested(metadata, 1, 2, 13, 1);
        })
        .andThen((remoteSha1) => {
            if (remoteSha1.toString('hex') !== sha1)
                return Err(SERVER_ERRORS.DOWNLOAD_FINGERPRINT_MISMATCH);

            return nested(metadata, 1, 5, 2, 5);
        })
        .andThen(utf8)
        .andThen(parseSignedDownloadUrl);
}

export function moveToTrash(
    email: string,
    token: string,
    sha1: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    const validHash = /^[a-f0-9]{40}$/.test(sha1)
        ? Ok(sha1)
        : Err(SERVER_ERRORS.INVALID_FILE_REFERENCE);

    return validHash
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync(({ commonHeaders }) => {
            const dedupKey = Buffer.from(sha1, 'hex').toString('base64url');
            const body = message(
                numberField(2, 1),
                bytesField(3, dedupKey),
                numberField(4, 1),
                bytesField(
                    8,
                    bytesField(
                        4,
                        message(
                            bytesField(2, Buffer.alloc(0)),
                            bytesField(3, bytesField(1, Buffer.alloc(0))),
                            bytesField(4, Buffer.alloc(0)),
                            bytesField(5, bytesField(1, Buffer.alloc(0)))
                        )
                    )
                ),
                bytesField(
                    9,
                    message(
                        numberField(1, 5),
                        bytesField(2, message(numberField(1, 49029607), bytesField(2, '28')))
                    )
                )
            );
            return send(
                fetcher,
                TRASH_URL,
                {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { ...commonHeaders, 'content-type': 'application/x-protobuf' },
                    body: bodyBytes(body)
                },
                'Move to trash'
            ).andThenAsync((response) => readBody(response, 'Move to trash').map(() => undefined));
        });
}
