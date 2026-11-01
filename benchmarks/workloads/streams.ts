import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { SplitBmpReader } from '@madkarmaa/phodrive-core/server/bmp/stream';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { receiveUpload, type ReceivedUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { TEST_ACCOUNT, uploadForm } from '../../core/tests/helpers/upload';
import { blocks, CHUNK, header, MIB, type Workload } from '../fixtures';

enum Failure {
    Hash = 'hash',
    Short = 'short',
    Cancel = 'cancel',
    Stream = 'stream'
}

export function bmpStreamWorkload(): Workload {
    const fixture = uploadForm(new Uint8Array(CHUNK).fill(42));

    return {
        bytes: CHUNK,
        run: async () => {
            const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
            const input = received.unwrap();
            const source = encodeUploadBmp(input);
            const result = await source.drain();

            assert.ok(result.isOk());
            await input.cancel();
        }
    };
}

export function downloadStreamWorkload(): Workload {
    const data = new Uint8Array(64 * MIB).fill(42);
    const metadata = header(data.length);
    const bmp = encodeSplitBmp(data, metadata).unwrap();
    const sha1 = createHash('sha1').update(bmp).digest('hex');

    return {
        bytes: data.length,
        run: async () => {
            const opened = await SplitBmpReader.open(new Response(blocks(bmp)), metadata, sha1);
            const reader = opened.unwrap();
            let length = 0;

            while (true) {
                const next = await reader.readPayload();
                const part = next.unwrap();
                if (part === null) break;

                length += part.length;
            }

            assert.equal(length, data.length);
        }
    };
}

async function breakUpload(input: ReceivedUpload, failure: Failure) {
    if (failure === Failure.Hash) input.sha1 = '0'.repeat(40);
    if (failure === Failure.Short) input.header.payloadSize++;
    if (failure !== Failure.Stream) return;

    await input.cancel();
    input.payload = new ReadableStream({
        pull(controller) {
            controller.error(new Error('failed stream'));
        }
    });
}

/** Each broken upload must fail its transfer and its verification. */
async function failUpload(request: Request, failure: Failure) {
    const received = await receiveUpload(request, TEST_ACCOUNT);
    const input = received.unwrap();
    await breakUpload(input, failure);

    const source = encodeUploadBmp(input);
    if (failure === Failure.Cancel) await source.body.cancel();
    else {
        const drained = await source.drain();
        assert.ok(drained.isErr());
    }

    const verified = await source.verified;
    assert.ok(verified.isErr());
    await input.cancel();
}

export function failurePathsWorkload(): Workload {
    const fixture = uploadForm(new Uint8Array(MIB).fill(42));

    return {
        bytes: 0,
        run: async () => {
            const invalid = await receiveUpload(
                new Request('http://localhost/api/upload', { method: 'POST', body: 'bad' }),
                TEST_ACCOUNT
            );
            assert.ok(invalid.isErr());

            for (const failure of Object.values(Failure))
                await failUpload(fixture.request(), failure);
        }
    };
}
