import { access, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { downloadFile } from '$server/files';
import { downloadBmp } from '$server/photos';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { receiveUpload } from '$server/upload-input';
import { readFileRange, removeTemporaryDirectory } from '$server/temporary-files';

const failures = vi.hoisted(() => ({
    createDirectory: false,
    openRead: false,
    openDownload: false,
    readOperation: false,
    closeRead: false,
    writeDownload: false,
    removeDirectory: false
}));
const handleState = vi.hoisted(() => ({ closeAttempted: false }));
const directories = vi.hoisted((): string[] => []);

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();

    return {
        ...actual,
        mkdtemp: vi.fn(async (...args: Parameters<typeof actual.mkdtemp>) => {
            if (failures.createDirectory) return Promise.reject(new Error('ENOSPC'));

            const directory = await actual.mkdtemp(...args);
            directories.push(directory);
            return directory;
        }),
        open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
            const [, flags] = args;
            if (failures.openRead && flags === 'r') return Promise.reject(new Error('EIO'));
            if (failures.openDownload && flags === 'wx') return Promise.reject(new Error('ENOSPC'));

            const handle = await actual.open(...args);
            if (flags === 'r' && failures.readOperation)
                vi.spyOn(handle, 'read').mockRejectedValue(new Error('EIO'));
            if (flags === 'r' && failures.closeRead) {
                const close = handle.close.bind(handle);
                vi.spyOn(handle, 'close').mockImplementation(async () => {
                    handleState.closeAttempted = true;
                    await close();
                    throw new Error('EIO');
                });
            }
            if (flags === 'wx' && failures.writeDownload)
                vi.spyOn(handle, 'writeFile').mockRejectedValue(new Error('ENOSPC'));

            return handle;
        }),
        rm: vi.fn(async (...args: Parameters<typeof actual.rm>) => {
            if (!failures.removeDirectory) return actual.rm(...args);

            await actual.rm(...args);
            throw new Error('EIO');
        })
    };
});

vi.mock('$server/photos', () => ({
    downloadBmp: vi.fn(() =>
        Err({
            code: 'REQUEST_FAILED',
            message: 'Photos must not be contacted in this test'
        } as const)
    ),
    moveToTrash: vi.fn()
}));

afterEach(async () => {
    failures.createDirectory = false;
    failures.openRead = false;
    failures.openDownload = false;
    failures.readOperation = false;
    failures.closeRead = false;
    failures.writeDownload = false;
    failures.removeDirectory = false;
    handleState.closeAttempted = false;

    for (const directory of directories.splice(0))
        await rm(directory, { recursive: true, force: true });

    vi.clearAllMocks();
});

test('temporary directory allocation failure settles receiveUpload with an error', async () => {
    failures.createDirectory = true;

    const result = await receiveUpload(
        new Request('http://localhost/api/upload', { method: 'POST' })
    );

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toBe('Could not create temporary file storage.');
});

test('range open and short-read failures return errors without leaking a handle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phodrive-uc23-'));
    const path = join(directory, 'input');
    const handle = await open(path, 'w');
    await handle.writeFile(Buffer.from([1, 2]));
    await handle.close();

    failures.openRead = true;
    const openFailure = await readFileRange(path, 0, 2);
    expect(openFailure.isErr()).toBe(true);
    expect(openFailure.unwrapErr().message).toBe('Could not read the received file.');

    failures.openRead = false;
    const shortRead = await readFileRange(path, 0, 3);
    expect(shortRead.isErr()).toBe(true);
    expect(shortRead.unwrapErr().message).toBe('The received file is incomplete.');

    failures.readOperation = true;
    const readFailure = await readFileRange(path, 0, 2);
    expect(readFailure.isErr()).toBe(true);
    expect(readFailure.unwrapErr().message).toBe('Could not read the received file.');

    failures.readOperation = false;
    failures.closeRead = true;
    const closeFailure = await readFileRange(path, 0, 2);
    expect(closeFailure.isErr()).toBe(true);
    expect(closeFailure.unwrapErr().message).toBe('Could not close temporary file storage.');
    expect(handleState.closeAttempted).toBe(true);
});

test.each(['createDirectory', 'openDownload', 'writeDownload'] as const)(
    'downloads succeed even when %s fails because reconstruction needs no disk',
    async (failure) => {
        const { input, bmps, original } = downloadFixture();
        failures[failure] = true;
        vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
            Ok(bmpResponse(bmps[Number(key.slice(-1))])).andThenAsync(async (response) =>
                Ok(response)
            )
        );
        const directoryCalls = vi.mocked(mkdtemp).mock.calls.length;
        const openCalls = vi.mocked(open).mock.calls.length;

        const downloaded = await downloadFile(input);
        const bytes = await downloaded.unwrap().arrayBuffer();

        expect(Buffer.from(bytes)).toEqual(Buffer.from(original));
        expect(vi.mocked(mkdtemp).mock.calls.length).toBe(directoryCalls);
        expect(vi.mocked(open).mock.calls.length).toBe(openCalls);
    }
);

test('temporary directory removal failure is returned after cleanup was attempted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phodrive-uc23-'));
    failures.removeDirectory = true;

    const result = await removeTemporaryDirectory(directory);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toBe('Could not remove temporary file storage.');
    await expect(access(directory)).rejects.toThrow();
});
