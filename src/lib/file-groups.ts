import type { FileSort, RemoteBmp } from '$lib/models';

export type UploadedChunk = RemoteBmp & { email: string };

export type FileGroup = {
    email: string;
    fileHash: string;
    name: string;
    at: number;
    chunkCount: number | null;
    chunks: UploadedChunk[];
    complete: boolean;
};

export function groupChunks(items: UploadedChunk[]): FileGroup[] {
    const groups = new Map<string, FileGroup>();

    for (const chunk of items) {
        const key = `${chunk.email}:${chunk.fileHash}`;
        let group = groups.get(key);

        if (!group) {
            group = {
                email: chunk.email,
                fileHash: chunk.fileHash,
                name: chunk.originalName ?? `File ${chunk.fileHash.slice(0, 12)}`,
                at: chunk.at,
                chunkCount: null,
                chunks: [],
                complete: false
            };
            groups.set(key, group);
        }

        const current = group.chunks.find((saved) => saved.chunkIndex === chunk.chunkIndex);
        group.at = Math.max(group.at, chunk.at);
        if (current && !(current.at <= chunk.at)) continue;

        group.chunks = [
            ...group.chunks.filter((saved) => saved.chunkIndex !== chunk.chunkIndex),
            chunk
        ];
        if (chunk.chunkIndex === 0 && chunk.originalName) group.name = chunk.originalName;
    }

    return [...groups.values()].map((group) => {
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
        const byName = first.name.localeCompare(second.name);
        if (order === 'name-desc') return -byName;
        if (order === 'modified-desc') return second.at - first.at || byName;
        if (order === 'modified-asc') return first.at - second.at || byName;

        return byName;
    });
}

export type FileAction = { fileHash: string; kind: 'download' | 'delete' };
