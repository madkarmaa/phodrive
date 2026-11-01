import { afterEach, expect, test, vi } from 'vitest';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadFiles, planUpload } from '@madkarmaa/phodrive-core/server/upload';
import { MAX_CHUNK_PAYLOAD_BYTES } from '@madkarmaa/phodrive-core/server/bmp';
import { UploadEventType, type UploadEvent } from '@madkarmaa/phodrive-core/models';
import { uploadForm, photosUploadHarness, TEST_ACCOUNT } from '../helpers/upload';

afterEach(() => vi.restoreAllMocks());

test('deduplication still validates the complete incoming split without a Google transfer', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
    const harness = photosUploadHarness({ duplicate: true });
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(
        received.unwrap(),
        (event) => events.push(event),
        harness.fetcher
    );
    expect(uploaded.isOk()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 0, commits: 0 });
    expect(events.find((event) => event.type === UploadEventType.FileComplete)).toMatchObject({
        result: { status: 'already exists' }
    });
    await received.unwrap().cancel();
});

test('uncertain commits can be resolved by a stable SHA-1 lookup on retry', async () => {
    const fixture = uploadForm();
    const harness = photosUploadHarness({ failCommit: true });
    const first = await receiveUpload(fixture.request(), TEST_ACCOUNT);
    const failed = await uploadFiles(first.unwrap(), () => {}, harness.fetcher);
    expect(failed.unwrapErr().code).toBe('COMMIT_OUTCOME_UNCERTAIN');
    await first.unwrap().cancel();
    const second = await receiveUpload(fixture.request(), TEST_ACCOUNT);
    const retried = await uploadFiles(second.unwrap(), () => {}, harness.fetcher);
    expect(retried.isOk()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 1, commits: 1 });
    await second.unwrap().cancel();
});

test('metadata-only preparation can describe a 500 GB source without opening or allocating that file', async () => {
    const size = 500_000_000_000;
    const plan = planUpload({ name: '500gb.bin', size, fileHash: 'a'.repeat(64) }).unwrap();
    expect(plan.headers).toHaveLength(Math.ceil(size / MAX_CHUNK_PAYLOAD_BYTES));
    expect(plan.headers.reduce((sum, header) => sum + header.payloadSize, 0)).toBe(size);
    expect(plan.headers.at(-1)?.flags).toBe(1);
    const fixture = uploadForm(new Uint8Array(), '500gb.bin', { fileSize: size });
    const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
    expect(received.unwrap().header.payloadSize).toBe(MAX_CHUNK_PAYLOAD_BYTES);
    expect(received.unwrap().bmp.prefix.length).toBeLessThan(512);
    await received.unwrap().cancel();
});

test('the server account replaces credentials sent in chunk metadata', async () => {
    const fixture = uploadForm();
    const form = new FormData();
    form.set(
        'metadata',
        JSON.stringify({ ...fixture.metadata, email: 'other@example.com', token: 'aas_et/other' })
    );
    form.set('chunk', fixture.form.get('chunk') ?? '');
    const request = new Request('http://localhost/api/upload', { method: 'POST', body: form });

    const received = await receiveUpload(request, TEST_ACCOUNT);
    const input = received.unwrap();
    await input.cancel();

    expect(input.email).toBe(TEST_ACCOUNT.email);
    expect(input.token).toBe(TEST_ACCOUNT.token);
});
