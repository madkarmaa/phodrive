import { Err, Ok, type AsyncResult } from 'results-ts';
import { connectAccount } from '$lib/accounts.remote';
import type { AccountConnection } from '$lib/models';

/** Handle rejection only at the generated remote transport boundary. */
export function validateAccount(email: string, token: string): AsyncResult<string, Error> {
    return Ok(undefined).andThenAsync(async () => {
        let response: AccountConnection;

        try {
            response = await connectAccount({ email, token });
        } catch {
            return Err(new Error('Google could not validate this account. Try again.'));
        }

        return 'error' in response ? Err(new Error(response.error)) : Ok(response.token);
    });
}
