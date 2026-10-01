import { createHash } from 'node:crypto';

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
