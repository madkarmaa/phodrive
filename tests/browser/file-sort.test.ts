import { expect, test } from 'vitest';
import { sortFiles, type FileGroup } from '$lib/file-groups';

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

test('sort choices order names and dates consistently without changing the original list', () => {
    const files = [file('zebra.zip', 10), file('alpha.zip', 30), file('beta.zip', 10)];
    const names = (items: FileGroup[]) => items.map((item) => item.name);

    expect(names(sortFiles(files, 'name-asc'))).toEqual(['alpha.zip', 'beta.zip', 'zebra.zip']);
    expect(names(sortFiles(files, 'name-desc'))).toEqual(['zebra.zip', 'beta.zip', 'alpha.zip']);
    expect(names(sortFiles(files, 'modified-desc'))).toEqual([
        'alpha.zip',
        'beta.zip',
        'zebra.zip'
    ]);
    expect(names(sortFiles(files, 'modified-asc'))).toEqual(['beta.zip', 'zebra.zip', 'alpha.zip']);
    expect(names(files)).toEqual(['zebra.zip', 'alpha.zip', 'beta.zip']);
});
