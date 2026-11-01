import type { Command } from '@commander-js/extra-typings';
import type { CliContext, Runner } from '../context';
import { updateExecutable } from '../update';

export function registerUpdateCommand(program: Command, context: CliContext, run: Runner) {
    program
        .command('update')
        .description('Replace this executable with the latest GitHub release')
        .action(() => run(() => updateExecutable(context)));
}
