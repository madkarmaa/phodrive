import { text as readText } from 'node:stream/consumers';
import type { Command } from '@commander-js/extra-typings';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { EmailSchema, NewAccountSchema } from '@madkarmaa/phodrive-core/models';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { requireAccount, selectedEmail, withAccount, withoutAccount } from '../accounts';
import { readConfig, updateConfig } from '../config';
import type { CliContext, CliError, Runner } from '../context';
import { activity, printJson, printTable, status } from '../output';
import { askConfirmation, askSecret, askText } from '../prompts';

const TOKEN_HELP =
    'an OAuth2 token starting with oauth2_ from Google Embedded Setup, or an AAS token starting with aas_et/';

type Credentials = { email: string; token: string };

function validateEmail(value: string): string | undefined {
    return EmailSchema.safeParse(value).success ? undefined : 'Enter a valid Google account email.';
}

function validateToken(value: string): string | undefined {
    const valid = value.startsWith('oauth2_') || value.startsWith('aas_et/');

    return valid ? undefined : `Enter ${TOKEN_HELP}.`;
}

function readEmail(context: CliContext, email?: string): AsyncResult<string, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        if (email !== undefined) return Ok(email.trim());

        return await askText(
            context,
            'Google account email',
            'Pass the account email, for example `phodrive account add you@gmail.com`.',
            validateEmail
        );
    });
}

function readPipedToken(context: CliContext): AsyncResult<string, CliError> {
    return Ok(undefined).andThenAsync<string, CliError>(async () => {
        let piped: string;

        try {
            piped = await readText(context.stdin);
        } catch {
            return Err({ code: 'INPUT_REQUIRED', message: 'Could not read the token.' } as const);
        }

        const token = piped.trim();
        if (!token)
            return Err({
                code: 'INPUT_REQUIRED',
                message: 'No token was piped to stdin. Pipe the token or pass it with --token.'
            } as const);

        return Ok(token);
    });
}

/** Tokens come from a flag, piped input, or a masked prompt, so they can stay out of history. */
function readToken(context: CliContext, token?: string): AsyncResult<string, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        if (token !== undefined) return Ok(token.trim());
        if (!context.stdin.isTTY) return await readPipedToken(context);

        return await askSecret(
            context,
            'Token',
            `Pass the token with --token or pipe it to stdin. Use ${TOKEN_HELP}.`,
            validateToken
        );
    });
}

/** Exchange an OAuth2 token if needed and return the AAS token Google validated. */
function verifyAccount({ email, token }: Credentials): AsyncResult<string, CliError> {
    return Ok(undefined).andThenAsync<string, CliError>(async () => {
        const parsed = NewAccountSchema.safeParse({ email, token });
        if (!parsed.success)
            return Err({
                code: 'INVALID_OPTION',
                message: parsed.error.issues[0]?.message ?? 'Invalid account.'
            } as const);

        return await connectGoogleAccount(parsed.data.email, parsed.data.token);
    });
}

function connectAccount(
    context: CliContext,
    credentials: Credentials
): AsyncResult<Credentials, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const indicator = activity(context, 'Connecting to Google Photos');

        const verified = await verifyAccount(credentials);

        verified.match({
            Ok: () => indicator.stop('Google validated the account'),
            Err: () => indicator.fail()
        });

        return verified.map((aasToken) => ({ email: credentials.email, token: aasToken }));
    });
}

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
