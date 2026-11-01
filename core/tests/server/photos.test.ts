import { createHash } from 'node:crypto';
import { UploadStatus } from '@madkarmaa/phodrive-core/models';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { uploadBmp, validateAasAccount } from '@madkarmaa/phodrive-core/server/photos';
import { expect, test } from 'vitest';
import { authResponse, bytes, num } from '../helpers/protobuf';

test('account validation checks the email and AAS token with Google', async () => {
    const accepted: Fetcher = async (input, init) => {
        expect(String(input)).toBe('https://android.googleapis.com/auth');
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('Email')).toBe('test@example.com');
        expect(form.get('Token')).toBe('aas_et/test');
        return authResponse();
    };
    const valid = await validateAasAccount('test@example.com', 'aas_et/test', accepted);
    expect(valid.isOk()).toBe(true);

    const rejected: Fetcher = async () => new Response('Error=BadAuthentication');
    const invalid = await validateAasAccount('test@example.com', 'aas_et/test', rejected);
    expect(invalid.match({ Ok: () => '', Err: (error) => error.message })).toBe(
        'AAS authentication failed'
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
        expect(init?.signal).toBeUndefined();
        if (step++ === 0) {
            expect(url).toBe('https://android.googleapis.com/auth');
            expect(headers.get('user-agent')).toContain('Pixel XL');
            expect(String(init?.body)).toContain('Token=aas_et%2Ftest');
            return authResponse();
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
        authResponse(),
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

    expect(uploaded.unwrapErr()).toEqual({
        code: 'COMMIT_OUTCOME_UNCERTAIN',
        message: 'Commit outcome uncertain. Check Google Photos before retrying.'
    });
    expect(requests).toBe(5);
});
