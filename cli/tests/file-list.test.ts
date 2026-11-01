import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { deleteFile, downloadFile, readLibrary } from '@madkarmaa/phodrive-core/node';
import { AAS_TOKEN, EMAIL, remoteFile, runCli, temporaryFolder } from './helpers/cli';
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

test('files are filtered, sorted, and printed as JSON without credentials', async () => {
    const report = remoteFile('report.pdf', 3);
    const notes = remoteFile('notes.txt', 2);
    const archive = remoteFile('archive.pdf', 1);
    library([report, notes, archive]);

    const listed = await runCli(['file', 'list', '--type', 'pdf', '--sort', 'name-asc', '--json'], {
        folder: folder.path
    });

    expect(readLibrary).toHaveBeenCalledWith(EMAIL, AAS_TOKEN);
    const files = JSON.parse(listed.stdout);
    expect(files.map((file: { name: string }) => file.name)).toEqual(['archive.pdf', 'report.pdf']);
    expect(files[0]).toMatchObject({ id: archive.fileId, type: 'PDF', size: 1024, complete: true });
    expect(listed.stdout).not.toContain('aas_et');
});

test('JSON output at a terminal prints only the JSON', async () => {
    library([remoteFile('report.pdf')]);

    const listed = await runCli(['file', 'list', '--json'], {
        folder: folder.path,
        interactive: true
    });

    expect(JSON.parse(listed.stdout)).toHaveLength(1);
    expect(listed.stderr).toBe('');
});

test('the saved sort order and search text apply to the table', async () => {
    library([remoteFile('b-report.pdf', 1), remoteFile('a-report.pdf', 2), remoteFile('other', 3)]);
    await runCli(['setting', 'set', 'sort', 'name-desc'], { folder: folder.path });

    const listed = await runCli(['file', 'list', 'report'], { folder: folder.path });

    const lines = listed.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('b-report.pdf');
    expect(lines[2]).toContain('a-report.pdf');
});

test('invalid filters fail before Google is contacted', async () => {
    const listed = await runCli(['file', 'list', '--days', '0'], { folder: folder.path });

    expect(listed.failures).toMatchObject([{ code: 'INVALID_OPTION' }]);
    expect(readLibrary).not.toHaveBeenCalled();
});

test('deletes need confirmation and report partially deleted files', async () => {
    const report = remoteFile('report.pdf');
    library([report]);
    vi.mocked(deleteFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok({ deleted: [], error: 'Request failed' }))
    );

    const unconfirmed = await runCli(['file', 'delete', 'report.pdf'], { folder: folder.path });
    expect(unconfirmed.failures).toMatchObject([{ code: 'INPUT_REQUIRED' }]);
    expect(readLibrary).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();

    const deleted = await runCli(['file', 'delete', 'report.pdf', '--yes'], {
        folder: folder.path
    });
    expect(deleteFile).toHaveBeenCalledWith(report, AAS_TOKEN, 8);
    expect(deleted.failures).toMatchObject([{ code: 'DELETE_INCOMPLETE' }]);
    expect(deleted.stderr).toContain('deleted 0 of 1 chunks. Request failed');
});

test('file commands require a connected account', async () => {
    const otherFolder = await temporaryFolder();

    const listed = await runCli(['file', 'list'], { folder: otherFolder.path });

    expect(listed.failures).toMatchObject([{ code: 'ACCOUNT_REQUIRED' }]);
    await otherFolder.remove();
});

test('rejected tokens suggest connecting the account again', async () => {
    vi.mocked(readLibrary).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Authentication failed (HTTP 403)' } as const)
        )
    );

    const listed = await runCli(['file', 'list'], { folder: folder.path });

    expect(listed.stderr).toContain('run `phodrive account add` again');
});
