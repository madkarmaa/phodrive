import { createHash } from 'node:crypto';
import type { SplitHeader } from '@madkarmaa/phodrive-core/models';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { nested } from '@madkarmaa/phodrive-core/server/protobuf';
import { expect } from 'vitest';
import { authResponse, bytes, downloadMetadata, imageDownload, num } from './protobuf';

export const EMAIL = 'test@example.com';
export const TOKEN = 'aas_et/test';
export const AUTH_URL = 'android.googleapis.com/auth';
const LIBRARY_RPC = '18047484249733410717';
export const FILE_HASH = 'a'.repeat(64);

export function fingerprint(data: Buffer): Buffer {
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
export function libraryFixture(emptyFinalPage: boolean) {
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
