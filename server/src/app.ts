import { Hono } from 'hono';
import { errorResponse } from './api';
import type { ServerContext } from './context';
import { AUTH_ERRORS } from './errors';
import type { ApiEnv } from './middleware';
import { accountRoutes, authRoutes, sessionRoutes } from './routes/account';
import { driveRoutes } from './routes/drive';

/** The JSON API under /api; the caller sets the `clientAddress` variable for each request. */
export function createApi(context: ServerContext) {
    return (
        new Hono<ApiEnv>()
            .basePath('/api')
            .route('/session', sessionRoutes(context))
            .route('/auth', authRoutes(context))
            .route('/account', accountRoutes(context))
            .route('/', driveRoutes(context))
            // A mounted app's notFound handler is not used, so unknown API paths end here instead.
            .all('*', () => errorResponse(AUTH_ERRORS.NOT_FOUND))
    );
}
