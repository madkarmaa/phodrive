import * as env from '$app/env/private';
import type { ProcessingMode } from '@madkarmaa/phodrive-core/models';

/** Small servers leave splitting and encoding to browsers; powerful ones do it themselves. */
export function processingMode(): ProcessingMode {
    return env.PHODRIVE_PROCESSING;
}
