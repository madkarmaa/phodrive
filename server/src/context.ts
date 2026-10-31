import { createAuth, type Auth } from './auth';
import { createDatabase, type Database } from './db/client';
import type { Environment } from './environment';

/** Everything a request handler needs, created once from the validated environment. */
export interface ServerContext {
    env: Environment;
    db: Database;
    auth: Auth;
}

export function createContext(env: Environment): ServerContext {
    const db = createDatabase(env.DATABASE_URL);

    return { env, db, auth: createAuth(env, db) };
}
