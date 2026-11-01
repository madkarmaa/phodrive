import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { Ok, type AsyncResult } from 'results-ts';
import { vi } from 'vitest';
import { bmpResponse } from './download';

/** A successful AsyncResult, as the mocked Photos calls return. */
export function asyncOk<T>(value: T): AsyncResult<T, never> {
    return Ok(value).andThenAsync(async (settled) => Ok(settled));
}

/**
 * Answer the mocked `downloadBmp` with each chunk's BMP, chosen by its media key's index. Test
 * files using this must mock `@madkarmaa/phodrive-core/server/photos`.
 */
export function serveBmps(
    bmps: Uint8Array[],
    blockSize?: number,
    hooks?: Parameters<typeof bmpResponse>[2]
): void {
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        asyncOk(bmpResponse(bmps[Number(key.slice(-1))], blockSize, hooks))
    );
}
