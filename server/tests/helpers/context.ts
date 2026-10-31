import { createContext } from '../../src/context';
import { parseEnvironment, type Environment } from '../../src/environment';

/** A valid environment; the database client is lazy, so tests never connect to it. */
export const TEST_ENVIRONMENT = parseEnvironment({
    DATABASE_URL: 'postgres://phodrive:phodrive@127.0.0.1:5432/phodrive-test',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    PHODRIVE_PROCESSING: 'browser'
}).unwrap();

export function testContext(environment: Partial<Environment> = {}) {
    return createContext({ ...TEST_ENVIRONMENT, ...environment });
}
