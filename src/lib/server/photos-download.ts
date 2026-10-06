import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '$server/errors';
import { bytes, integer, nested, optional, parse, utf8 } from '$server/protobuf';

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
