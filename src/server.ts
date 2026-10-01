import { createServer } from 'node:http';
import { handler } from '#build-handler';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);

export const server = createServer({ requestTimeout: 0, headersTimeout: 0 }, handler);

server.listen(PORT, HOST, () => {
    console.log(`Listening on http://${HOST}:${PORT}`);
});

function shutdown() {
    server.close();
    server.closeIdleConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
