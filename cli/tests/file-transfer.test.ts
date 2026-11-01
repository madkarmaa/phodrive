import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { downloadFile, uploadFiles } from '@madkarmaa/phodrive-core/node';
import { remoteFile, runCli } from './helpers/cli';
import { configuredFolder, library } from './helpers/files';

vi.mock('@madkarmaa/phodrive-core/node', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/node')>();

    return {
        ...actual,
        readLibrary: vi.fn(),
        uploadFiles: vi.fn(),
        downloadFile: vi.fn(),
        deleteFile: vi.fn()
    };
});

let folder: Awaited<ReturnType<typeof configuredFolder>>;

beforeEach(async () => {
    folder = await configuredFolder();
    vi.mocked(downloadFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(async () => {
    vi.clearAllMocks();
    await folder.remove();
});

test('downloads resolve names and ID prefixes into the working folder', async () => {
    const report = remoteFile('report.pdf');
    const notes = remoteFile('notes.txt');
    library([report, notes]);

    const downloaded = await runCli(['file', 'download', 'report.pdf', notes.fileId.slice(0, 8)], {
        folder: folder.path
    });

    expect(downloaded.exitCode).toBe(0);
    expect(vi.mocked(downloadFile).mock.calls.map((call) => [call[0].name, call[2]])).toEqual([
        ['report.pdf', join(folder.path, 'report.pdf')],
        ['notes.txt', join(folder.path, 'notes.txt')]
    ]);
});

test('one download can be saved under a new file name', async () => {
    library([remoteFile('report.pdf')]);

    await runCli(['file', 'download', 'report.pdf', '--output', 'saved/copy.pdf', '--force'], {
        folder: folder.path
    });

    const [call] = vi.mocked(downloadFile).mock.calls;
    expect(call[2]).toBe(join(folder.path, 'saved', 'copy.pdf'));
    expect(call[3]).toMatchObject({ force: true });
});

test('ambiguous names list the matching IDs without a terminal', async () => {
    const first = remoteFile('same.txt');
    const second = remoteFile('same.txt');
    library([first, second]);

    const downloaded = await runCli(['file', 'download', 'same.txt'], { folder: folder.path });

    expect(downloaded.failures).toMatchObject([{ code: 'AMBIGUOUS_FILE' }]);
    expect(downloaded.stderr).toContain(first.fileId.slice(0, 12));
    expect(downloaded.stderr).toContain(second.fileId.slice(0, 12));
    expect(downloadFile).not.toHaveBeenCalled();
});

test('unknown files and existing destinations are reported', async () => {
    library([remoteFile('report.pdf')]);
    vi.mocked(downloadFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'FILE_EXISTS', message: 'report.pdf already exists.' } as const)
        )
    );

    const missing = await runCli(['file', 'download', 'nothing'], { folder: folder.path });
    const existing = await runCli(['file', 'download', 'report.pdf'], { folder: folder.path });

    expect(missing.failures).toMatchObject([{ code: 'FILE_NOT_FOUND' }]);
    expect(existing.exitCode).toBe(1);
    expect(existing.stderr).toContain('Pass --force to replace it.');
});

test('uploads expand folders and fail when any file fails', async () => {
    await mkdir(join(folder.path, 'photos', 'nested'), { recursive: true });
    await writeFile(join(folder.path, 'photos', 'one.txt'), 'one');
    await writeFile(join(folder.path, 'photos', 'nested', 'two.txt'), 'two');
    vi.mocked(uploadFiles).mockImplementation((files, _email, _token, _workers, onJob) =>
        Ok(undefined).andThenAsync(async () => {
            for (const [id, file] of files.entries())
                onJob({
                    id,
                    name: file.name,
                    status: id === 0 ? UploadJobStatus.Complete : UploadJobStatus.Error,
                    progress: { phase: UploadPhase.Uploading, completed: 1, reused: 0, total: 1 },
                    message: id === 0 ? '' : 'Commit rejected',
                    result:
                        id === 0
                            ? {
                                  status: UploadStatus.Uploaded,
                                  mediaKey: 'key',
                                  sha1: 'a'.repeat(40)
                              }
                            : null
                });

            return Ok(undefined);
        })
    );

    const uploaded = await runCli(['file', 'upload', 'photos', '--workers', '3'], {
        folder: folder.path
    });

    const [files, , , workers] = vi.mocked(uploadFiles).mock.calls[0];
    expect(files.map((file) => file.name).sort()).toEqual(['one.txt', 'two.txt']);
    expect(workers).toBe(3);
    expect(uploaded.failures).toMatchObject([{ code: 'UPLOAD_INCOMPLETE' }]);
    expect(uploaded.stderr).toContain('Commit rejected');
});

test('empty folders have nothing to upload', async () => {
    await mkdir(join(folder.path, 'empty'));

    const uploaded = await runCli(['file', 'upload', 'empty'], { folder: folder.path });

    expect(uploaded.failures).toMatchObject([{ code: 'NO_FILES_SELECTED' }]);
    expect(uploadFiles).not.toHaveBeenCalled();
});
