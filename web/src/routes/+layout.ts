import { error } from '@sveltejs/kit';
import { readSession } from '#browser/auth';
import type { LayoutLoad } from './$types';

// The API server serves this app as static files, so it renders only in the browser.
export const ssr = false;

export const load: LayoutLoad = async () => {
    const session = await readSession();

    return session.match({
        Ok: (data) => data,
        Err: (failure) => error(503, failure.message)
    });
};
