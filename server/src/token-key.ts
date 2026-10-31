import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { TOKEN_ENCRYPTION } from '@madkarmaa/phodrive-core/auth';
import { AUTH_ERRORS, type AuthError } from './errors';

const MODULUS_BITS = 4096;
const PUBLIC_EXPONENT = new Uint8Array([1, 0, 1]);

let keyPair: Promise<CryptoKeyPair> | undefined;

/** One key pair per server process; the private key cannot be exported. */
function tokenKeyPair(): AsyncResult<CryptoKeyPair, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            keyPair ??= crypto.subtle.generateKey(
                {
                    ...TOKEN_ENCRYPTION,
                    modulusLength: MODULUS_BITS,
                    publicExponent: PUBLIC_EXPONENT
                },
                false,
                ['encrypt', 'decrypt']
            );

            const pair = await keyPair;

            return Ok(pair);
        } catch {
            keyPair = undefined;

            return Err(AUTH_ERRORS.TOKEN_DECRYPTION_FAILED);
        }
    });
}

/** The public key browsers encrypt pasted Google tokens with. */
export function publicTokenKey(): AsyncResult<JsonWebKey, AuthError> {
    return tokenKeyPair().andThenAsync(async ({ publicKey }) => {
        try {
            const key = await crypto.subtle.exportKey('jwk', publicKey);

            return Ok(key);
        } catch {
            return Err(AUTH_ERRORS.TOKEN_DECRYPTION_FAILED);
        }
    });
}

function decodeBase64(value: string): Result<Uint8Array<ArrayBuffer>, AuthError> {
    try {
        return Ok(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));
    } catch {
        return Err(AUTH_ERRORS.TOKEN_DECRYPTION_FAILED);
    }
}

/** A key from before a server restart cannot be decrypted; the page then fetches the new one. */
export function decryptToken(encrypted: string): AsyncResult<string, AuthError> {
    return decodeBase64(encrypted).andThenAsync((ciphertext) =>
        tokenKeyPair().andThenAsync(async ({ privateKey }) => {
            try {
                const plaintext = await crypto.subtle.decrypt(
                    TOKEN_ENCRYPTION,
                    privateKey,
                    ciphertext
                );

                return Ok(new TextDecoder().decode(plaintext));
            } catch {
                return Err(AUTH_ERRORS.TOKEN_DECRYPTION_FAILED);
            }
        })
    );
}
