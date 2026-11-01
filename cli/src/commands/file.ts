import type { Command } from '@commander-js/extra-typings';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { filterFiles, sortFiles, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { FileSort } from '@madkarmaa/phodrive-core/models';
import { openSession, type Session } from '../accounts';
import type { CliContext, CliError, Runner } from '../context';
import { planDownloads, saveFiles } from '../downloads';
import { deleteFiles, findFiles, loadFiles } from '../library';
import {
    FILE_TABLE_HEAD,
    fileJson,
    fileRow,
    jsonContext,
    printJson,
    printTable,
    status
} from '../output';
import { askConfirmation, canConfirm } from '../prompts';
import { chooseSort, chooseWorkers } from '../settings';
import { openUploads, sendFiles } from '../uploads';

const DAYS_PATTERN = /^[1-9]\d*$/;

type ListOptions = { type?: string; days?: string; sort?: string; json?: boolean };
type Filters = { query: string; type: string; days: string; order: FileSort };

function parseDays(option?: string): Result<string, CliError> {
    if (option === undefined) return Ok('');

    const days = option.trim();
    if (DAYS_PATTERN.test(days)) return Ok(days);

    return Err({
        code: 'INVALID_OPTION',
        message: 'Invalid days. Use a whole number of days greater than 0.'
    } as const);
}

function parseFilters(
    context: CliContext,
    session: Session,
    query: string | undefined,
    options: ListOptions
): Result<Filters, CliError> {
    return parseDays(options.days).andThen((days) =>
        chooseSort(session.config, context.environment, options.sort).map((order) => ({
            query: query ?? '',
            type: options.type?.trim().toUpperCase() ?? '',
            days,
            order
        }))
    );
}

function showFiles(
    context: CliContext,
    files: readonly FileGroup[],
    filters: Filters,
    json = false
): void {
    const filtered = filterFiles(files, filters.query, filters.type, filters.days);
    const shown = sortFiles(filtered, filters.order);

    if (json) {
        printJson(context, shown.map(fileJson));

        return;
    }
    if (!shown.length) {
        status(context).info('No files found.');

        return;
    }

    printTable(context, FILE_TABLE_HEAD, shown.map(fileRow));
}

function listFiles(
    context: CliContext,
    query: string | undefined,
    options: ListOptions & { account?: string }
): AsyncResult<void, CliError> {
    const output = jsonContext(context, options.json);

    return openSession(output, options.account).andThenAsync((session) =>
        parseFilters(output, session, query, options).andThenAsync((filters) =>
            loadFiles(output, session).map((files) =>
                showFiles(output, files, filters, options.json)
            )
        )
    );
}

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

export function registerFileCommands(program: Command, context: CliContext, run: Runner) {
    const file = program.command('file').description('List, upload, download, and delete files');

    file.command('list')
        .description('List files, newest first by default')
        .argument('[search]', 'show names containing this text')
        .option('--type <extension>', 'show one file type, for example pdf')
        .option('--days <days>', 'show files modified in the last number of days')
        .option('--sort <order>', 'modified-desc, modified-asc, name-asc, or name-desc')
        .option('--json', 'print JSON')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((search, options) => run(() => listFiles(context, search, options)));

    file.command('upload')
        .description('Upload files, and every file inside folders')
        .argument('<paths...>', 'files or folders')
        .option('-w, --workers <count>', 'concurrent transfers')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((paths, options) => run(() => upload(context, paths, options)));

    file.command('download')
        .description('Download files by name or ID')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-o, --output <path>', 'destination folder, or file path for one file')
        .option('-f, --force', 'replace existing local files')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((targets, options) => run(() => download(context, targets, options)));

    file.command('delete')
        .description('Move files to the Google Photos trash')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-y, --yes', 'skip the confirmation')
        .option('-w, --workers <count>', 'concurrent requests')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((targets, options) => run(() => remove(context, targets, options)));
}
