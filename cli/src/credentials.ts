import { text as readText } from 'node:stream/consumers';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { EmailSchema, NewAccountSchema } from '@madkarmaa/phodrive-core/models';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import type { CliContext, CliError } from './context';
import { activity } from './output';
import { askSecret, askText } from './prompts';

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

export function readEmail(context: CliContext, email?: string): AsyncResult<string, CliError> {
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
export function readToken(context: CliContext, token?: string): AsyncResult<string, CliError> {
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

export function connectAccount(
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
