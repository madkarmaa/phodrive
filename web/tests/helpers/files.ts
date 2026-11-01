import { createHash } from 'node:crypto';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';

export const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);
export const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');

/** One stored chunk holding all of PAYLOAD. */
export function chunk(name = 'proof.bin'): RemoteBmp {
    return {
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: PAYLOAD.length,
        at: 1,
        mediaKey: name,
        sha1: '0'.repeat(40)
    };
}
