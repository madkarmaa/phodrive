import type { Command } from '@commander-js/extra-typings';
import type { AsyncResult } from 'results-ts';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { openSession, type Session } from '../accounts';
import type { CliContext, CliError, Runner } from '../context';
import { planDownloads, saveFiles } from '../downloads';
import { deleteFiles, findFiles } from '../library';
import { listFiles } from '../listing';
import { askConfirmation, canConfirm } from '../prompts';
import { chooseWorkers } from '../settings';
import { openUploads, sendFiles } from '../uploads';

function upload(
    context: CliContext,
    paths: readonly string[],
    options: { workers?: string; account?: string }
): AsyncResult<void, CliError> {
    return openSession(context, options.account).andThenAsync((session) =>
        chooseWorkers(session.config, context.environment, options.workers).andThenAsync(
            (workers) =>
                openUploads(context, paths).andThenAsync((files) =>
                    sendFiles(context, session, files, workers)
                )
        )
    );
}

function download(
    context: CliContext,
    targets: readonly string[],
    options: { output?: string; force?: boolean; account?: string }
): AsyncResult<void, CliError> {
    return openSession(context, options.account).andThenAsync((session) =>
        findFiles(context, session, targets)
            .andThenAsync((files) => planDownloads(context, files, options.output))
            .andThenAsync((planned) => saveFiles(context, session, planned, options.force ?? false))
    );
}

function confirmDeletion(
    context: CliContext,
    session: Session,
    files: readonly FileGroup[],
    confirmed?: boolean
): AsyncResult<void, CliError> {
    const names = files.map((file) => file.name).join(', ');

    return askConfirmation(context, `Delete ${names} from ${session.email}?`, confirmed);
}

function remove(
    context: CliContext,
    targets: readonly string[],
    options: { yes?: boolean; workers?: string; account?: string }
): AsyncResult<void, CliError> {
    // Fail before reading the library when no confirmation is possible.
    const confirmable = canConfirm(context, 'Deleting files needs confirmation.', options.yes);

    return confirmable
        .andThenAsync(() => openSession(context, options.account))
        .andThenAsync((session) =>
            chooseWorkers(session.config, context.environment, options.workers).andThenAsync(
                (workers) =>
                    findFiles(context, session, targets)
                        .andThenAsync((files) =>
                            confirmDeletion(context, session, files, options.yes).map(() => files)
                        )
                        .andThenAsync((files) => deleteFiles(context, session, files, workers))
            )
        );
}

const ACCOUNT_FLAGS = '-a, --account <email>';
const ACCOUNT_HELP = 'use this account instead of the active one';

export function registerFileCommands(program: Command, context: CliContext, run: Runner) {
    const file = program.command('file').description('List, upload, download, and delete files');

    file.command('list')
        .description('List files, newest first by default')
        .argument('[search]', 'show names containing this text')
        .option('--type <extension>', 'show one file type, for example pdf')
        .option('--days <days>', 'show files modified in the last number of days')
        .option('--sort <order>', 'modified-desc, modified-asc, name-asc, or name-desc')
        .option('--json', 'print JSON')
        .option(ACCOUNT_FLAGS, ACCOUNT_HELP)
        .action((search, options) => run(() => listFiles(context, search, options)));

    file.command('upload')
        .description('Upload files, and every file inside folders')
        .argument('<paths...>', 'files or folders')
        .option('-w, --workers <count>', 'concurrent transfers')
        .option(ACCOUNT_FLAGS, ACCOUNT_HELP)
        .action((paths, options) => run(() => upload(context, paths, options)));

    file.command('download')
        .description('Download files by name or ID')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-o, --output <path>', 'destination folder, or file path for one file')
        .option('-f, --force', 'replace existing local files')
        .option(ACCOUNT_FLAGS, ACCOUNT_HELP)
        .action((targets, options) => run(() => download(context, targets, options)));

    file.command('delete')
        .description('Move files to the Google Photos trash')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-y, --yes', 'skip the confirmation')
        .option('-w, --workers <count>', 'concurrent requests')
        .option(ACCOUNT_FLAGS, ACCOUNT_HELP)
        .action((targets, options) => run(() => remove(context, targets, options)));
}
