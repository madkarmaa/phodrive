import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { createHash } from 'node:crypto';
import { receiveUpload, type ReceivedUpload } from '$server/upload-input';
import { uploadFiles } from '$server/uploads';
import {
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type UploadEvent,
    type UploadResponse,
    type UploadProgress
} from '$lib/models';
import { uploadBmp } from '$server/photos';
import { removeTemporaryDirectory } from '$server/temporary-files';

vi.mock('$server/photos', () => ({ uploadBmp: vi.fn() }));

const directories: string[] = [];
const payload = Buffer.from('slow');

afterEach(async () => {
    vi.clearAllMocks();
    for (const directory of directories.splice(0)) await removeTemporaryDirectory(directory);
});

function form(files: File[], workers: number): FormData {
    const data = new FormData();
    data.set('email', 'synthetic@example.com');
    data.set('token', 'aas_et/synthetic');
    data.set('workers', String(workers));
    for (const file of files) data.append('file', file);
    return data;
}

async function receive(files: File[], workers: number): Promise<ReceivedUpload> {
    const result = await receiveUpload(
        new Request('http://localhost/api/upload', {
            method: 'POST',
            body: form(files, workers)
        })
    );
    const input = result.unwrap();
    directories.push(input.directory);
    return input;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
}

test.each([1, 32])('slow selection stays pending and bounded at workers=%i', async (workers) => {
    const fileCount = workers === 1 ? 3 : 40;
    const input = await receive(
        Array.from({ length: fileCount }, (_, index) => new File([payload], `slow-${index}.bin`)),
        workers
    );
    const pendingTransfers: Array<{
        name: string;
        gate: ReturnType<typeof deferred<UploadResponse>>;
    }> = [];
    let active = 0;
    let peak = 0;
    let settled = false;

    vi.mocked(uploadBmp).mockImplementation((_email, _token, name, bmp) => {
        active++;
        peak = Math.max(peak, active);
        const gate = deferred<UploadResponse>();
        pendingTransfers.push({ name, gate });
        return Ok(undefined).andThenAsync(async () => {
            const result = await gate.promise;
            active--;
            return Ok(result);
        });
    });

    const events: UploadEvent[] = [];
    const running = uploadFiles(input, (event) => events.push(event));
    void Promise.resolve(running).then(() => {
        settled = true;
    });

    await vi.waitFor(() => expect(pendingTransfers).toHaveLength(workers));
    expect(settled).toBe(false);
    expect(peak).toBe(workers);

    // Resolve one transfer as reusable and the rest as freshly uploaded.
    await vi.waitFor(() =>
        expect(pendingTransfers.some((transfer) => transfer.name.startsWith('slow-0.bin.'))).toBe(
            true
        )
    );
    const reusedTransfer = pendingTransfers.find((transfer) =>
        transfer.name.startsWith('slow-0.bin.')
    );
    expect(reusedTransfer).toBeDefined();
    const reusable = {
        status: UploadStatus.AlreadyExists,
        mediaKey: 'synthetic-reused-key',
        sha1: createHash('sha1').update(payload).digest('hex')
    } satisfies UploadResponse;
    reusedTransfer?.gate.resolve(reusable);
    await vi.waitFor(() => expect(pendingTransfers.length).toBeGreaterThan(workers));

    const resolvedTransfers = new Set([reusedTransfer?.gate]);
    while (!settled) {
        for (const transfer of pendingTransfers) {
            if (resolvedTransfers.has(transfer.gate)) continue;

            transfer.gate.resolve({
                status: UploadStatus.Uploaded,
                mediaKey: 'synthetic-media-key',
                sha1: createHash('sha1').update(payload).digest('hex')
            } satisfies UploadResponse);
            resolvedTransfers.add(transfer.gate);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const result = await running;
    expect(result.isOk()).toBe(true);
    expect(peak).toBeLessThanOrEqual(workers);
    expect(active).toBe(0);
    expect(events.filter((event) => event.type === UploadEventType.FileComplete)).toHaveLength(
        fileCount
    );
    const progress = events.filter(
        (event) =>
            event.type === UploadEventType.Progress &&
            event.progress.phase === UploadPhase.Uploading
    );
    expect(progress.length).toBeGreaterThanOrEqual(fileCount);
    const lastProgress = new Map<
        number,
        Extract<UploadProgress, { phase: UploadPhase.Uploading }>
    >();
    for (const event of progress) {
        if (
            event.type === UploadEventType.Progress &&
            event.progress.phase === UploadPhase.Uploading
        ) {
            lastProgress.set(event.id, event.progress);
        }
    }
    expect(lastProgress.size).toBe(fileCount);
    expect(
        [...lastProgress.values()].every(
            (progress) => progress.completed + progress.reused === progress.total
        )
    ).toBe(true);
    expect([...lastProgress.values()].some((progress) => progress.reused > 0)).toBe(true);
    expect([...lastProgress.values()].some((progress) => progress.completed > 0)).toBe(true);
    const reusedProgress = lastProgress.get(0);
    expect(reusedProgress?.completed).toBe(0);
    expect(reusedProgress?.reused).toBe(reusedProgress?.total);
    for (let id = 1; id < fileCount; id++) {
        const uploadedProgress = lastProgress.get(id);
        expect(uploadedProgress?.completed).toBe(uploadedProgress?.total);
        expect(uploadedProgress?.reused).toBe(0);
    }
});
