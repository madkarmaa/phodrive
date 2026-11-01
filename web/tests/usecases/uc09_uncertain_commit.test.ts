import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { findBmpBySha1, uploadBmp } from '@madkarmaa/phodrive-core/server/photos';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';

function varint(value: number): Buffer {
    const result: number[] = [];
    let remaining = value;
    while (remaining > 127) {
        result.push((remaining & 127) | 128);
        remaining >>>= 7;
    }
    result.push(remaining);
    return Buffer.from(result);
}

function bytes(field: number, value: Uint8Array | string): Buffer {
    const body = Buffer.from(value);
    return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
}

test('a commit timeout is not automatically retried, and an explicit dedup lookup can resolve it', async () => {
    const bmp = Buffer.from('synthetic protocol fixture');
    const sha1 = createHash('sha1').update(bmp).digest();
    const missing = bytes(1, bytes(2, bytes(1, bytes(1, sha1))));
    const scotty = Buffer.from([8, 2, 18, 1, 7]);
    const found = bytes(
        1,
        bytes(
            2,
            Buffer.concat([bytes(1, bytes(1, sha1)), bytes(2, bytes(1, 'resolved-media-key'))])
        )
    );
    let requestCount = 0;
    let startCount = 0;
    let transferCount = 0;
    let commitCount = 0;

    const fakeFetch: Fetcher = async (input) => {
        requestCount++;
        const url = String(input);

        if (url.includes('android.googleapis.com/auth'))
            return new Response(`Auth=fake-bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        if (url.includes('/5084965799730810217')) return new Response(Uint8Array.from(missing));
        if (url.includes('upload_id=synthetic-upload')) {
            transferCount++;
            return new Response(scotty);
        }
        if (url.startsWith('https://photos.googleapis.com/data/upload/')) {
            startCount++;
            return new Response(null, { headers: { 'X-GUploader-UploadID': 'synthetic-upload' } });
        }
        if (url.includes('/16538846908252377752')) {
            commitCount++;
            const cause = Object.assign(new Error('synthetic timeout'), {
                code: 'UND_ERR_CONNECT_TIMEOUT'
            });
            throw new TypeError('synthetic fetch failure', { cause });
        }
        return new Response('unexpected synthetic protocol request', { status: 500 });
    };

    const failed = await uploadBmp(
        'test@example.com',
        'aas_et/fake-test-token',
        'synthetic.bmp',
        bmp,
        fakeFetch
    );

    expect(failed.match({ Ok: () => '', Err: (error) => error.message })).toBe(
        'Commit outcome uncertain. Check Google Photos before retrying.'
    );
    expect({ requestCount, startCount, transferCount, commitCount }).toEqual({
        requestCount: 5,
        startCount: 1,
        transferCount: 1,
        commitCount: 1
    });

    const lookupFetch: Fetcher = async (input) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth'))
            return new Response(`Auth=fake-bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        if (url.includes('/5084965799730810217')) return new Response(Uint8Array.from(found));

        return new Response('unexpected synthetic lookup request', { status: 500 });
    };
    const lookup = await findBmpBySha1(
        'test@example.com',
        'aas_et/fake-test-token',
        sha1.toString('hex'),
        lookupFetch
    );

    expect(lookup.match({ Ok: (key) => key, Err: () => null })).toBe('resolved-media-key');
    expect({ requestCount, startCount, transferCount, commitCount }).toEqual({
        requestCount: 5,
        startCount: 1,
        transferCount: 1,
        commitCount: 1
    });
});
