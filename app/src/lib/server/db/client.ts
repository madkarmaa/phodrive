import * as env from '$app/env/private';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '#server/db/schema';

/** postgres.js connects lazily, so importing the client opens no connection. */
export const db = drizzle({ connection: env.DATABASE_URL, schema });
