import { api } from '#server/app';
import type { RequestHandler } from './$types';

/** Hono serves the whole API; SvelteKit supplies the socket's client address. */
export const fallback: RequestHandler = ({ request, getClientAddress }) =>
    api.fetch(request, { clientAddress: getClientAddress() });
