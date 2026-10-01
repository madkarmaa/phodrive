import { access } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { readJson } from '$server/request';
import { parse } from '$server/protobuf';
import { decodeSplitBmp } from '$server/bmp';
import { receiveUpload } from '$server/upload-input';
import * as temporary from '$server/temporary-files';

const directories: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
        await temporary.removeTemporaryDirectory(directory);
    }
});

function multipartRequest(parts: string, boundary = 'malformed-boundary'): Request {
    return new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: parts
    });
}

function validMultipart(): string {
    return [
        '--malformed-boundary',
        'Content-Disposition: form-data; name="email"',
        '',
        'test@example.com',
        '--malformed-boundary',
        'Content-Disposition: form-data; name="token"',
        '',
        'aas_et/test',
        '--malformed-boundary',
        'Content-Disposition: form-data; name="workers"',
        '',
        '2',
        '--malformed-boundary',
        'Content-Disposition: form-data; name="file"; filename="proof.bin"',
        'Content-Type: application/octet-stream',
        '',
        'bounded synthetic payload',
        '--malformed-boundary--',
        ''
    ].join('\r\n');
}

function trackTemporaryDirectories(): void {
    const createDirectory = temporary.createTemporaryDirectory;
    vi.spyOn(temporary, 'createTemporaryDirectory').mockImplementation(() =>
        createDirectory().inspect((directory) => directories.push(directory))
    );
}

async function expectTemporaryDirectoriesRemoved(): Promise<void> {
    for (const directory of directories) {
        await expect(access(directory)).rejects.toThrow();
    }
}

test('duplicate and unexpected multipart fields are rejected and their temporary files are removed', async () => {
    trackTemporaryDirectories();
    const valid = validMultipart();
    const duplicateEmail = valid.replace(
        '--malformed-boundary\r\nContent-Disposition: form-data; name="token"',
        '--malformed-boundary\r\nContent-Disposition: form-data; name="email"\r\n\r\nother@example.com\r\n--malformed-boundary\r\nContent-Disposition: form-data; name="token"'
    );
    const unexpectedField = valid.replace(
        '--malformed-boundary\r\nContent-Disposition: form-data; name="workers"',
        '--malformed-boundary\r\nContent-Disposition: form-data; name="extra"\r\n\r\nignored\r\n--malformed-boundary\r\nContent-Disposition: form-data; name="workers"'
    );
    const unexpectedFile = valid.replace('name="file"', 'name="image"');

    for (const body of [duplicateEmail, unexpectedField, unexpectedFile]) {
        const received = await receiveUpload(multipartRequest(body));
        expect(received.isErr()).toBe(true);
    }

    expect(directories).toHaveLength(3);
    await expectTemporaryDirectoriesRemoved();
});

test('a multipart body that fails mid-read returns an error and removes partial files', async () => {
    trackTemporaryDirectories();
    const prefix = Buffer.from(validMultipart().split('bounded synthetic payload')[0]);
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            reads++;
            if (reads === 1) {
                controller.enqueue(prefix);
                return;
            }

            controller.error(new Error('synthetic truncated transport'));
        }
    });
    const requestInit = {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=malformed-boundary' },
        body,
        duplex: 'half' as const
    };
    const request = new Request('http://localhost/api/upload', requestInit);

    const received = await receiveUpload(request);

    expect(reads).toBeLessThan(4);
    expect(received.isErr()).toBe(true);
    expect(directories).toHaveLength(1);
    await expectTemporaryDirectoriesRemoved();
});

test('invalid JSON and truncated protobuf and BMP bytes return typed errors', async () => {
    const json = await readJson(
        new Request('http://localhost/api/files', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"action":'
        })
    );
    expect(json.isErr()).toBe(true);

    for (const bytes of [Uint8Array.of(0x80), Uint8Array.of(0x0a, 0x03, 0x01)]) {
        expect(parse(bytes).isErr()).toBe(true);
    }

    const bmp = Uint8Array.of(0x42, 0x4d, 0, 0, 0, 0);
    expect(decodeSplitBmp(bmp).isErr()).toBe(true);
});
