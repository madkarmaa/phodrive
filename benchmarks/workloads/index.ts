import { CHUNK, MIB, repeat, SIZES, type Workload } from '../fixtures';
import {
    bmpEncodeWorkload,
    chunkHashWorkload,
    hashWorkload,
    identityWorkload,
    planningWorkload,
    prefixWorkload
} from './compute';
import { groupWorkload, protocolPageWorkload, sortWorkload } from './library';
import { bmpStreamWorkload, downloadStreamWorkload, failurePathsWorkload } from './streams';
import { uploadWorkload, type TransportSlot } from './upload';

export type { TransportSlot } from './upload';

const SMALL_BATCH = 200;
const MIXED_FILES = [...repeat(64, SIZES.small), ...repeat(4, SIZES.medium), CHUNK + MIB];

/** Every case in cases.json, by name. */
export function createWorkloads(
    transport: TransportSlot
): Record<string, () => Workload | Promise<Workload>> {
    const mixed = (workers: number) => () =>
        uploadWorkload({ sizes: MIXED_FILES, workers }, transport);

    return {
        'hash-tiny': () => hashWorkload([SIZES.tiny], SMALL_BATCH),
        'hash-small': () => hashWorkload([SIZES.small], SMALL_BATCH),
        'hash-medium': () => hashWorkload([SIZES.medium], 1),
        'hash-large': () => hashWorkload([SIZES.large], 1),
        'hash-very-large': () => hashWorkload([SIZES.veryLarge], 1),
        'hash-many': () => hashWorkload(repeat(500, SIZES.tiny), 1),
        identity: identityWorkload,
        'chunk-hash-small': () => chunkHashWorkload(SIZES.tiny, 500),
        'chunk-hash-large': () => chunkHashWorkload(CHUNK, 1),
        planning: planningWorkload,
        prefix: prefixWorkload,
        'bmp-encode': bmpEncodeWorkload,
        'bmp-stream': bmpStreamWorkload,
        'download-stream': downloadStreamWorkload,
        'protocol-page': protocolPageWorkload,
        'group-chunks': () => groupWorkload(false),
        'group-many-files': () => groupWorkload(true),
        'sort-files': sortWorkload,
        'upload-tiny': () => uploadWorkload({ sizes: [0, 1, SIZES.tiny] }, transport),
        'upload-many': () => uploadWorkload({ sizes: repeat(300, SIZES.small) }, transport),
        'upload-large': () => uploadWorkload({ sizes: [SIZES.veryLarge] }, transport),
        'upload-boundaries': () =>
            uploadWorkload({ sizes: [CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK + 1] }, transport),
        'upload-mixed-1': mixed(1),
        'upload-mixed-4': mixed(4),
        'upload-mixed-8': mixed(8),
        'upload-mixed-32': mixed(32),
        'upload-duplicate': () =>
            uploadWorkload({ sizes: [SIZES.medium], duplicate: true }, transport),
        'upload-retry': () => uploadWorkload({ sizes: [SIZES.medium], retry: true }, transport),
        'failure-paths': failurePathsWorkload
    };
}
