import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { Err, Ok, type Result } from 'results-ts';

export * from '@madkarmaa/phodrive-core/browser/files';

const DOWNLOAD_URL_LIFETIME_MS = 60_000;

/** Keep the object URL alive long enough for the browser to start saving the blob. */
export function saveDownloadedFile(file: Blob, name: string): Result<void, ApplicationError> {
    let url: string | undefined;

    try {
        url = URL.createObjectURL(file);

        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();

        return Ok(undefined);
    } catch {
        return Err({
            code: 'DOWNLOAD_SAVE_FAILED',
            message: 'Could not save the downloaded file.'
        } as const);
    } finally {
        if (url) {
            const objectUrl = url;
            setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_LIFETIME_MS);
        }
    }
}
