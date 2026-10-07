import { test, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { groupChunks, type UploadedChunk } from '$lib/file-groups';
import { UploadEventType, type UploadEvent, FileActionKind, type FileRequest } from '$lib/models';
import { planUpload, uploadFiles } from '$server/uploads';
import { receiveUpload } from '$server/upload-input';
import * as photos from '$server/photos';
import { decodeSplitBmp, encodeSplitBmp, MAX_CHUNK_PAYLOAD_BYTES } from '$server/bmp';
import { fileIdentity } from '$server/chunks';
import { downloadFile } from '$server/files';
import { uploadForm, photosUploadHarness } from '../helpers/upload';

const PAYLOAD = Buffer.from([1, 2, 3, 4]);
const EMPTY_HASH = createHash('sha256').digest('hex');
afterEach(() => vi.restoreAllMocks());

test('identical original bytes under different names remain separate complete groups', async () => {
    const harness = photosUploadHarness();
    const events: UploadEvent[] = [];
    for (const name of ['first.bin', 'second.bin', 'empty-first.bin', 'empty-second.bin']) {
        const fixture = uploadForm(name.startsWith('empty') ? new Uint8Array() : PAYLOAD, name);
        const received = await receiveUpload(fixture.request());
        const input = received.unwrap();
        const uploaded = await uploadFiles(input, (event) => events.push(event), harness.fetcher);
        expect(uploaded.isOk()).toBe(true);
        await input.cancel();
    }
    const chunks: UploadedChunk[] = events.flatMap((event) =>
        event.type === UploadEventType.Chunk ? [{ ...event.chunk, email: 'test@example.com' }] : []
    );
    const groups = groupChunks(chunks);
    expect(groups.map((file) => file.name).sort()).toEqual([
        'empty-first.bin',
        'empty-second.bin',
        'first.bin',
        'second.bin'
    ]);
    expect(groups.every((file) => file.complete)).toBe(true);
    expect(new Set(groups.map((file) => file.fileId)).size).toBe(4);
});

test('distinct identities keep identical content under different names as separate files', () => {
    const fileHash = createHash('sha256').update(PAYLOAD).digest('hex');
    const chunks: UploadedChunk[] = ['first.bin', 'second.bin'].map((originalName, index) => ({
        email: 'synthetic@example.com',
        fileHash,
        fileId: fileIdentity(originalName, fileHash),
        chunkIndex: 0,
        isLast: true,
        originalName,
        size: PAYLOAD.length,
        at: index + 1,
        mediaKey: `key-${originalName}`,
        sha1: String(index).repeat(40)
    }));

    const files = groupChunks(chunks);
    expect(files.map((file) => file.name).sort()).toEqual(['first.bin', 'second.bin']);
    expect(new Set(files.map((file) => file.fileId)).size).toBe(2);
});

test('same-name retries keep identity stable while different names get independent identities', () => {
    const fileHash = createHash('sha256').update(PAYLOAD).digest('hex');
    const file = { name: 'first.bin', size: PAYLOAD.length, fileHash };
    const retry = planUpload({ ...file }).unwrap();
    const initial = planUpload(file).unwrap();

    expect(retry.headers[0].fileId).toBe(initial.headers[0].fileId);
    expect(planUpload({ ...file, name: 'second.bin' }).unwrap().headers[0].fileId).not.toBe(
        initial.headers[0].fileId
    );
    expect(
        planUpload({ ...file, name: 'empty-first.bin', size: 0, fileHash: EMPTY_HASH }).unwrap()
            .headers[0].fileId
    ).not.toBe(
        planUpload({ ...file, name: 'empty-second.bin', size: 0, fileHash: EMPTY_HASH }).unwrap()
            .headers[0].fileId
    );
});

test('split upload plans use different stable identities for same-content filenames on every chunk', () => {
    const fileHash = createHash('sha256').update(PAYLOAD).digest('hex');
    const first = planUpload({
        name: 'first.bin',
        size: MAX_CHUNK_PAYLOAD_BYTES + 1,
        fileHash
    }).unwrap();
    const firstRetry = planUpload({
        name: 'first.bin',
        size: MAX_CHUNK_PAYLOAD_BYTES + 1,
        fileHash
    }).unwrap();
    const second = planUpload({
        name: 'second.bin',
        size: MAX_CHUNK_PAYLOAD_BYTES + 1,
        fileHash
    }).unwrap();

    expect(first.headers).toHaveLength(2);
    expect(new Set(first.headers.map((header) => header.fileId)).size).toBe(1);
    expect(firstRetry.headers.map((header) => header.fileId)).toEqual(
        first.headers.map((header) => header.fileId)
    );
    expect(second.headers.every((header) => header.fileId !== first.headers[0].fileId)).toBe(true);
});

test('split BMPs round-trip file identity', () => {
    const fileHash = createHash('sha256').update(PAYLOAD).digest('hex');
    const fileId = fileIdentity('first.bin', fileHash);
    const versioned = encodeSplitBmp(PAYLOAD, {
        fileHash,
        fileId,
        chunkIndex: 0,
        flags: 1,
        payloadSize: PAYLOAD.length,
        fileName: 'first.bin'
    }).unwrap();
    const decodedVersioned = decodeSplitBmp(versioned).unwrap();

    expect(new TextDecoder().decode(versioned.subarray(54, 62))).toBe('BMSPLIT\x01');
    expect(decodedVersioned.header.fileId).toBe(fileId);
    expect(decodedVersioned.header.fileName).toBe('first.bin');
    expect(decodedVersioned.payload).toEqual(Uint8Array.from(PAYLOAD));
});

test('download rejects a mismatched file identity before fetching any BMP bytes', async () => {
    const fileHash = createHash('sha256').update(PAYLOAD).digest('hex');
    const requestedFileId = fileIdentity('first.bin', fileHash);
    const input: FileRequest = {
        action: FileActionKind.Download,
        email: 'synthetic@example.com',
        token: 'aas_et/synthetic-token',
        name: 'first.bin',
        fileHash,
        fileId: requestedFileId,
        workers: 1,
        chunks: [
            {
                fileHash,
                fileId: fileIdentity('second.bin', fileHash),
                chunkIndex: 0,
                isLast: true,
                originalName: 'first.bin',
                size: PAYLOAD.length,
                at: 1,
                mediaKey: 'synthetic-media-key',
                sha1: '0'.repeat(40)
            }
        ]
    };

    const download = vi.spyOn(photos, 'downloadBmp');
    const result = await downloadFile(input);

    expect(result.isErr()).toBe(true);
    expect(download).not.toHaveBeenCalled();
});
