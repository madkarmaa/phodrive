import { UploadStatus } from '$lib/models';
import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import Varint from 'varint';
import { encodeSplitBmp } from '$server/bmp';
import { downloadBmp, listBmps, moveToTrash, uploadBmp, validateAasAccount } from '$server/photos';
import type { Fetcher } from '$server/fetcher';

function varint(value: number): Buffer {
    return Buffer.from(Varint.encode(value));
}
function num(field: number, value: number): Buffer {
    return Buffer.concat([varint(field * 8), varint(value)]);
}
function bytes(field: number, data: Uint8Array | string): Buffer {
    const body = Buffer.from(data);
    return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
}

test('account validation checks the email and AAS token with Google', async () => {
    const accepted: Fetcher = async (input, init) => {
        expect(String(input)).toBe('https://android.googleapis.com/auth');
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('Email')).toBe('test@example.com');
        expect(form.get('Token')).toBe('aas_et/test');
        return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
    };
    const valid = await validateAasAccount('test@example.com', 'aas_et/test', accepted);
    expect(valid.isOk()).toBe(true);

    const rejected: Fetcher = async () => new Response('Error=BadAuthentication');
    const invalid = await validateAasAccount('test@example.com', 'aas_et/test', rejected);
    expect(invalid.match({ Ok: () => '', Err: (error) => error.message })).toBe(
        'AAS authentication failed'
    );
});

test('malformed library protobuf returns Err without throwing', async () => {
    let call = 0;
    const fakeFetch: Fetcher = async () =>
        ++call === 1
            ? new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`)
            : new Response(Uint8Array.from([10, 5, 1]));
    const result = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);
    expect(result.isErr()).toBe(true);
    expect(result.match({ Ok: () => '', Err: (error) => error.message })).toContain(
        'Truncated protobuf'
    );
});

test('Pixel XL flow hashes, transfers, and commits one BMP', async () => {
    const bmp = Buffer.from('BM test pixels');
    const sha1 = createHash('sha1').update(bmp).digest();
    const scotty = Buffer.from([8, 2, 18, 1, 7]);
    const missing = bytes(1, bytes(2, bytes(1, bytes(1, sha1))));
    const committed = bytes(
        1,
        Buffer.concat([bytes(1, scotty), num(2, 0), bytes(3, bytes(1, 'media-key'))])
    );
    let step = 0;
    const fakeFetch: Fetcher = async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        if (step++ === 0) {
            expect(url).toBe('https://android.googleapis.com/auth');
            expect(headers.get('user-agent')).toContain('Pixel XL');
            expect(String(init?.body)).toContain('Token=aas_et%2Ftest');
            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        }
        if (step === 2) {
            expect(url).toContain('photosdata-pa.googleapis.com');
            expect(headers.get('user-agent')).toContain('Pixel XL');
            return new Response(Uint8Array.from(missing));
        }
        if (step === 3) {
            expect(headers.get('x-goog-hash')).toBe(`sha1=${sha1.toString('base64')}`);
            return new Response(null, { headers: { 'X-GUploader-UploadID': 'upload-id' } });
        }
        if (step === 4) {
            expect(url).toContain('upload_id=upload-id');
            const requestBody = await new Response(init?.body).arrayBuffer();
            expect(Buffer.from(requestBody)).toEqual(bmp);
            return new Response(scotty);
        }
        expect(url).toContain('photosdata-pa.googleapis.com');
        const commitBody = await new Response(init?.body).arrayBuffer();
        expect(Buffer.from(commitBody).includes(Buffer.from('Pixel XL'))).toBe(true);
        return new Response(Uint8Array.from(committed));
    };
    const uploaded = await uploadBmp(
        'test@example.com',
        'aas_et/test',
        'sample.bmp',
        bmp,
        fakeFetch
    );
    expect(uploaded.unwrap()).toEqual({
        status: UploadStatus.Uploaded,
        mediaKey: 'media-key',
        sha1: sha1.toString('hex')
    });
    expect(step).toBe(5);
});

test('a connection timeout during commit remains uncertain and is never retried automatically', async () => {
    const bmp = Buffer.from('BM test pixels');
    const sha1 = createHash('sha1').update(bmp).digest();
    const missing = bytes(1, bytes(2, bytes(1, bytes(1, sha1))));
    const scotty = Buffer.from([8, 2, 18, 1, 7]);
    const responses = [
        new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`),
        new Response(Uint8Array.from(missing)),
        new Response(null, { headers: { 'X-GUploader-UploadID': 'upload-id' } }),
        new Response(scotty)
    ];
    let requests = 0;
    const fakeFetch: Fetcher = async () => {
        const response = responses[requests++];
        if (response) return response;

        const cause = Object.assign(new Error('Connection timed out'), {
            code: 'UND_ERR_CONNECT_TIMEOUT'
        });

        throw new TypeError('fetch failed', { cause });
    };

    const uploaded = await uploadBmp(
        'test@example.com',
        'aas_et/test',
        'sample.bmp',
        bmp,
        fakeFetch
    );

    expect(uploaded.unwrapErr().message).toBe(
        'Commit outcome uncertain. Check Google Photos before retrying.'
    );
    expect(requests).toBe(5);
});

test('download verifies the original and trash targets its dedup key', async () => {
    const bmp = Buffer.from('BM test pixels');
    const sha1 = createHash('sha1').update(bmp).digest();
    const signed = 'https://lh3.googleusercontent.com/p/test=d';
    const metadata = bytes(
        1,
        Buffer.concat([
            bytes(1, 'media-key'),
            bytes(2, bytes(13, bytes(1, sha1))),
            bytes(5, bytes(2, bytes(5, signed)))
        ])
    );
    let step = 0;
    const fakeFetch: Fetcher = async (input, init) => {
        const url = String(input);
        step++;
        if (step === 1 || step === 4)
            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        if (step === 2) {
            expect(url).toContain('PhotosPrepareDownload');
            return new Response(Uint8Array.from(metadata));
        }
        if (step === 3) {
            expect(url).toBe(signed);
            return new Response(Uint8Array.from(bmp), { headers: { 'content-type': 'image/bmp' } });
        }
        expect(url).toContain('17490284929287180316');
        const requestBody = await new Response(init?.body).arrayBuffer();
        const body = Buffer.from(requestBody);
        expect(body.subarray(0, 2)).toEqual(Buffer.from([16, 1]));
        expect(body.includes(Buffer.from(sha1.toString('base64url')))).toBe(true);
        return new Response(Uint8Array.from([]));
    };
    const downloaded = await downloadBmp(
        'test@example.com',
        'aas_et/test',
        'media-key',
        sha1.toString('hex'),
        fakeFetch
    );
    expect(downloaded.unwrap()).toEqual(bmp);
    const deleted = await moveToTrash(
        'test@example.com',
        'aas_et/test',
        sha1.toString('hex'),
        fakeFetch
    );
    expect(deleted.isOk()).toBe(true);
    expect(step).toBe(5);
});

test('library finds renamed BMP chunks from their headers and ignores ordinary photos', async () => {
    const fileHash = 'a'.repeat(64);
    const first = Buffer.from(
        encodeSplitBmp(Uint8Array.of(1, 2), {
            fileHash,
            chunkIndex: 0,
            flags: 0,
            payloadSize: 2,
            fileName: 'original.bin'
        }).unwrap()
    );
    const last = Buffer.from(
        encodeSplitBmp(Uint8Array.of(3), {
            fileHash,
            chunkIndex: 1,
            flags: 1,
            payloadSize: 1
        }).unwrap()
    );
    const ordinary = Buffer.alloc(first.length);
    const originals = new Map([
        ['renamed-first', first],
        ['renamed-last', last],
        ['ordinary-photo', ordinary]
    ]);
    const fingerprint = (data: Buffer) => createHash('sha1').update(data).digest();
    const item = (key: string, remoteName: string, trashed = false) => {
        const data = originals.get(key) ?? first;
        const details = Buffer.concat([
            bytes(4, remoteName),
            num(9, 42),
            num(10, data.length),
            bytes(13, bytes(1, fingerprint(data))),
            ...(trashed ? [bytes(16, num(3, 1))] : [])
        ]);

        return bytes(2, Buffer.concat([bytes(1, key), bytes(2, details)]));
    };
    const firstPage = bytes(
        1,
        Buffer.concat([
            bytes(1, 'next-page'),
            item('renamed-first', 'vacation.jpg'),
            item('ordinary-photo', 'family.jpg')
        ])
    );
    const secondPage = bytes(
        1,
        Buffer.concat([
            item('renamed-first', 'deleted-copy.bmp', true),
            item('renamed-last', 'untitled')
        ])
    );
    let libraryCalls = 0;
    let prefixCalls = 0;
    let failPrefix = false;

    const fakeFetch: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth'))
            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);

        if (url.includes('18047484249733410717')) {
            const requestBytes = await new Response(init?.body).arrayBuffer();
            const body = Buffer.from(requestBytes);
            if (libraryCalls++) expect(body.includes(Buffer.from('next-page'))).toBe(true);
            else expect(body.includes(Buffer.from('next-page'))).toBe(false);
            return new Response(Uint8Array.from(libraryCalls === 1 ? firstPage : secondPage));
        }

        if (url.includes('PhotosPrepareDownload')) {
            const requestBytes = await new Response(init?.body).arrayBuffer();
            const request = Buffer.from(requestBytes);
            const entry = [...originals].find(([key]) => request.includes(Buffer.from(key)));
            if (!entry) throw new Error('Missing test item');

            const [key, data] = entry;
            const metadata = bytes(
                1,
                Buffer.concat([
                    bytes(1, key),
                    bytes(2, bytes(13, bytes(1, fingerprint(data)))),
                    bytes(5, bytes(2, bytes(5, `https://lh3.googleusercontent.com/p/${key}=d`)))
                ])
            );
            return new Response(Uint8Array.from(metadata));
        }

        const key = url.split('/').pop()?.replace('=d', '') ?? '';
        const data = originals.get(key);
        if (!data) throw new Error('Missing test photo');
        expect(new Headers(init?.headers).get('range')).toBe('bytes=0-65535');
        prefixCalls++;
        if (failPrefix && key === 'renamed-first') return new Response(null, { status: 503 });

        return new Response(Uint8Array.from(data), { status: 206 });
    };

    const firstResult = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);
    const firstItems = firstResult.unwrap();
    expect(firstItems.items).toEqual([
        {
            originalName: 'original.bin',
            fileHash,
            chunkIndex: 0,
            isLast: false,
            size: first.length,
            at: 42,
            mediaKey: 'renamed-first',
            sha1: fingerprint(first).toString('hex')
        }
    ]);

    const secondResult = await listBmps(
        'test@example.com',
        'aas_et/test',
        firstItems.nextPageToken,
        fakeFetch
    );
    expect(secondResult.unwrap().items).toEqual([
        {
            originalName: undefined,
            fileHash,
            chunkIndex: 1,
            isLast: true,
            size: last.length,
            at: 42,
            mediaKey: 'renamed-last',
            sha1: fingerprint(last).toString('hex')
        }
    ]);
    expect(libraryCalls).toBe(2);
    expect(prefixCalls).toBe(3);

    failPrefix = true;
    libraryCalls = 0;

    const failedRefresh = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);
    expect(failedRefresh.unwrapErr().message).toBe('Could not inspect photo header');
});
