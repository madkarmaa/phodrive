import { expect, test } from 'vitest';
import { parsePhotoDownloadUrl } from '$server/photos-download';
import { bytesField, message, numberField } from '$server/protobuf';
import { SERVER_ERRORS } from '$server/errors';

const MEDIA_KEY = 'fixture-key';
const SHA1 = 'a'.repeat(40);
const SIGNED_URL = 'https://lh3.googleusercontent.com/fixture=d';

function metadata(download: Buffer, key = MEDIA_KEY, sha1 = SHA1): Buffer {
    return bytesField(
        1,
        message(
            bytesField(1, key),
            bytesField(2, bytesField(13, bytesField(1, Buffer.from(sha1, 'hex')))),
            bytesField(5, download)
        )
    );
}

test('image download metadata preserves the validated signed URL', () => {
    const response = metadata(message(numberField(1, 1), bytesField(2, bytesField(5, SIGNED_URL))));
    const parsed = parsePhotoDownloadUrl(response, MEDIA_KEY, SHA1);

    expect(parsed.unwrap()?.href).toBe(SIGNED_URL);
});

test('video download metadata is skipped only after verifying its key and fingerprint', () => {
    const video = message(numberField(1, 2), bytesField(3, bytesField(5, 'video-download')));
    const parsed = parsePhotoDownloadUrl(metadata(video), MEDIA_KEY, SHA1);
    const wrongKey = parsePhotoDownloadUrl(metadata(video, 'other-key'), MEDIA_KEY, SHA1);
    const wrongHash = parsePhotoDownloadUrl(
        metadata(video, MEDIA_KEY, 'b'.repeat(40)),
        MEDIA_KEY,
        SHA1
    );

    expect(parsed.unwrap()).toBeNull();
    expect(wrongKey.unwrapErr()).toEqual(SERVER_ERRORS.DOWNLOAD_MEDIA_MISMATCH);
    expect(wrongHash.unwrapErr()).toEqual(SERVER_ERRORS.DOWNLOAD_FINGERPRINT_MISMATCH);
});

test.each([
    message(numberField(1, 1)),
    message(numberField(1, 2)),
    message(numberField(1, 2), numberField(1, 2), bytesField(3, '')),
    message(numberField(1, 2), bytesField(3, Uint8Array.of(10, 5, 1))),
    message(numberField(1, 99), bytesField(2, bytesField(5, SIGNED_URL)))
])('invalid download variants remain failures', (download) => {
    const parsed = parsePhotoDownloadUrl(metadata(download), MEDIA_KEY, SHA1);

    expect(parsed.isErr()).toBe(true);
});

test('image download metadata rejects untrusted hosts', () => {
    const response = metadata(bytesField(2, bytesField(5, 'https://example.com/fixture')));
    const parsed = parsePhotoDownloadUrl(response, MEDIA_KEY, SHA1);

    expect(parsed.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_DOWNLOAD_URL);
});
