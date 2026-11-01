import { createHash } from 'node:crypto';
import type { SplitHeader } from '@madkarmaa/phodrive-core/models';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { nested } from '@madkarmaa/phodrive-core/server/protobuf';
import { expect, test } from 'vitest';
import { authResponse, bytes, downloadMetadata, imageDownload, num } from '../helpers/protobuf';

const EMAIL = 'test@example.com';
const TOKEN = 'aas_et/test';
const AUTH_URL = 'android.googleapis.com/auth';
const LIBRARY_RPC = '18047484249733410717';
const FILE_HASH = 'a'.repeat(64);

function fingerprint(data: Buffer): Buffer {
    return createHash('sha1').update(data).digest();
}

function splitChunk(
    payload: Uint8Array,
    chunkIndex: number,
    isLast: boolean,
    fileName?: string
): Buffer {
    const header: SplitHeader = {
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex,
        flags: isLast ? 1 : 0,
        payloadSize: payload.length,
        fileName
    };

    return Buffer.from(encodeSplitBmp(payload, header).unwrap());
}

/**
 * A two-chunk file renamed in Google Photos beside ordinary photos and videos. The first page
 * continues through an empty page; the second holds the last chunk and a trashed copy.
 */
function libraryFixture(emptyFinalPage: boolean) {
    const first = splitChunk(Uint8Array.of(1, 2), 0, false, 'original.bin');
    const last = splitChunk(Uint8Array.of(3), 1, true);
    const ordinary = Buffer.alloc(first.length);
    const originals = new Map([
        ['renamed-first', first],
        ['renamed-last', last],
        ['ordinary-video', ordinary],
        ['ordinary-photo', ordinary]
    ]);
    const calls = { library: 0, prefix: 0, failPrefix: false };

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
    const pages = new Map([
        [
            '',
            bytes(
                1,
                Buffer.concat([
                    bytes(1, 'empty-page'),
                    item('renamed-first', 'vacation.jpg'),
                    item('ordinary-video', 'clip.mp4'),
                    item('ordinary-photo', 'family.jpg')
                ])
            )
        ],
        ['empty-page', bytes(1, bytes(1, 'next-page'))],
        [
            'next-page',
            emptyFinalPage
                ? bytes(1, bytes(6, 'next-sync'))
                : bytes(
                      1,
                      Buffer.concat([
                          item('renamed-first', 'deleted-copy.bmp', true),
                          item('renamed-last', 'untitled')
                      ])
                  )
        ]
    ]);

    const libraryPage = async (body: BodyInit | null | undefined) => {
        const requestBytes = await new Response(body).arrayBuffer();
        const pageToken = nested(Buffer.from(requestBytes), 1, 4).match({
            Ok: (value) => value.toString(),
            Err: () => ''
        });
        const page = pages.get(pageToken);
        expect(page).toBeDefined();
        calls.library++;

        return new Response(Uint8Array.from(page ?? []));
    };

    const prepareDownload = async (body: BodyInit | null | undefined) => {
        const requestBytes = await new Response(body).arrayBuffer();
        const request = Buffer.from(requestBytes);
        const entry = [...originals].find(([key]) => request.includes(Buffer.from(key)));
        if (!entry) throw new Error('Missing test item');

        const [key, data] = entry;
        const download =
            key === 'ordinary-video'
                ? Buffer.concat([num(1, 2), bytes(3, bytes(5, 'video-download'))])
                : imageDownload(`https://lh3.googleusercontent.com/p/${key}=d`);

        return new Response(Uint8Array.from(downloadMetadata(key, fingerprint(data), download)));
    };

    /** Only the start of each photo is read, to find split-file headers. */
    const photoPrefix = (url: string, headers: HeadersInit | undefined) => {
        const key = url.split('/').pop()?.replace('=d', '') ?? '';
        expect(key).not.toBe('ordinary-video');
        const data = originals.get(key);
        if (!data) throw new Error('Missing test photo');

        expect(new Headers(headers).get('range')).toBe('bytes=0-65535');
        calls.prefix++;
        if (calls.failPrefix && key === 'renamed-first') return new Response(null, { status: 503 });

        return new Response(Uint8Array.from(data), { status: 206 });
    };

    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes(AUTH_URL)) return authResponse();
        if (url.includes(LIBRARY_RPC)) return libraryPage(init?.body);
        if (url.includes('PhotosPrepareDownload')) return prepareDownload(init?.body);

        return photoPrefix(url, init?.headers);
    };

    return { first, last, calls, fetcher };
}

test('malformed library protobuf returns Err without throwing', async () => {
    let call = 0;
    const fakeFetch: Fetcher = async () =>
        ++call === 1 ? authResponse() : new Response(Uint8Array.from([10, 5, 1]));
    const result = await listBmps(EMAIL, TOKEN, '', fakeFetch);
    expect(result.isErr()).toBe(true);
    expect(result.match({ Ok: () => '', Err: (error) => error.message })).toContain(
        'Truncated protobuf'
    );
});

test.each([false, true])(
    'library discovers file pages and hides empty continuations (empty final page: %s)',
    async (emptyFinalPage) => {
        const { first, last, calls, fetcher } = libraryFixture(emptyFinalPage);
        const chunk = { fileHash: FILE_HASH, fileId: FILE_HASH, at: 42 };

        const firstResult = await listBmps(EMAIL, TOKEN, '', fetcher);
        const firstItems = firstResult.unwrap();
        expect(firstItems.items).toEqual([
            {
                ...chunk,
                originalName: 'original.bin',
                chunkIndex: 0,
                isLast: false,
                size: 2,
                mediaKey: 'renamed-first',
                sha1: fingerprint(first).toString('hex')
            }
        ]);
        expect(firstItems.nextPageToken).toBe(
            emptyFinalPage ? '' : Buffer.from('next-page').toString('base64url')
        );
        expect(calls.library).toBe(3);

        if (!emptyFinalPage) {
            const secondResult = await listBmps(EMAIL, TOKEN, firstItems.nextPageToken, fetcher);
            expect(secondResult.unwrap().items).toEqual([
                {
                    ...chunk,
                    originalName: undefined,
                    chunkIndex: 1,
                    isLast: true,
                    size: 1,
                    mediaKey: 'renamed-last',
                    sha1: fingerprint(last).toString('hex')
                }
            ]);
            expect(calls.library).toBe(4);
            expect(calls.prefix).toBe(4);
        }

        calls.failPrefix = true;
        const failedRefresh = await listBmps(EMAIL, TOKEN, '', fetcher);
        expect(failedRefresh.unwrapErr().message).toBe('Could not inspect photo header');
    }
);

test('library lookahead propagates failures and rejects repeated continuation tokens', async () => {
    let failContinuation = false;
    let libraryCalls = 0;
    const fakeFetch: Fetcher = async (input) => {
        if (String(input).includes(AUTH_URL)) return authResponse();

        libraryCalls++;
        if (failContinuation && libraryCalls > 1) return new Response(null, { status: 503 });

        return new Response(Uint8Array.from(bytes(1, bytes(1, 'repeat-page'))));
    };

    const repeated = await listBmps(EMAIL, TOKEN, '', fakeFetch);

    expect(repeated.unwrapErr().code).toBe('REPEATED_LIBRARY_PAGE');
    expect(libraryCalls).toBe(2);

    libraryCalls = 0;
    failContinuation = true;
    const failed = await listBmps(EMAIL, TOKEN, '', fakeFetch);

    expect(failed.unwrapErr().message).toBe('Library list failed (HTTP 503)');
    expect(libraryCalls).toBe(2);
});
