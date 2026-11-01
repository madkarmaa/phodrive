import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { filterFiles, sortFiles, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { FileSort } from '@madkarmaa/phodrive-core/models';
import { openSession, type Session } from './accounts';
import type { CliContext, CliError } from './context';
import { loadFiles } from './library';
import {
    FILE_TABLE_HEAD,
    fileJson,
    fileRow,
    jsonContext,
    printJson,
    printTable,
    status
} from './output';
import { chooseSort } from './settings';

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

export function listFiles(
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
