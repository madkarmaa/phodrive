import Varint from 'varint';

/** Hand-written protobuf encoding, independent of the encoder under test. */
function varint(value: number): Buffer {
    return Buffer.from(Varint.encode(value));
}

export function num(field: number, value: number): Buffer {
    return Buffer.concat([varint(field * 8), varint(value)]);
}

export function bytes(field: number, data: Uint8Array | string): Buffer {
    const body = Buffer.from(data);

    return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
}

/** A successful Android sign-in that stays valid for an hour. */
export function authResponse(): Response {
    return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
}

/** PhotosPrepareDownload metadata naming a media item, its fingerprint, and how to fetch it. */
export function downloadMetadata(mediaKey: string, sha1: Uint8Array, download: Buffer): Buffer {
    return bytes(
        1,
        Buffer.concat([bytes(1, mediaKey), bytes(2, bytes(13, bytes(1, sha1))), bytes(5, download)])
    );
}

/** Download instructions with a signed image URL. */
export function imageDownload(url: string): Buffer {
    return bytes(2, bytes(5, url));
}
