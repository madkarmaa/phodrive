import { test, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Ok } from 'results-ts';
import { groupChunks, type UploadedChunk } from '$lib/file-groups';
import { UploadEventType, UploadStatus, type UploadEvent } from '$lib/models';
import { planUpload, uploadFiles } from '$server/uploads';
import { receiveUpload } from '$server/upload-input';
import { removeTemporaryDirectory } from '$server/temporary-files';
import { downloadBmp, uploadBmp } from '$server/photos';
import { decodeSplitBmp, encodeSplitBmp, MAX_CHUNK_PAYLOAD_BYTES } from '$server/bmp';
import { fileIdentity } from '$server/chunks';
import { downloadFile } from '$server/files';
import { FileActionKind, type FileRequest } from '$lib/models';

vi.mock('$server/photos', () => ({ uploadBmp: vi.fn(), downloadBmp: vi.fn() }));

const directories: string[] = [];
const PAYLOAD = Buffer.from([1, 2, 3, 4]);
const EMPTY_HASH = createHash('sha256').digest('hex');

afterEach(async () => {
    vi.clearAllMocks();
    for (const directory of directories.splice(0)) await removeTemporaryDirectory(directory);
});

test('same-batch files with identical bytes retain both names in the library', async () => {
    const form = new FormData();
    form.set('email', 'synthetic@example.com');
    form.set('token', 'aas_et/synthetic-token');
    form.set('workers', '2');
    form.append('file', new File([PAYLOAD], 'first.bin'));
    form.append('file', new File([PAYLOAD], 'second.bin'));
    form.append('file', new File([], 'empty-first.bin'));
    form.append('file', new File([], 'empty-second.bin'));

    const received = await receiveUpload(
        new Request('http://localhost/api/upload', { method: 'POST', body: form })
    );
    const input = received.unwrap();
    directories.push(input.directory);

    vi.mocked(uploadBmp).mockImplementation((_email, _token, _name, bmp) => {
        const sha1 = createHash('sha1').update(bmp).digest('hex');
        return Ok(undefined).andThenAsync(async () =>
            Ok({ status: UploadStatus.Uploaded, mediaKey: sha1, sha1 })
        );
    });

    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => events.push(event));
    expect(uploaded.isOk()).toBe(true);

    const chunks: UploadedChunk[] = events.flatMap((event) =>
        event.type === UploadEventType.Chunk ? [{ ...event.chunk, email: input.email }] : []
    );
    const decoded = vi.mocked(uploadBmp).mock.calls.map(([, , name, bmp]) => ({
        name,
        header: decodeSplitBmp(bmp).unwrap().header
    }));
    expect(decoded.map(({ header }) => header.fileHash)).toContain(EMPTY_HASH);
    expect(decoded.map(({ header }) => header.fileName).sort()).toEqual([
        'empty-first.bin',
        'empty-second.bin',
        'first.bin',
        'second.bin'
    ]);
    expect(new Set(decoded.map(({ header }) => header.fileId)).size).toBe(4);

    const files = groupChunks(chunks);
    expect(files.map((file) => file.name).sort()).toEqual([
        'empty-first.bin',
        'empty-second.bin',
        'first.bin',
        'second.bin'
    ]);
    expect(files).toHaveLength(4);
    expect(files.every((file) => file.complete)).toBe(true);
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
    const file = { name: 'first.bin', path: '/unused', size: PAYLOAD.length, fileHash };
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
        path: '/unused',
        size: MAX_CHUNK_PAYLOAD_BYTES + 1,
        fileHash
    }).unwrap();
    const firstRetry = planUpload({
        name: 'first.bin',
        path: '/unused',
        size: MAX_CHUNK_PAYLOAD_BYTES + 1,
        fileHash
    }).unwrap();
    const second = planUpload({
        name: 'second.bin',
        path: '/unused',
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

    const result = await downloadFile(input);

    expect(result.isErr()).toBe(true);
    expect(downloadBmp).not.toHaveBeenCalled();
});
