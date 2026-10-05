import { SERVER_ERRORS } from '$server/errors';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, access, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Err, Ok } from 'results-ts';
import { receiveUpload, type ReceivedUpload } from '$server/upload-input';
import { uploadFiles, planUpload } from '$server/uploads';
import { uploadStream } from '$server/upload-stream';
import { createTemporaryDirectory, removeTemporaryDirectory } from '$server/temporary-files';
import * as temporary from '$server/temporary-files';
import { decodeSplitBmp, MAX_CHUNK_PAYLOAD_BYTES, MAX_PHOTOS_BMP_BYTES } from '$server/bmp';
import { uploadBmp } from '$server/photos';
import { UploadEventType, UploadPhase, UploadStatus, type UploadEvent } from '$lib/models';

vi.mock('$server/photos', () => ({ uploadBmp: vi.fn() }));
const PAYLOAD = Buffer.from([0, 255, 13, 10, 42]);
const directories: string[] = [];

beforeEach(() => {
    vi.mocked(uploadBmp).mockImplementation((_email, _token, _name, bmp) =>
        Ok({
            status: UploadStatus.Uploaded,
            mediaKey: createHash('sha1').update(bmp).digest('hex'),
            sha1: createHash('sha1').update(bmp).digest('hex')
        }).andThenAsync(async (response) => Ok(response))
    );
});

afterEach(async () => {
    vi.clearAllMocks();
    for (const directory of directories.splice(0)) await removeTemporaryDirectory(directory);
});

function form(files: File[] = [new File([PAYLOAD], 'proof.bin')]): FormData {
    const data = new FormData();
    data.set('email', 'test@example.com');
    data.set('token', 'aas_et/test');
    data.set('workers', '2');
    for (const file of files) data.append('file', file);
    return data;
}

async function receive(files?: File[]): Promise<ReceivedUpload> {
    const result = await receiveUpload(
        new Request('http://localhost/api/upload', { method: 'POST', body: form(files) })
    );
    const input = result.unwrap();
    directories.push(input.directory);
    return input;
}

test('raw multipart files are streamed to private disk storage and hashed on server, including empty/unicode files', async () => {
    const input = await receive([new File([PAYLOAD], 'résumé.bin'), new File([], 'empty.bin')]);
    expect(input.files).toHaveLength(2);
    expect(input.files[0]).toMatchObject({
        name: 'résumé.bin',
        size: PAYLOAD.length,
        fileHash: createHash('sha256').update(PAYLOAD).digest('hex')
    });
    const bytes = await readFile(input.files[0].path);
    expect(bytes).toEqual(PAYLOAD);
    const savedFile = await stat(input.files[0].path);
    expect(savedFile.mode & 0o600).toBe(0o600);
    // Windows does not implement separate owner, group, and other permission bits.
    if (process.platform !== 'win32') expect(savedFile.mode & 0o777).toBe(0o600);
    expect(input.files[1].size).toBe(0);
    expect(input.files[1].fileHash).toBe(createHash('sha256').digest('hex'));
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => events.push(event));
    expect(uploaded.isOk()).toBe(true);
    expect(events.filter((event) => event.type === UploadEventType.FileComplete)).toHaveLength(2);
    const [, , , emptyBmp] = vi
        .mocked(uploadBmp)
        .mock.calls.find(([, , name]) => name.startsWith('empty.bin.'))!;
    const decoded = decodeSplitBmp(emptyBmp).unwrap();
    expect(decoded.payload).toHaveLength(0);
    expect(decoded.header.flags).toBe(1);
});

test('streamed original files larger than the Photos limit are accepted without whole-file buffering', async () => {
    const total = MAX_PHOTOS_BMP_BYTES + 5;
    const block = Buffer.alloc(1_000_000);
    const hash = createHash('sha256');
    const header = Buffer.from(
        '--raw\r\nContent-Disposition: form-data; name="email"\r\n\r\ntest@example.com\r\n--raw\r\nContent-Disposition: form-data; name="token"\r\n\r\naas_et/test\r\n--raw\r\nContent-Disposition: form-data; name="workers"\r\n\r\n2\r\n--raw\r\nContent-Disposition: form-data; name="file"; filename="huge.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'
    );
    let sent = -1;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (sent === -1) {
                sent = 0;
                controller.enqueue(header);
                return;
            }
            if (sent < total) {
                const bytes = block.subarray(0, Math.min(block.length, total - sent));
                hash.update(bytes);
                sent += bytes.length;
                controller.enqueue(bytes);
                return;
            }
            controller.enqueue(Buffer.from('\r\n--raw--\r\n'));
            controller.close();
        }
    });
    const init = {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=raw' },
        body,
        duplex: 'half' as const
    };
    const received = await receiveUpload(new Request('http://localhost/api/upload', init));
    const input = received.unwrap();
    directories.push(input.directory);
    expect(input.files[0].size).toBe(total);
    expect(input.files[0].fileHash).toBe(hash.digest('hex'));
    const plan = planUpload(input.files[0]).unwrap();
    expect(plan.headers).toHaveLength(2);
    expect(plan.sizes.every((size) => size < MAX_PHOTOS_BMP_BYTES)).toBe(true);
});

test('server reads and encodes actual split ranges with stable hash, original name and final flag', async () => {
    const created = await createTemporaryDirectory();
    const directory = created.unwrap();
    directories.push(directory);
    const path = join(directory, 'large');
    const disk = await open(path, 'w');
    await disk.truncate(MAX_CHUNK_PAYLOAD_BYTES + 5);
    await disk.write(PAYLOAD, 0, PAYLOAD.length, MAX_CHUNK_PAYLOAD_BYTES);
    await disk.close();
    const input: ReceivedUpload = {
        email: 'test@example.com',
        token: 'aas_et/test',
        workers: 2,
        directory,
        files: [
            { name: 'large.bin', path, size: MAX_CHUNK_PAYLOAD_BYTES + 5, fileHash: 'a'.repeat(64) }
        ]
    };
    const events: UploadEvent[] = [];
    const result = await uploadFiles(input, (event) => events.push(event));
    expect(result.isOk()).toBe(true);
    expect(uploadBmp).toHaveBeenCalledTimes(2);
    for (const [, , name, bmp] of vi.mocked(uploadBmp).mock.calls) {
        const decoded = decodeSplitBmp(bmp).unwrap();
        expect(bmp.length).toBeLessThan(MAX_PHOTOS_BMP_BYTES);
        expect(decoded.header.fileHash).toBe(input.files[0].fileHash);
        expect(name).toContain(`-${decoded.header.chunkIndex}-of-2.bmp`);
        if (decoded.header.chunkIndex === 0) {
            expect(decoded.header.fileName).toBe('large.bin');
            expect(decoded.payload).toHaveLength(MAX_CHUNK_PAYLOAD_BYTES);
            expect(decoded.payload.every((byte) => byte === 0)).toBe(true);
            expect(decoded.header.flags).toBe(0);
        } else {
            expect(Buffer.from(decoded.payload)).toEqual(PAYLOAD);
            expect(decoded.header.flags).toBe(1);
        }
    }
    const final = events.filter((event) => event.type === UploadEventType.Progress).at(-1);
    expect(final?.progress.phase).toBe(UploadPhase.Uploading);
    if (final?.progress.phase === UploadPhase.Uploading)
        expect(final.progress.completed + final.progress.reused).toBe(final.progress.total);
    expect(planUpload({ ...input.files[0], size: 250_000_000 }).unwrap().headers).toHaveLength(2);
});

test('one transfer pool bounds a selection, retains confirmations after failure and completes other files', async () => {
    const input = await receive(
        Array.from({ length: 5 }, (_, index) => new File([PAYLOAD], `file-${index}.bin`))
    );
    let active = 0;
    let peak = 0;
    vi.mocked(uploadBmp).mockImplementation((_email, _token, name) =>
        Ok(undefined).andThenAsync(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            active--;
            if (name.startsWith('file-0.'))
                return Err({
                    code: 'REQUEST_FAILED',
                    message: 'Upload transfer failed (HTTP 429)'
                } as const);
            return Ok({ status: UploadStatus.AlreadyExists, mediaKey: name, sha1: '0'.repeat(40) });
        })
    );
    const events: UploadEvent[] = [];
    const result = await uploadFiles(input, (event) => events.push(event));
    expect(result.isOk()).toBe(true);
    expect(active).toBe(0);
    expect(peak).toBe(input.workers);
    expect(events.filter((event) => event.type === UploadEventType.FileError)).toHaveLength(1);
    expect(events.filter((event) => event.type === UploadEventType.Chunk)).toHaveLength(4);
    expect(events.filter((event) => event.type === UploadEventType.FileComplete)).toHaveLength(4);
});

test('stream removes received bytes after completion and after response cancellation', async () => {
    for (const cancelled of [false, true]) {
        const input = await receive();
        const response = uploadStream(input);
        if (cancelled) await response.body?.cancel();
        else {
            const body = await response.text();
            expect(body).toContain('"type":"complete"');
        }
        await vi.waitFor(async () => {
            await expect(access(input.directory)).rejects.toThrow();
        });
    }
});

test('late chunk failure keeps earlier confirmation and leaves queued chunks unread', async () => {
    const input = await receive([
        new File([PAYLOAD], 'large.bin'),
        new File([PAYLOAD], 'good.bin')
    ]);
    const disk = await open(input.files[0].path, 'r+');
    const size = 2 * MAX_CHUNK_PAYLOAD_BYTES + 5;
    await disk.truncate(size);
    await disk.close();
    input.files[0] = { ...input.files[0], size };
    input.workers = 1;
    const readRange = vi.spyOn(temporary, 'readFileRange');
    vi.mocked(uploadBmp).mockImplementation((_email, _token, name) =>
        Ok(undefined).andThenAsync(async () => {
            if (name.startsWith('large.bin.') && name.includes('-1-of-3.bmp'))
                return Err({
                    code: 'REQUEST_FAILED',
                    message: 'Upload transfer failed (HTTP 429)'
                } as const);
            return Ok({ status: UploadStatus.Uploaded, mediaKey: name, sha1: '0'.repeat(40) });
        })
    );

    try {
        const events: UploadEvent[] = [];
        const result = await uploadFiles(input, (event) => events.push(event));
        expect(result.isOk()).toBe(true);
        expect(readRange.mock.calls.map(([path, start]) => ({ path, start }))).toEqual([
            { path: input.files[0].path, start: 0 },
            { path: input.files[0].path, start: MAX_CHUNK_PAYLOAD_BYTES },
            { path: input.files[1].path, start: 0 }
        ]);
        expect(
            events.filter((event) => event.type === UploadEventType.Chunk && event.id === 0)
        ).toMatchObject([{ chunk: { chunkIndex: 0, isLast: false } }]);
        expect(events.filter((event) => event.type === UploadEventType.FileError)).toMatchObject([
            { id: 0, error: 'Upload transfer failed (HTTP 429)' }
        ]);
        expect(events.filter((event) => event.type === UploadEventType.FileComplete)).toMatchObject(
            [{ id: 1 }]
        );
    } finally {
        readRange.mockRestore();
    }
});

test('upload stream reports cleanup failure instead of batch completion', async () => {
    const input = await receive();
    const remove = vi
        .spyOn(temporary, 'removeTemporaryDirectory')
        .mockImplementation(() =>
            Err(SERVER_ERRORS.TEMPORARY_STORAGE_REMOVE_FAILED).andThenAsync(async () =>
                Ok(undefined)
            )
        );

    try {
        const response = uploadStream(input);
        const body = await response.text();
        expect(body).toContain('"type":"file-complete"');
        expect(body).toContain('"error":"Could not remove temporary file storage."');
        expect(body).not.toContain('"type":"complete"');
        expect(remove).toHaveBeenCalledWith(input.directory);
    } finally {
        remove.mockRestore();
    }
});

test('invalid credentials, names and malformed multipart requests fail without Google calls', async () => {
    const invalid = form();
    invalid.set('workers', '0');
    const badWorkers = await receiveUpload(
        new Request('http://localhost/api/upload', { method: 'POST', body: invalid })
    );
    expect(badWorkers.isErr()).toBe(true);
    const badName = await receiveUpload(
        new Request('http://localhost/api/upload', {
            method: 'POST',
            body: form([new File([PAYLOAD], '../unsafe.bin')])
        })
    );
    expect(badName.isErr()).toBe(true);
    const truncated = await receiveUpload(
        new Request('http://localhost/api/upload', {
            method: 'POST',
            headers: { 'content-type': 'multipart/form-data; boundary=broken' },
            body: '--broken\r\nContent-Disposition: form-data; name="file"; filename="proof.bin"\r\n\r\ntruncated'
        })
    );
    expect(truncated.isErr()).toBe(true);
    expect(uploadBmp).not.toHaveBeenCalled();
});
