import type { ApplicationError } from '$lib/errors';
import { Ok, type AsyncResult } from 'results-ts';
import { exchangeOAuth2ForAas } from '$server/aas';
import { photosFetch, type Fetcher } from '$server/fetcher';
import { validateAasAccount } from '$server/photos';
import type { ServerError } from '$server/errors';

/** Return only a Google-validated AAS token; never retain the one-time OAuth2 token. */
export function connectGoogleAccount(
    email: string,
    inputToken: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<string, ApplicationError | ServerError> {
    const exchanged = inputToken.startsWith('oauth2_')
        ? exchangeOAuth2ForAas(email, inputToken, fetcher)
        : Ok(inputToken);

    return exchanged.andThenAsync<string, ApplicationError | ServerError>((token) =>
        validateAasAccount(email, token, fetcher).map(() => token)
    );
}
