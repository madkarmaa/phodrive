import { createServer } from 'node:http';
import { parseServerEnvironment } from './lib/server/environment.js';

const INTERNAL_PROTOCOL_HEADER = 'x-phodrive-protocol';

// Adapter-node otherwise assumes HTTPS when deriving the origin from Host.
process.env.PROTOCOL_HEADER ||= INTERNAL_PROTOCOL_HEADER;
const { handler } = await import('#build-handler');

const environment = parseServerEnvironment(process.env);

export const server = createServer(
    { requestTimeout: 0, headersTimeout: 0 },
    (request, response) => {
        // This server receives HTTP directly; never trust a client-supplied internal protocol.
        request.headers[INTERNAL_PROTOCOL_HEADER] = 'http';
        handler(request, response);
    }
);

environment.match({
    Ok: ({ HOST, PORT }) => {
        server.listen(PORT, HOST, () => {
            console.log(`Listening on http://${HOST}:${PORT}`);
        });
    },
    Err: (message) => {
        console.error(message);
        process.exitCode = 1;
    }
});

function shutdown() {
    server.close();
    server.closeIdleConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
