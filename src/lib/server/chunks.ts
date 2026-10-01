import { Sha256HexSchema } from '$lib/models';
import { createHash } from 'node:crypto';

const CHUNK_NAME_PATTERN = /^(.+)\.phodrive-([a-f0-9]{64})-(0|[1-9]\d*)-of-([1-9]\d*)\.bmp$/i;

/** Stable across retries; different names keep independent chunks even for identical contents. */
export function fileIdentity(name: string, fileHash: string): string {
    return createHash('sha256').update(fileHash).update('\0').update(name).digest('hex');
}

export function chunkFileName(
    name: string,
    fileHash: string,
    chunkIndex: number,
    chunkCount: number
): string {
    return `${name}.phodrive-${fileHash}-${chunkIndex}-of-${chunkCount}.bmp`;
}

export function parseChunkFileName(filename: string) {
    const match = CHUNK_NAME_PATTERN.exec(filename);
    if (!match) return null;

    const fileHash = match[2].toLowerCase();
    const chunkIndex = Number(match[3]);
    const chunkCount = Number(match[4]);

    if (
        !Sha256HexSchema.safeParse(fileHash).success ||
        !Number.isSafeInteger(chunkIndex) ||
        !Number.isSafeInteger(chunkCount) ||
        chunkIndex >= chunkCount
    )
        return null;

    return { name: match[1], fileHash, chunkIndex, chunkCount };
}
