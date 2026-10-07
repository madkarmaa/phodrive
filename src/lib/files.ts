import { FileSort, FileActionKind, type RemoteBmp } from '$lib/models';

export type UploadedChunk = RemoteBmp & { email: string };

export type FileGroup = {
    email: string;
    fileHash: string;
    fileId: string;
    name: string;
    at: number;
    chunkCount: number | null;
    chunks: UploadedChunk[];
    complete: boolean;
};

export function fileKey(file: { email: string; fileId: string }): string {
    return `${file.email}:${file.fileId}`;
}

type IndexedFileGroup = {
    file: FileGroup;
    chunkPositions?: Map<number, number>;
};

export function groupChunks(items: UploadedChunk[]): FileGroup[] {
    const groups = new Map<string, IndexedFileGroup>();

    for (const chunk of items) {
        const key = fileKey(chunk);
        const entry = groups.get(key);

        if (!entry) {
            const file: FileGroup = {
                email: chunk.email,
                fileHash: chunk.fileHash,
                fileId: chunk.fileId,
                name: chunk.originalName ?? `File ${chunk.fileHash.slice(0, 12)}`,
                at: chunk.at,
                chunkCount: null,
                chunks: [chunk],
                complete: false
            };
            groups.set(key, { file });

            continue;
        }

        const group = entry.file;
        let position: number | undefined;
        if (entry.chunkPositions) {
            position = entry.chunkPositions.get(chunk.chunkIndex);
        } else if (group.chunks[0].chunkIndex === chunk.chunkIndex) {
            position = 0;
        }

        const current = position === undefined ? undefined : group.chunks[position];
        group.at = Math.max(group.at, chunk.at);
        if (current && !(current.at <= chunk.at)) continue;

        if (position === undefined) {
            // Single-chunk files need no map. Positions stay valid until the final sort.
            entry.chunkPositions ??= new Map([[group.chunks[0].chunkIndex, 0]]);
            entry.chunkPositions.set(chunk.chunkIndex, group.chunks.length);
            group.chunks.push(chunk);
        } else {
            group.chunks[position] = chunk;
        }

        if (chunk.chunkIndex === 0 && chunk.originalName) group.name = chunk.originalName;
    }

    return [...groups.values()].map(({ file: group }) => {
        group.chunks.sort((first, second) => first.chunkIndex - second.chunkIndex);

        const last = group.chunks.find((chunk) => chunk.isLast);
        group.chunkCount = last ? last.chunkIndex + 1 : null;
        group.complete =
            group.chunkCount !== null &&
            group.chunks.length === group.chunkCount &&
            group.chunks.every((chunk, index) => chunk.chunkIndex === index);

        return group;
    });
}

export function fileType(name: string): string {
    return name.includes('.') ? (name.split('.').pop() ?? '').slice(0, 5).toUpperCase() : 'FILE';
}

export function sortFiles(files: readonly FileGroup[], order: FileSort): FileGroup[] {
    return files.toSorted((first, second) => {
        if (order === FileSort.ModifiedDescending)
            return second.at - first.at || first.name.localeCompare(second.name);
        if (order === FileSort.ModifiedAscending)
            return first.at - second.at || first.name.localeCompare(second.name);

        const byName = first.name.localeCompare(second.name);
        if (order === FileSort.NameDescending) return -byName;

        return byName;
    });
}

export type FileAction = { fileId: string; kind: FileActionKind };

const DAY_MS = 86_400_000;

export function filterFiles(
    files: readonly FileGroup[],
    searchTerm: string,
    type: string,
    modifiedDays: string
): FileGroup[] {
    const query = searchTerm.toLocaleLowerCase();
    const modifiedSince = Date.now() - Number(modifiedDays) * DAY_MS;

    return files.filter((file) => {
        if (!file.name.toLocaleLowerCase().includes(query)) return false;
        if (type && fileType(file.name) !== type) return false;
        if (modifiedDays) return file.at >= modifiedSince;

        return true;
    });
}
