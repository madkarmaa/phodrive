// The explicit package entry avoids Bun's incomplete built-in `undici` replacement.
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici/index.js';
import { Readable } from 'node:stream';

export type Fetcher = typeof fetch;

// Concurrent large Photos transfers fail with HTTP/2 stream resets on Node 26.
// Use a dedicated HTTP/1.1 pool while retaining parallel requests and TLS verification.
// New TLS connections need headroom while parallel PUTs occupy the uplink.
const PHOTOS_CONNECT_TIMEOUT_MS = 60_000;
const PHOTOS_AGENT = new Agent({ allowH2: false, connectTimeout: PHOTOS_CONNECT_TIMEOUT_MS });
const TRANSFER_BLOCK_BYTES = 64 * 1024;

function* transferBlocks(bytes: Uint8Array) {
    for (let offset = 0; offset < bytes.byteLength; offset += TRANSFER_BLOCK_BYTES)
        yield bytes.subarray(offset, offset + TRANSFER_BLOCK_BYTES);
}

/** Keep Undici's fetch and dispatcher together across Node and Bun runtimes. */
async function dispatchRequest(
    input: Parameters<Fetcher>[0],
    init: Parameters<Fetcher>[1],
    dispatcher: Dispatcher
): ReturnType<Fetcher> {
    const bytes = init?.body instanceof Uint8Array ? init.body : null;
    const request = new Request(input, bytes ? { ...init, body: undefined } : init);
    const body = bytes ?? request.body;
    const response = await undiciFetch(request.url, {
        method: request.method,
        headers: Array.from(request.headers),
        body,
        duplex: 'half',
        redirect: request.redirect,
        signal: request.signal,
        dispatcher
    });

    const reader: Pick<ReadableStreamDefaultReader<Uint8Array>, 'read' | 'cancel'> | undefined =
        response.body?.getReader();
    const stream = reader
        ? new ReadableStream<Uint8Array>({
              async pull(controller) {
                  const chunk = await reader.read();
                  if (chunk.done) {
                      controller.close();
                      return;
                  }

                  controller.enqueue(chunk.value);
              },
              cancel: (reason: unknown) => reader.cancel(reason)
          })
        : null;

    return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers)
    });
}

export const photosFetch: Fetcher = (input, init) => dispatchRequest(input, init, PHOTOS_AGENT);

/** Count socket writes, rather than reads into a local upload buffer. */
export function photosFetchWithProgress(onProgress: (sent: number) => void): Fetcher {
    return (input, init) => {
        const bytes = init?.body;
        if (init?.method !== 'PUT' || !(bytes instanceof Uint8Array))
            return photosFetch(input, init);

        const dispatcher = PHOTOS_AGENT.compose((dispatch) => (options, handler) => {
            let sent = 0;
            const original = handler.onBodySent;

            // Each fetch dispatch owns its handler. Preserve all other callbacks and their `this`.
            handler.onBodySent = (chunk) => {
                original?.call(handler, chunk);
                sent += chunk.byteLength;
                onProgress(sent);
            };

            // Fetch keeps the original Content-Length; only the transport body is streamed.
            return dispatch({ ...options, body: Readable.from(transferBlocks(bytes)) }, handler);
        });

        return dispatchRequest(input, init, dispatcher);
    };
}
