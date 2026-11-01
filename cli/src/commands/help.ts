import type { Command, CommandUnknownOpts } from '@commander-js/extra-typings';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { CliError, Runner } from '../context';

/** Follow a command path such as `file upload` from the root command. */
function findCommand(
    program: CommandUnknownOpts,
    path: readonly string[]
): Result<CommandUnknownOpts, CliError> {
    let command = program;

    for (const name of path) {
        const next = command.commands.find(
            (child) => child.name() === name || child.aliases().includes(name)
        );
        if (!next)
            return Err({
                code: 'UNKNOWN_COMMAND',
                message: `Unknown command \`${[program.name(), ...path].join(' ')}\`. Run \`${program.name()} help\` to see commands.`
            } as const);

        command = next;
    }

    return Ok(command);
}

function showHelp(
    program: CommandUnknownOpts,
    path: readonly string[]
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () =>
        findCommand(program, path).map((command) => command.outputHelp())
    );
}

/** `phodrive help file upload` matches `phodrive file upload --help`, as in cargo. */
export function registerHelpCommand(program: Command, run: Runner) {
    program.helpCommand(false);

    program
        .command('help')
        .description('Show help for phodrive or one of its commands')
        .argument('[command...]', 'command to explain, for example `file upload`')
        .action((path) => run(() => showHelp(program, path)));
}
