import { afterEach, expect, test, vi } from 'vitest';
import { readJson } from '$server/request';
import { parse } from '$server/protobuf';
import { decodeSplitBmp } from '$server/bmp';
import { receiveUpload } from '$server/upload/input';
import { encodeUploadBmp } from '$server/upload/bmp';
import { uploadForm } from '../helpers/upload';

afterEach(() => vi.restoreAllMocks());

async function checked(request: Request) {
    const received = await receiveUpload(request);
    if (received.isErr()) return received.map(() => undefined);
    const input = received.unwrap();
    const source = encodeUploadBmp(input);
    const result = await source.drain();
    await input.cancel();
    return result;
}

test('duplicate, unexpected, reordered and missing multipart fields are rejected without disk writes', async () => {
    for (const damage of ['duplicate', 'extra', 'missing', 'file-first', 'extra-file']) {
        const fixture = uploadForm();
        const form = new FormData();
        if (damage === 'file-first') form.set('chunk', fixture.form.get('chunk')!);
        if (damage !== 'missing') form.set('metadata', fixture.form.get('metadata')!);
        if (damage === 'duplicate') form.append('metadata', fixture.form.get('metadata')!);
        if (damage === 'extra') form.set('extra', 'unexpected');
        if (damage !== 'file-first') form.set('chunk', fixture.form.get('chunk')!);
        if (damage === 'extra-file') form.append('chunk', new Blob(['unexpected']), 'extra.bin');
        // Serialize these tiny fixtures before cancellation; native FormData producers
        // otherwise continue enqueueing after a malformed request has been rejected.
        const serialized = new Request('http://localhost/api/upload', {
            method: 'POST',
            body: form
        });
        const bytes = await serialized.arrayBuffer();
        const result = await checked(
            new Request(serialized.url, {
                method: 'POST',
                headers: serialized.headers,
                body: bytes
            })
        );
        expect(result.isErr()).toBe(true);
    }
});

test('a multipart body that fails mid-read returns a typed error without retaining partial files', async () => {
    const fixture = uploadForm(Buffer.from('bounded synthetic payload'));
    const original = fixture.request();
    const text = await original.text();
    const prefix = new TextEncoder().encode(text.split('bounded synthetic payload')[0]);
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (++reads === 1) {
                controller.enqueue(prefix);
                return;
            }
            controller.error(new Error('synthetic truncated transport'));
        }
    });
    const init = { method: 'POST', headers: original.headers, body, duplex: 'half' as const };
    const result = await checked(new Request('http://localhost/api/upload', init));
    expect(result.isErr()).toBe(true);
    expect(reads).toBeLessThan(4);
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
