import { createHash } from 'node:crypto';
import { MAX_CHUNK_PAYLOAD_BYTES } from '#server/bmp';

/** Stable across retries; names and split layouts keep independent chunk groups. */
export function fileIdentity(
    name: string,
    fileHash: string,
    chunkPayloadBytes = MAX_CHUNK_PAYLOAD_BYTES
): string {
    return createHash('sha256')
        .update(fileHash)
        .update('\0')
        .update(name)
        .update('\0')
        .update(String(chunkPayloadBytes))
        .digest('hex');
}

export function chunkFileName(
    name: string,
    fileHash: string,
    chunkIndex: number,
    chunkCount: number
): string {
    return `${name}.phodrive-${fileHash}-${chunkIndex}-of-${chunkCount}.bmp`;
}
