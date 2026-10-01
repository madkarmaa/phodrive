import { test, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Ok } from 'results-ts';
import { groupChunks, type UploadedChunk } from '$lib/file-groups';
import { UploadEventType, UploadStatus, type UploadEvent } from '$lib/models';
import { uploadFiles } from '$server/uploads';
import { receiveUpload } from '$server/upload-input';
import { removeTemporaryDirectory } from '$server/temporary-files';
import { uploadBmp } from '$server/photos';
import { decodeSplitBmp, encodeSplitBmp } from '$server/bmp';
import { fileIdentity } from '$server/chunks';

vi.mock('$server/photos', () => ({ uploadBmp: vi.fn() }));

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

    expect(fileIdentity('first.bin', fileHash)).toBe(fileIdentity('first.bin', fileHash));
    expect(fileIdentity('first.bin', fileHash)).not.toBe(fileIdentity('second.bin', fileHash));
    expect(fileIdentity('empty-first.bin', EMPTY_HASH)).not.toBe(
        fileIdentity('empty-second.bin', EMPTY_HASH)
    );
});

test('versioned split BMPs round-trip file identity and legacy BMPs remain readable', () => {
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

    const legacy = encodeSplitBmp(PAYLOAD, {
        fileHash,
        chunkIndex: 0,
        flags: 1,
        payloadSize: PAYLOAD.length,
        fileName: 'legacy.bin'
    }).unwrap();
    const decodedLegacy = decodeSplitBmp(legacy).unwrap();

    expect(new TextDecoder().decode(legacy.subarray(54, 62))).toBe('BMSPLIT\0');
    expect(decodedLegacy.header.fileId).toBeUndefined();
    expect(decodedLegacy.header.fileName).toBe('legacy.bin');
    expect(decodedLegacy.payload).toEqual(Uint8Array.from(PAYLOAD));
});

test('legacy aliases without file identity retain the previous content-hash grouping', () => {
    const fileHash = createHash('sha256').update(PAYLOAD).digest('hex');
    const legacyChunks: UploadedChunk[] = ['first.bin', 'second.bin'].map(
        (originalName, index) => ({
            email: 'synthetic@example.com',
            fileHash,
            chunkIndex: 0,
            isLast: true,
            originalName,
            size: PAYLOAD.length,
            at: index + 1,
            mediaKey: `legacy-${originalName}`,
            sha1: String(index).repeat(40)
        })
    );

    const [legacyFile] = groupChunks(legacyChunks);
    expect(legacyFile.fileId).toBeUndefined();
    expect(legacyFile.name).toBe('second.bin');
    expect(legacyFile.chunks).toHaveLength(1);
});
