import { expect, test } from 'vitest';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { buffer } from 'node:stream/consumers';
import { photosFetchWithProgress } from '$server/fetcher';

test('Photos transport reports incremental socket writes and preserves exact bytes', async () => {
    const payload = Buffer.alloc(1024 * 1024, 0x42);
    const reports: number[] = [];
    let responseComplete = false;
    let receivedBytes = Buffer.alloc(0);
    let contentLength: string | undefined;

    const server = createServer(async (request, response) => {
        receivedBytes = await buffer(request);
        contentLength = request.headers['content-length'];
        response.end('received');
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
        const address = server.address();
        assert(address !== null && typeof address !== 'string');

        const fetcher = photosFetchWithProgress((sent) => {
            expect(responseComplete).toBe(false);
            reports.push(sent);
        });
        const response = await fetcher(`http://127.0.0.1:${address.port}`, {
            method: 'PUT',
            body: payload
        });
        const responseText = await response.text();
        responseComplete = true;

        expect(responseText).toBe('received');
        expect(contentLength).toBe(String(payload.length));
        expect(receivedBytes).toEqual(payload);
        expect(reports.length).toBeGreaterThan(2);
        expect(reports[0]).toBeGreaterThan(0);
        expect(reports[0]).toBeLessThan(payload.length);
        expect(reports.at(-1)).toBe(payload.length);
        expect(reports).toEqual(reports.toSorted((first, second) => first - second));
    } finally {
        server.closeAllConnections();
        server.close();
    }
});
