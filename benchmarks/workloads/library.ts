import assert from 'node:assert/strict';
import { groupChunks, sortFiles, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import { parseLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/metadata';
import { bytesField, message, numberField } from '@madkarmaa/phodrive-core/server/protobuf';
import type { Workload } from '../fixtures';

const PAGE_ITEMS = 1000;
const PARSE_PASSES = 10;
const LIST_PASSES = 10;
const MANY_FILES = 10_000;
const CHUNKED_FILES = 8;
const CHUNKS_PER_FILE = 512;

function libraryEntry(index: number) {
    const hash = bytesField(13, bytesField(1, new Uint8Array(20).fill(index % 255)));
    const metadata = message(numberField(9, index + 1), numberField(10, 10000), hash);

    return bytesField(2, message(bytesField(1, `media-${index}`), bytesField(2, metadata)));
}

export function protocolPageWorkload(): Workload {
    const entries = Array.from({ length: PAGE_ITEMS }, (_, index) => libraryEntry(index));
    const page = bytesField(1, message(...entries));

    return {
        bytes: page.length * PARSE_PASSES,
        run: () => {
            for (let i = 0; i < PARSE_PASSES; i++)
                assert.equal(parseLibraryPage(page).unwrap().items.length, PAGE_ITEMS);
        }
    };
}

/** Many one-chunk files, or a few files with many chunks each. */
function libraryChunks(manyFiles: boolean): UploadedChunk[] {
    const count = manyFiles ? MANY_FILES : CHUNKED_FILES * CHUNKS_PER_FILE;

    return Array.from({ length: count }, (_, i) => ({
        email: 'bench@example.com',
        fileHash: 'ab'.repeat(32),
        fileId: manyFiles ? String(i) : String(i % CHUNKED_FILES),
        chunkIndex: manyFiles ? 0 : Math.floor(i / CHUNKED_FILES),
        isLast: manyFiles || i >= count - CHUNKED_FILES,
        originalName: `file-${i}`,
        size: 1,
        at: (i * 997) % 10007,
        mediaKey: String(i),
        sha1: 'ab'.repeat(20)
    }));
}

/** Every fourth chunk is listed twice, as overlapping library pages report it. */
export function groupWorkload(manyFiles: boolean): Workload {
    const entries = libraryChunks(manyFiles);
    const listed = [...entries, ...entries.filter((_, index) => index % 4 === 0)];
    const expected = manyFiles ? MANY_FILES : CHUNKED_FILES;

    return {
        bytes: 0,
        run: () => {
            for (let i = 0; i < LIST_PASSES; i++)
                assert.equal(groupChunks(listed).length, expected);
        }
    };
}

export function sortWorkload(): Workload {
    const groups = groupChunks(libraryChunks(true));

    return {
        bytes: 0,
        run: () => {
            for (let i = 0; i < LIST_PASSES; i++)
                assert.equal(sortFiles(groups, FileSort.ModifiedDescending).length, MANY_FILES);
        }
    };
}
