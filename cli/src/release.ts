import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { z } from 'zod';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import { version } from '../package.json';
import type { CliContext, CliError } from './context';
import { activity } from './output';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/madkarmaa/phodrive/releases/latest';

const ReleaseSchema = z.object({
    tag_name: z.string(),
    assets: z.array(
        z.object({
            name: z.string(),
            size: z.int().nonnegative(),
            browser_download_url: z.url(),
            digest: z.string().nullish()
        })
    )
});

export type Release = z.infer<typeof ReleaseSchema>;
export type Asset = Release['assets'][number];

export function updateFailure(message: string): CliError {
    return { code: 'UPDATE_FAILED', message } as const;
}

export function fetchLatestRelease(context: CliContext): AsyncResult<Release, CliError> {
    return Ok(undefined).andThenAsync<Release, CliError>(async () => {
        const indicator = activity(context, 'Checking for updates');
        let body: unknown;

        try {
            const response = await fetch(LATEST_RELEASE_URL, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': `phodrive/${version}`
                },
                signal: context.signal
            });
            if (!response.ok) {
                indicator.fail();

                return Err(updateFailure(`GitHub answered with HTTP ${response.status}.`));
            }

            body = await response.json();
        } catch {
            indicator.fail();

            return Err(updateFailure('Could not reach GitHub.'));
        }

        indicator.stop('Checked for updates');

        return schemaResult(ReleaseSchema, body, 'GitHub returned an unexpected release.');
    });
}

export function findAsset(release: Release, name: string): Result<Asset, CliError> {
    const asset = release.assets.find((candidate) => candidate.name === name);
    if (!asset)
        return Err(
            updateFailure(`The latest release, ${release.tag_name}, has no ${name} download.`)
        );

    return Ok(asset);
}
