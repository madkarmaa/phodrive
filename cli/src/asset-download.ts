import { createHash, type Hash } from 'node:crypto';
import { chmod, open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { CliContext, CliError } from './context';
import { transferProgress } from './output';
import { updateFailure, type Asset } from './release';

const EXECUTABLE_MODE = 0o755;
const SHA256_PREFIX = 'sha256:';

function fetchAsset(
    context: CliContext,
    asset: Asset
): AsyncResult<ReadableStream<Uint8Array>, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const response = await fetch(asset.browser_download_url, { signal: context.signal });
            if (!response.ok || !response.body)
                return Err(updateFailure(`GitHub answered with HTTP ${response.status}.`));

            return Ok(response.body);
        } catch {
            return Err(updateFailure('Could not reach GitHub.'));
        }
    });
}

/** Create the new file exclusively, so an existing file is never overwritten. */
function createExecutable(
    path: string,
    body: ReadableStream<Uint8Array>
): AsyncResult<FileHandle, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            return Ok(await open(path, 'wx', EXECUTABLE_MODE));
        } catch {
            await body.cancel().catch(() => {});

            return Err(updateFailure(`Could not write to ${dirname(path)}.`));
        }
    });
}

function copyBody(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    handle: FileHandle,
    hash: Hash,
    onProgress: (written: number) => void
): AsyncResult<number, CliError> {
    return Ok(undefined).andThenAsync<number, CliError>(async () => {
        let written = 0;

        while (true) {
            let next: ReadableStreamReadResult<Uint8Array>;

            try {
                next = await reader.read();
            } catch {
                return Err(updateFailure('The download was interrupted.'));
            }
            if (next.done) return Ok(written);

            try {
                await handle.write(next.value);
            } catch {
                return Err(updateFailure('Could not save the new version.'));
            }

            hash.update(next.value);
            written += next.value.byteLength;
            onProgress(written);
        }
    });
}

/** The asset size and GitHub's SHA-256 digest must both match before anything is replaced. */
function verifyDownload(asset: Asset, written: number, hash: Hash): Result<void, CliError> {
    if (written !== asset.size)
        return Err(updateFailure(`The download stopped after ${prettyBytes(written)}.`));

    const digest = `${SHA256_PREFIX}${hash.digest('hex')}`;
    if (asset.digest && asset.digest !== digest)
        return Err(updateFailure('The download does not match the checksum GitHub published.'));

    return Ok(undefined);
}

function saveAsset(
    context: CliContext,
    asset: Asset,
    path: string,
    body: ReadableStream<Uint8Array>,
    handle: FileHandle
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        const bar = transferProgress(context, `Downloading ${asset.name}`, asset.size);
        const hash = createHash('sha256');
        const reader = body.getReader();

        const copied = await copyBody(reader, handle, hash, (written) =>
            bar.update(written, `${prettyBytes(written)} of ${prettyBytes(asset.size)}`)
        );

        await reader.cancel().catch(() => {});
        reader.releaseLock();

        try {
            await handle.close();
            // The file mode passed to open is reduced by the umask.
            await chmod(path, EXECUTABLE_MODE);
        } catch {
            bar.fail();

            return copied.andThen(() => Err(updateFailure('Could not save the new version.')));
        }

        const verified = copied.andThen((written) => verifyDownload(asset, written, hash));
        verified.match({
            Ok: () => bar.stop(`Downloaded ${asset.name}`),
            Err: () => bar.fail()
        });

        return verified;
    });
}

/** Download a release asset to a new executable file at `path`, checking its size and digest. */
export function downloadAsset(
    context: CliContext,
    asset: Asset,
    path: string
): AsyncResult<void, CliError> {
    return fetchAsset(context, asset)
        .andThenAsync((body) => createExecutable(path, body).map((handle) => ({ body, handle })))
        .andThenAsync(({ body, handle }) => saveAsset(context, asset, path, body, handle));
}
