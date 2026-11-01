import { join } from 'node:path';
import { Ok } from 'results-ts';
import { vi } from 'vitest';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { readLibrary } from '@madkarmaa/phodrive-core/node';
import { writeConfig } from '../../src/config';
import { AAS_TOKEN, EMAIL, temporaryFolder } from './cli';

/** A temporary working folder whose config has one connected, active account. */
export async function configuredFolder() {
    const folder = await temporaryFolder();
    await writeConfig(join(folder.path, 'config', 'config.json'), {
        accounts: { [EMAIL]: AAS_TOKEN },
        selected: EMAIL,
        settings: {}
    });

    return folder;
}

/** The mocked library read returns these files; callers must mock `@madkarmaa/phodrive-core/node`. */
export function library(files: FileGroup[]) {
    vi.mocked(readLibrary).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(files))
    );
}
