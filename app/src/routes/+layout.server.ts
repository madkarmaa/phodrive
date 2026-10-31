import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { readSessionUser, signupEnabled } from '#server/auth';
import { readPreferencesDefaults } from '#server/preferences';

export const load: LayoutServerLoad = async ({ request }) => {
    const user = await readSessionUser(request.headers);

    return user.match({
        Ok: (signedIn) => ({
            preferencesDefaults: readPreferencesDefaults(),
            signupEnabled: signupEnabled(),
            user: signedIn ? { email: signedIn.email } : null
        }),
        Err: (failure) => error(failure.status, failure.message)
    });
};
