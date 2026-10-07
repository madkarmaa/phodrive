import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Fetcher } from '#server/fetcher';
import { bytesField, message, nested, numberField } from '#server/protobuf';

/** No provider latency or retained upload bodies; consume every transferred byte. */
export function provider(options: { duplicate?: boolean; failCommit?: boolean } = {}) {
    const stored = new Set<string>();
    const counts = { transfers: 0, commits: 0, bytes: 0 };
    const scotty = message(numberField(1, 2), bytesField(2, Uint8Array.of(7)));
    const send = async (
        input: Parameters<Fetcher>[0],
        init: Parameters<Fetcher>[1],
        onProgress?: (sent: number) => void
    ): Promise<Response> => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth'))
            return new Response('Auth=benchmark\nExpiry=9999999999');
        if (url.includes('5084965799730810217')) {
            const data = await new Response(init?.body).arrayBuffer();
            const hash = nested(Buffer.from(data), 1, 1, 1).match({
                Ok: (value) => value,
                Err: (error) => assert.fail(error.message)
            });
            const fields = [bytesField(1, bytesField(1, hash))];
            if (options.duplicate || stored.has(hash.toString('hex')))
                fields.push(bytesField(2, bytesField(1, 'existing')));
            return new Response(Uint8Array.from(bytesField(1, bytesField(2, message(...fields)))));
        }
        if (init?.method === 'PUT') {
            counts.transfers++;
            const reader = new Response(init.body).body!.getReader();
            const hash = createHash('sha1');
            let length = 0;
            try {
                while (true) {
                    const next = await reader.read();
                    if (next.done) break;
                    hash.update(next.value);
                    length += next.value.length;
                    onProgress?.(length);
                }
            } finally {
                reader.releaseLock();
            }
            assert.equal(length, Number(new Headers(init.headers).get('content-length')));
            stored.add(hash.digest('hex'));
            counts.bytes += length;
            return new Response(Uint8Array.from(scotty));
        }
        if (url.includes('uploadmedia/interactive'))
            return new Response(null, { headers: { 'x-guploader-uploadid': 'fixture' } });
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
                            bytesField(3, bytesField(1, 'confirmed'))
                        )
                    )
                )
            );
        }
        assert.fail('Unexpected provider request');
    };
    const fetcher: Fetcher = (input, init) => send(input, init);
    const fetcherWithProgress =
        (onProgress: (sent: number) => void): Fetcher =>
        (input, init) =>
            send(input, init, onProgress);
    return { fetcher, fetcherWithProgress, counts };
}
