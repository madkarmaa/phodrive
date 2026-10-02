import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { ThemeMode, FileActionKind, type FileRequest, type RemoteBmp } from '$lib/models';
import type { FileGroup } from '$lib/file-groups';
import { DriveController } from '$browser/drive.svelte';
import * as browserFiles from '$browser/files';
import { downloadFile as downloadServerFile } from '$server/files';
import { encodeSplitBmp } from '$server/bmp';
import { downloadBmp } from '$server/photos';
import * as temporary from '$server/temporary-files';

const EMAIL = 'test@example.com';
const TOKEN = 'aas_et/synthetic';
const directories: string[] = [];

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value)
    };

    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('$browser/automatic-refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));
vi.mock('$server/photos', () => ({ downloadBmp: vi.fn() }));

beforeEach(() => {
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ [EMAIL]: TOKEN }));
    directories.length = 0;
    vi.restoreAllMocks();

    const createDirectory = temporary.createTemporaryDirectory;
    vi.spyOn(temporary, 'createTemporaryDirectory').mockImplementation(() =>
        createDirectory().inspect((directory) => directories.push(directory))
    );
});

afterEach(async () => {
    for (const directory of directories.splice(0))
        await temporary.removeTemporaryDirectory(directory);
});

afterAll(() => vi.unstubAllGlobals());

function requestFor(
    payload: Uint8Array,
    name: string
): {
    input: FileRequest;
    bmps: Uint8Array[];
} {
    const fileHash = createHash('sha256').update(payload).digest('hex');
    const parts =
        payload.length === 0
            ? [payload]
            : [
                  payload.subarray(0, Math.ceil(payload.length / 2)),
                  payload.subarray(Math.ceil(payload.length / 2))
              ];
    const bmps = parts.map((part, chunkIndex) =>
        encodeSplitBmp(part, {
            fileHash,
            fileId: fileHash,
            chunkIndex,
            flags: chunkIndex === parts.length - 1 ? 1 : 0,
            payloadSize: part.length,
            fileName: chunkIndex === 0 ? name : undefined
        }).unwrap()
    );
    const chunks: RemoteBmp[] = bmps.map((bmp, chunkIndex) => ({
        fileHash,
        fileId: fileHash,
        chunkIndex,
        isLast: chunkIndex === bmps.length - 1,
        originalName: chunkIndex === 0 ? name : undefined,
        size: parts[chunkIndex].length,
        at: 1,
        mediaKey: `${name}-${chunkIndex}`,
        sha1: createHash('sha1').update(bmp).digest('hex')
    }));

    return {
        input: {
            action: FileActionKind.Download,
            email: EMAIL,
            token: TOKEN,
            name,
            fileHash,
            fileId: fileHash,
            chunks,
            workers: 1
        },
        bmps
    };
}

test('downloads empty and large originals byte-for-byte and removes server temporaries after completion or cancellation', async () => {
    const large = Uint8Array.from({ length: 2_000_000 }, (_, index) => (index * 31) % 256);
    const cases = [
        { name: 'empty.bin', payload: new Uint8Array() },
        { name: 'large.bin', payload: large }
    ];

    for (const { name, payload } of cases) {
        const { input, bmps } = requestFor(payload, name);
        vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) =>
            Ok(Buffer.from(bmps[Number(mediaKey.slice(-1))])).andThenAsync(async (bmp) => Ok(bmp))
        );

        const response = await downloadServerFile(input);
        const downloaded = response.unwrap();
        const body = await downloaded.arrayBuffer();
        const downloadedBytes = Buffer.from(body);
        expect(downloadedBytes.equals(payload)).toBe(true);
        await expect(access(directories.at(-1) ?? '')).rejects.toThrow();
    }

    const cancellationCase = requestFor(large, 'cancel.bin');
    vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) =>
        Ok(Buffer.from(cancellationCase.bmps[Number(mediaKey.slice(-1))])).andThenAsync(
            async (bmp) => Ok(bmp)
        )
    );
    const response = await downloadServerFile(cancellationCase.input);
    const directory = directories.at(-1);
    const downloaded = response.unwrap();
    await downloaded.body?.cancel();
    await expect(access(directory ?? '')).rejects.toThrow();
});

test('browser save failures show an error and always clear the active file action', async () => {
    const payload = new Blob(['original bytes']);
    vi.spyOn(browserFiles, 'downloadFile').mockImplementation(() =>
        Ok(payload).andThenAsync(async (file) => Ok(file))
    );
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        throw new Error('synthetic browser save failure');
    });

    const drive = new DriveController();
    drive.initialize();
    const item: FileGroup = {
        email: EMAIL,
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'original.bin',
        at: 1,
        chunkCount: 1,
        chunks: [],
        complete: true
    };

    await drive.actOnFile(item, FileActionKind.Download);

    expect(drive.feedbackMessage).toBe('Could not save the downloaded file.');
    expect(drive.fileAction).toBeNull();
    expect(drive.busy).toBe(false);
});

test('failed download is surfaced and clears the active file action', async () => {
    vi.spyOn(browserFiles, 'downloadFile').mockImplementation(() =>
        Err({
            code: 'REQUEST_FAILED',
            message: 'Could not receive the downloaded file.'
        } as const).andThenAsync(async (file) => Ok(file))
    );

    const drive = new DriveController();
    drive.initialize();
    const item: FileGroup = {
        email: EMAIL,
        fileHash: 'b'.repeat(64),
        fileId: 'b'.repeat(64),
        name: 'unavailable.bin',
        at: 1,
        chunkCount: 1,
        chunks: [],
        complete: true
    };

    await drive.actOnFile(item, FileActionKind.Download);

    expect(drive.feedbackMessage).toBe('Could not receive the downloaded file.');
    expect(drive.fileAction).toBeNull();
});
