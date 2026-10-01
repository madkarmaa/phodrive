import { expect, test } from 'vitest';
import { FileSort } from '$lib/models';
import {
    fileType,
    groupChunks,
    sortFiles,
    type FileGroup,
    type UploadedChunk
} from '$lib/file-groups';

function file(name: string, at: number): FileGroup {
    return {
        name,
        at,
        email: 'test@example.com',
        fileHash: name,
        chunkCount: null,
        chunks: [],
        complete: false
    };
}

function chunk(
    fileHash: string,
    chunkIndex: number,
    values: Partial<UploadedChunk> = {}
): UploadedChunk {
    return {
        fileHash,
        chunkIndex,
        isLast: false,
        size: 1,
        at: 100,
        mediaKey: `${fileHash}-${chunkIndex}`,
        sha1: '0'.repeat(40),
        email: 'test@example.com',
        ...values
    };
}

test('all sort orders handle case, Unicode and long names without mutating files', () => {
    const files = [
        file('z'.repeat(240) + '.zip', 10),
        file('Éclair.jpg', 30),
        file('alpha.txt', 10),
        file('Äther.png', 20)
    ];
    const originalNames = files.map(({ name }) => name);

    expect(sortFiles(files, FileSort.NameAscending).map(({ name }) => name)).toEqual(
        [...originalNames].sort((a, b) => a.localeCompare(b))
    );
    expect(sortFiles(files, FileSort.NameDescending).map(({ name }) => name)).toEqual(
        [...originalNames].sort((a, b) => b.localeCompare(a))
    );
    expect(sortFiles(files, FileSort.ModifiedAscending).map(({ name }) => name)).toEqual([
        'alpha.txt',
        'z'.repeat(240) + '.zip',
        'Äther.png',
        'Éclair.jpg'
    ]);
    expect(sortFiles(files, FileSort.ModifiedDescending).map(({ name }) => name)).toEqual([
        'Éclair.jpg',
        'Äther.png',
        'alpha.txt',
        'z'.repeat(240) + '.zip'
    ]);
    expect(files.map(({ name }) => name)).toEqual(originalNames);
});

test('search and filters match names case-insensitively and handle empty results', () => {
    const files = [
        file('Éclair Summer.PNG', Date.now()),
        file('notes.txt', Date.now() - 3 * 86_400_000)
    ];
    const search = (term: string, type: string, days: string) =>
        files.filter(
            (item) =>
                item.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()) &&
                (!type || fileType(item.name) === type) &&
                (!days || item.at >= Date.now() - Number(days) * 86_400_000)
        );

    expect(search('summer', '', '')).toHaveLength(1);
    expect(search('ÉCLAIR', 'PNG', '')).toHaveLength(1);
    expect(search('', 'TXT', '')).toHaveLength(1);
    expect(search('', '', '1')).toHaveLength(1);
    expect(search('no such file', '', '')).toEqual([]);
});

test('grouped file becomes searchable and typed when its naming chunk arrives late', () => {
    const laterChunk = chunk('a'.repeat(64), 1);
    const beforeName = groupChunks([laterChunk]);
    expect(beforeName[0]?.name).toBe(`File ${'a'.repeat(12)}`);

    const afterName = groupChunks([
        laterChunk,
        chunk('a'.repeat(64), 0, { originalName: 'Late Photo.jpg', at: 101 })
    ]);
    expect(afterName[0]?.name).toBe('Late Photo.jpg');
    expect(
        afterName.filter(({ name }) => name.toLocaleLowerCase().includes('late photo'))
    ).toHaveLength(1);
    expect(fileType(afterName[0]?.name ?? '')).toBe('JPG');
});
