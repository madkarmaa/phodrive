import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

/** postgres.js connects lazily, so creating the client opens no connection. */
export function createDatabase(url: string) {
    return drizzle({ connection: url, schema });
}

export type Database = ReturnType<typeof createDatabase>;
