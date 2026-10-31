import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Err, Ok, type AsyncResult } from 'results-ts';

/** Apply pending migrations over one short-lived connection before the server accepts requests. */
export function migrateDatabase(url: string, migrationsFolder: string): AsyncResult<void, string> {
    return Ok(undefined).andThenAsync(async () => {
        const database = drizzle({ connection: { url, max: 1, onnotice: () => {} } });

        try {
            await migrate(database, { migrationsFolder });

            return Ok(undefined);
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error';

            return Err(`Could not migrate the database: ${reason}`);
        } finally {
            await database.$client.end();
        }
    });
}
