import { MAX_CHUNK_PAYLOAD_BYTES } from '@madkarmaa/phodrive-core/bmp/format';
import type { SplitHeader } from '@madkarmaa/phodrive-core/models';

export const MIB = 1024 * 1024;
export const CHUNK = MAX_CHUNK_PAYLOAD_BYTES;
export const SIZES = {
    tiny: 1024,
    small: 64 * 1024,
    medium: 8 * MIB,
    large: 64 * MIB,
    veryLarge: 2 * CHUNK + MIB
};

/** One fixed workload; `bytes` is the input size used for throughput. */
export interface Workload {
    run: () => Promise<void> | void;
    bytes: number;
}

export function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

export function repeat<T>(count: number, value: T): T[] {
    return Array.from({ length: count }, () => value);
}

export function header(size: number): SplitHeader {
    return {
        fileHash: 'ab'.repeat(32),
        fileId: 'cd'.repeat(32),
        chunkIndex: 0,
        flags: 1,
        payloadSize: size,
        fileName: 'photos-📷.bin'
    };
}

export function files(sizes: readonly number[]): File[] {
    return sizes.map(
        (size, index) =>
            new File([new Uint8Array(size).fill((index % 251) + 1)], `file-${index}.bin`)
    );
}

/** Cold runs read new File objects, so no hashing cache carries over between samples. */
export function freshFiles(sources: readonly File[]): File[] {
    return sources.map((file) => new File([file], file.name));
}

/** A response body that hands out fixed-size blocks only when they are read. */
export function blocks(bytes: Uint8Array, blockSize = 64 * 1024): ReadableStream<Uint8Array> {
    let offset = 0;

    return new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (offset === bytes.length) {
                    controller.close();
                    return;
                }

                const part = bytes.subarray(offset, offset + blockSize);
                offset += part.length;
                controller.enqueue(part);
            }
        },
        { highWaterMark: 0 }
    );
}
