import { randomUUID } from 'node:crypto';
import { realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { version } from '../package.json';
import type { CliContext, CliError } from './context';
import { status } from './output';
import { downloadAsset } from './asset-download';
import { fetchLatestRelease, findAsset, updateFailure, type Asset } from './release';

// Release builds define this as their GitHub release asset name; npm builds leave it undefined.
declare const PHODRIVE_RELEASE_ASSET: string | undefined;

export const RELEASE_ASSET =
    typeof PHODRIVE_RELEASE_ASSET === 'string' ? PHODRIVE_RELEASE_ASSET : undefined;

/** Windows locks a running executable but still lets it be renamed out of the way. */
function replaceWindowsExecutable(temporary: string, target: string): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const previous = `${target}.old`;

        try {
            await rm(previous, { force: true });
            await rename(target, previous);
        } catch {
            return Err(updateFailure(`Could not replace ${target}.`));
        }

        try {
            await rename(temporary, target);
        } catch {
            await rename(previous, target).catch(() => {});

            return Err(updateFailure(`Could not replace ${target}.`));
        }

        return Ok(undefined);
    });
}

function replaceExecutable(temporary: string, target: string): AsyncResult<void, CliError> {
    if (process.platform === 'win32') return replaceWindowsExecutable(temporary, target);

    return Ok(undefined).andThenAsync(async () => {
        try {
            await rename(temporary, target);
        } catch {
            return Err(updateFailure(`Could not replace ${target}.`));
        }

        return Ok(undefined);
    });
}

/** The download lands beside the executable so the final rename stays on one filesystem. */
function installAsset(
    context: CliContext,
    executable: string,
    asset: Asset
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        let target: string;

        try {
            target = await realpath(executable);
        } catch {
            return Err(updateFailure(`Could not find ${executable}.`));
        }

        const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.part`);

        const downloaded = await downloadAsset(context, asset, temporary);
        const installed = await downloaded.andThenAsync(() => replaceExecutable(temporary, target));

        if (installed.isErr()) await rm(temporary, { force: true }).catch(() => {});

        return installed;
    });
}

export function updateExecutable(context: CliContext): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        const { release } = context;
        if (!release)
            return Err({
                code: 'UPDATE_UNSUPPORTED',
                message:
                    '`phodrive update` replaces executables downloaded from GitHub releases. Update an npm install with `npm install --global @madkarmaa/phodrive-cli@latest`.'
            } as const);

        return await fetchLatestRelease(context).andThenAsync<void, CliError>(async (latest) => {
            const latestVersion = latest.tag_name.replace(/^v/, '');
            if (latestVersion === version) {
                status(context).success(`phodrive ${version} is up to date`);

                return Ok(undefined);
            }

            const installed = await findAsset(latest, release.asset).andThenAsync((asset) =>
                installAsset(context, release.executable, asset)
            );

            return installed.map(() =>
                status(context).success(`Updated phodrive from ${version} to ${latestVersion}`)
            );
        });
    });
}
