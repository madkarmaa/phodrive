import { Err, Ok, type AsyncResult } from 'results-ts';
import { AccountConnectionSchema } from '$lib/models';
import { schemaResult } from '$lib/schema-result';
import { apiJson } from '$browser/api';

const ACCOUNT_API_URL = '/api/accounts';
const CONNECTION_ERROR = 'Google could not validate this account. Try again.';

export function validateAccount(email: string, token: string): AsyncResult<string, Error> {
    return apiJson(
        ACCOUNT_API_URL,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, token })
        },
        CONNECTION_ERROR
    )
        .andThen((body) => schemaResult(AccountConnectionSchema, body, CONNECTION_ERROR))
        .andThen((response) =>
            'error' in response ? Err(new Error(response.error)) : Ok(response.token)
        );
}
