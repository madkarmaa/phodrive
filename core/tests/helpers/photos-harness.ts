import { createHash } from 'node:crypto';
import { decodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { bytesField, message, nested, numberField } from '@madkarmaa/phodrive-core/server/protobuf';

/**
 * A fake Google Photos upload API that decodes and stores each transferred BMP. `duplicate`
 * reports every hash as already stored; `failCommit` fails every commit.
 */
export function photosUploadHarness(options: { duplicate?: boolean; failCommit?: boolean } = {}) {
    const stored = new Map<string, Buffer>();
    const counts = { transfers: 0, commits: 0, largestBlock: 0 };
    const scotty = message(numberField(1, 2), bytesField(2, Uint8Array.of(7)));
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth'))
            return new Response(`Auth=bearer\nExpiry=${Date.now() / 1000 + 3600}`);
        if (url.includes('5084965799730810217')) {
            const data = await new Response(init?.body).arrayBuffer();
            const sha1 = nested(Buffer.from(data), 1, 1, 1).unwrap();
            const fields = [bytesField(1, bytesField(1, sha1))];
            if (options.duplicate || stored.has(sha1.toString('hex')))
                fields.push(bytesField(2, bytesField(1, 'existing-key')));
            return new Response(Uint8Array.from(bytesField(1, bytesField(2, message(...fields)))));
        }
        if (init?.method === 'PUT') {
            counts.transfers++;
            const reader = new Response(init.body).body!.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
                const next = await reader.read();
                if (next.done) break;
                counts.largestBlock = Math.max(counts.largestBlock, next.value.length);
                chunks.push(next.value);
            }
            const bmp = Buffer.concat(chunks);
            decodeSplitBmp(bmp).unwrap();
            const sha1 = createHash('sha1').update(bmp).digest('hex');
            stored.set(sha1, bmp);
            expectLength(init, bmp.length);
            return new Response(Uint8Array.from(scotty));
        }
        if (url.includes('uploadmedia/interactive'))
            return new Response(null, { headers: { 'x-guploader-uploadid': 'upload-id' } });
        if (url.includes('16538846908252377752')) {
            counts.commits++;
            if (options.failCommit) return new Response(null, { status: 503 });
            return new Response(
                Uint8Array.from(
                    bytesField(
                        1,
                        message(
                            bytesField(1, scotty),
                            numberField(2, 0),
                            bytesField(3, bytesField(1, 'media-key'))
                        )
                    )
                )
            );
        }
        throw new Error('Unexpected provider request');
    };
    return { fetcher, stored, counts };
}

function expectLength(init: RequestInit | undefined, length: number) {
    if (new Headers(init?.headers).get('content-length') !== String(length))
        throw new Error('Wrong streamed BMP length');
}
