import { Err, Ok, type AsyncResult } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { bodyBytes, bytesField, message, numberField } from '../../protobuf';
import { readBody, send } from '../transport';
import { existingMedia, mediaFromCommit, parseTransfer, type Transfer } from './responses';

const UPLOAD_URL = 'https://photos.googleapis.com/data/upload/uploadmedia/interactive';
const HASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/5084965799730810217';
const COMMIT_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/16538846908252377752';

export function startUpload(
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

export function transferBmp(
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

export function commitBmp(
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

export function hashLookup(
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
