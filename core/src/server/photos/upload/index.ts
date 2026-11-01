import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { FileNameSchema, Sha1HexSchema, UploadStatus, type UploadResponse } from '../../../models';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import { photosFetch, type Fetcher } from '../../fetcher';
import { bodyBytes } from '../../protobuf';
import type { UploadBmpSource } from '../../upload/bmp';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { commitBmp, hashLookup, startUpload, transferBmp } from './requests';

export function uploadBmp(
    email: string,
    token: string,
    name: string,
    bmp: Buffer,
    fetcher: Fetcher = photosFetch
): AsyncResult<UploadResponse, ServerError> {
    const validName = FileNameSchema.safeParse(name).success
        ? Ok(name)
        : Err(SERVER_ERRORS.INVALID_FILE_NAME);

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

/** A read-only duplicate check, including after a commit with an uncertain result. */
export function findBmpBySha1(
    email: string,
    token: string,
    sha1: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<string | null, ServerError> {
    const validHash = Sha1HexSchema.safeParse(sha1).success
        ? Ok(sha1)
        : Err(SERVER_ERRORS.INVALID_SHA_1);

    return validHash
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync(({ rpcHeaders }) =>
            hashLookup(Buffer.from(sha1, 'hex'), rpcHeaders, fetcher)
        );
}
