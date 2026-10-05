import { createServer } from 'node:http';
import { handler } from '#build-handler';
import { parseServerEnvironment } from './lib/server/environment.js';

const environment = parseServerEnvironment(process.env);

export const server = createServer({ requestTimeout: 0, headersTimeout: 0 }, handler);

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
