import type { Readable, Writable } from 'node:stream';
import type { AsyncResult } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';

/** Failures owned by the command line, beside the library's application and server errors. */
export type CliError =
    | ApplicationError
    | ServerError
    | {
          readonly code:
              | 'ACCOUNT_REQUIRED'
              | 'ACCOUNT_NOT_FOUND'
              | 'AMBIGUOUS_FILE'
              | 'CANCELLED'
              | 'CONFIG_READ_FAILED'
              | 'CONFIG_WRITE_FAILED'
              | 'DELETE_INCOMPLETE'
              | 'DOWNLOAD_INCOMPLETE'
              | 'FILE_NOT_FOUND'
              | 'INPUT_REQUIRED'
              | 'INVALID_OPTION'
              | 'NO_FILES_SELECTED'
              | 'UNKNOWN_COMMAND'
              | 'UPDATE_FAILED'
              | 'UPDATE_UNSUPPORTED'
              | 'UPLOAD_INCOMPLETE';
          readonly message: string;
      };

/** Process boundaries the commands use, injectable so tests never touch the real terminal. */
export interface CliContext {
    configPath: string;
    environment: Record<string, string | undefined>;
    cwd: string;
    stdin: Readable & { isTTY?: boolean };
    stdout: Writable;
    stderr: Writable;
    /** Prompts and live progress are shown only when a person is at the terminal. */
    interactive: boolean;
    signal: AbortSignal;
    /** The running executable and its release asset name, set only in GitHub release builds. */
    release: { executable: string; asset: string } | null;
}

/** Runs a command's task, reporting any failure; shared by every command group. */
export type Runner = (task: () => AsyncResult<void, CliError>) => Promise<void>;
