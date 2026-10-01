import { Ok, type AsyncResult } from 'results-ts';
import { exchangeOAuth2ForAas } from '$server/aas';
import { photosFetch, type Fetcher } from '$server/fetcher';
import { validateAasAccount } from '$server/photos';

const EXCHANGE_ERROR = 'Could not exchange this OAuth2 token. Get a fresh token and try again.';
const VALIDATION_ERROR =
    'Google could not validate this email and token. Check both and try again.';

/** Return only a Google-validated AAS token; never retain the one-time OAuth2 token. */
export function connectGoogleAccount(
    email: string,
    inputToken: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<string, Error> {
    const exchanged = inputToken.startsWith('oauth2_')
        ? exchangeOAuth2ForAas(email, inputToken, fetcher).mapErr(() => new Error(EXCHANGE_ERROR))
        : Ok(inputToken);

    return exchanged.andThenAsync((token) =>
        validateAasAccount(email, token, fetcher)
            .map(() => token)
            .mapErr(() => new Error(VALIDATION_ERROR))
    );
}
