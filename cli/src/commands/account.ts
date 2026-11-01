import type { Command } from '@commander-js/extra-typings';
import { Ok, type AsyncResult } from 'results-ts';
import { requireAccount, selectedEmail, withAccount, withoutAccount } from '../accounts';
import { readConfig, updateConfig } from '../config';
import type { CliContext, CliError, Runner } from '../context';
import { connectAccount, readEmail, readToken } from '../credentials';
import { printJson, printTable, status } from '../output';
import { askConfirmation } from '../prompts';

/** Only the validated AAS token is stored; the one-time OAuth2 token is discarded. */
function addAccount(
    context: CliContext,
    emailArgument: string | undefined,
    tokenOption: string | undefined
): AsyncResult<void, CliError> {
    return readEmail(context, emailArgument)
        .andThenAsync((email) => readToken(context, tokenOption).map((token) => ({ email, token })))
        .andThenAsync((credentials) => connectAccount(context, credentials))
        .andThenAsync(({ email, token }) =>
            updateConfig(context.configPath, (config) => Ok(withAccount(config, email, token))).map(
                () => status(context).success(`Connected ${email}`)
            )
        );
}

function removeAccount(
    context: CliContext,
    emailArgument: string | undefined,
    confirmed?: boolean
): AsyncResult<void, CliError> {
    return readConfig(context.configPath)
        .andThen((config) => requireAccount(config, emailArgument))
        .andThenAsync((email) =>
            askConfirmation(
                context,
                `Remove ${email}? Its saved token will be deleted.`,
                confirmed
            ).map(() => email)
        )
        .andThenAsync((email) =>
            updateConfig(context.configPath, (config) => Ok(withoutAccount(config, email))).map(
                () => status(context).success(`Removed ${email}`)
            )
        );
}

function listAccounts(context: CliContext, json = false): AsyncResult<void, CliError> {
    return readConfig(context.configPath).map((config) => {
        const active = selectedEmail(config);
        const accounts = Object.keys(config.accounts).map((email) => ({
            email,
            active: email === active
        }));

        if (json) {
            printJson(context, accounts);

            return;
        }
        if (!accounts.length) {
            status(context).info('No accounts. Run `phodrive account add` to connect one.');

            return;
        }

        printTable(
            context,
            ['Email', 'Active'],
            accounts.map(({ email, active }) => [email, active ? '*' : ''])
        );
    });
}

function useAccount(context: CliContext, email: string): AsyncResult<void, CliError> {
    return updateConfig(context.configPath, (config) =>
        requireAccount(config, email).map((saved) => ({ ...config, selected: saved }))
    ).map((config) => status(context).success(`Using ${config.selected}`));
}

export function registerAccountCommands(program: Command, context: CliContext, run: Runner) {
    const account = program.command('account').description('Connect and choose Google accounts');

    account
        .command('add')
        .description('Connect a Google account')
        .argument('[email]', 'Google account email')
        .option('-t, --token <token>', 'OAuth2 or AAS token; read from stdin when piped')
        .action((email, options) => run(() => addAccount(context, email, options.token)));

    account
        .command('remove')
        .description('Remove a connected account and its saved token')
        .argument('[email]', 'account to remove; defaults to the active account')
        .option('-y, --yes', 'skip the confirmation')
        .action((email, options) => run(() => removeAccount(context, email, options.yes)));

    account
        .command('list')
        .description('List connected accounts')
        .option('--json', 'print JSON')
        .action((options) => run(() => listAccounts(context, options.json)));

    account
        .command('use')
        .description('Choose the active account')
        .argument('<email>', 'connected account email')
        .action((email) => run(() => useAccount(context, email)));
}
