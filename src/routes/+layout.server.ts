import type { LayoutServerLoad } from './$types';
import { readPreferencesDefaults } from '#server/preferences';

export const load: LayoutServerLoad = () => ({
    preferencesDefaults: readPreferencesDefaults()
});
