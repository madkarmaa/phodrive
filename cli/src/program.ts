import { Command } from '@commander-js/extra-typings';
import { version } from '../package.json';
import { registerAccountCommands } from './commands/account';
import { registerFileCommands } from './commands/file';
import { registerHelpCommand } from './commands/help';
import { registerSettingCommands } from './commands/setting';
import { registerUpdateCommand } from './commands/update';
import type { CliContext, CliError, Runner } from './context';
import { reportError } from './output';

/** Build the command tree; failures are reported and passed to the caller for the exit code. */
export function createProgram(context: CliContext, onError: (error: CliError) => void) {
    const run: Runner = async (task) => {
        const result = await task();

        result.inspectErr((error) => {
            reportError(context, error);
            onError(error);
        });
    };

    // Subcommands inherit output, error help, and exit handling from the root command.
    const program = new Command('phodrive')
        .description('Use Google Photos as cloud storage from the terminal.')
        .version(version, '-v, --version')
        .configureOutput({
            writeOut: (text) => context.stdout.write(text),
            writeErr: (text) => context.stderr.write(text)
        })
        .showHelpAfterError('(add --help for usage)')
        .exitOverride();

    registerAccountCommands(program, context, run);
    registerFileCommands(program, context, run);
    registerSettingCommands(program, context, run);
    registerUpdateCommand(program, context, run);
    registerHelpCommand(program, run);

    return program;
}
