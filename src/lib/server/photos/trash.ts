import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { authenticatedHeaders } from '$server/photos/auth';
import { photosFetch, type Fetcher } from '$server/fetcher';
import { send, readBody } from '$server/photos/transport';
import { message, numberField, bytesField, bodyBytes } from '$server/protobuf';

const TRASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/17490284929287180316';

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
