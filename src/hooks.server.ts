import type { Handle } from '@sveltejs/kit';
import { readPreferencesDefaults } from '$server/preferences';

const THEME_PLACEHOLDER = '%phodrive.theme%';

export const handle: Handle = ({ event, resolve }) => {
    const defaults = readPreferencesDefaults();

    return resolve(event, {
        transformPageChunk: ({ html }) => html.replaceAll(THEME_PLACEHOLDER, defaults.theme)
    });
};
