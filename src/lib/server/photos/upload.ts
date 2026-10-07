import { SERVER_ERRORS, type ServerError } from '#server/errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadStatus, type UploadResponse } from '#lib/models';
import { createHash } from 'node:crypto';
import { authenticatedHeaders, type PhotosHeaders } from '#server/photos/auth';
import { photosFetch, type Fetcher } from '#server/fetcher';
import { send, readBody } from '#server/photos/transport';
import {
    message,
    numberField,
    bytesField,
    bodyBytes,
    bytes,
    nested,
    utf8,
    parse,
    integer,
    type Field
} from '#server/protobuf';
import type { UploadBmpSource } from '#server/upload/bmp';

const UPLOAD_URL = 'https://photos.googleapis.com/data/upload/uploadmedia/interactive';
const HASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/5084965799730810217';
const COMMIT_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/16538846908252377752';

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

            return startUpload(bmp.length, sha1, commonHeaders, fetcher)
                .andThenAsync((uploadId) =>
                    transferBmp(bodyBytes(bmp), uploadId, commonHeaders, fetcher)
                )
                .andThenAsync((transfer) => commitBmp(name, sha1, transfer, rpcHeaders, fetcher))
                .map((mediaKey) => ({
                    status: UploadStatus.Uploaded as const,
                    mediaKey,
                    sha1: sha1Hex
                }));
        }
    );
}

/** Streaming upload with caller-supplied SHA-1 verified before a photo can be committed. */
export function uploadBmpStream(
    email: string,
    token: string,
    name: string,
    source: UploadBmpSource,
    fetcher: Fetcher = photosFetch,
    signal?: AbortSignal
): AsyncResult<UploadResponse, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) abort.abort();

        const transport: Fetcher = (url, init) => fetcher(url, { ...init, signal: abort.signal });

        try {
            const authenticated = await authenticatedHeaders(email, token, transport);

            return await authenticated.andThenAsync((headers) =>
                uploadAuthenticatedStream(name, source, headers, transport)
            );
        } finally {
            abort.abort();
            signal?.removeEventListener('abort', onAbort);
            if (!source.body.locked) {
                try {
                    await source.body.cancel();
                } catch {
                    /* Transport failures already carry a safe error. */
                }
            }
        }
    });
}

function uploadAuthenticatedStream(
    name: string,
    source: UploadBmpSource,
    { commonHeaders, rpcHeaders }: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<UploadResponse, ServerError> {
    const sha1 = Buffer.from(source.sha1, 'hex');

    return hashLookup(sha1, rpcHeaders, fetcher).andThenAsync<UploadResponse, ServerError>(
        async (existing) => {
            if (existing) {
                return source.drain().map(() => ({
                    status: UploadStatus.AlreadyExists,
                    mediaKey: existing,
                    sha1: source.sha1
                }));
            }

            const transferred = startUpload(
                source.length,
                sha1,
                commonHeaders,
                fetcher
            ).andThenAsync((uploadId) =>
                transferBmp(source.body, uploadId, commonHeaders, fetcher, source.length)
            );

            // The full input must pass length and hash checks before committing remote media.
            return transferred
                .andThenAsync((transfer) => source.verified.map(() => transfer))
                .andThenAsync((transfer) => commitBmp(name, sha1, transfer, rpcHeaders, fetcher))
                .map((mediaKey) => ({
                    status: UploadStatus.Uploaded,
                    mediaKey,
                    sha1: source.sha1
                }));
        }
    );
}

function startUpload(
    length: number,
    sha1: Buffer,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const request = message(
        numberField(1, 2),
        numberField(2, 2),
        numberField(3, 1),
        numberField(4, 3),
        numberField(7, length)
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
                'x-upload-content-length': String(length)
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

function transferBmp(
    body: BodyInit,
    uploadId: string,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher,
    length?: number
): AsyncResult<Transfer, ServerError> {
    const url = new URL(UPLOAD_URL);
    url.searchParams.set('upload_id', uploadId);

    return send(
        fetcher,
        url,
        {
            method: 'PUT',
            redirect: 'manual',
            headers: {
                ...commonHeaders,
                ...(length === undefined ? {} : { 'content-length': String(length) })
            },
            body
        },
        'Upload transfer'
    ).andThenAsync((response) => readBody(response, 'Upload transfer').andThen(parseTransfer));
}

function commitBmp(
    name: string,
    sha1: Buffer,
    transfer: Transfer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const media = message(
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
        bytesField(1, media),
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

type Transfer = { scotty: Buffer; type: number; token: Buffer };

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
