import { afterEach, expect, test, vi } from 'vitest';
import { uploadFiles, type UploadJob } from '$browser/files';
import { UploadJobStatus } from '$lib/models';
import { browserUploadResponse } from '../helpers/upload';

afterEach(() => vi.restoreAllMocks());

test.each([1, 32])(
    'slow requests remain bounded by workers=%i and settle every file',
    async (workers) => {
        const count = workers === 1 ? 3 : 40;
        const gates: (() => void)[] = [];
        let active = 0;
        let peak = 0;
        let finished = false;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise<void>((resolve) => gates.push(resolve));
            active--;
            return browserUploadResponse(
                init,
                String(init?.body instanceof FormData && init.body.get('metadata')).includes(
                    'slow-0.bin'
                )
            );
        });
        const jobs = new Map<number, UploadJob>();
        const files = Array.from(
            { length: count },
            (_, index) => new File(['slow'], `slow-${index}.bin`)
        );
        const pending = Promise.resolve(
            uploadFiles(
                files,
                'test@example.com',
                'aas_et/test',
                workers,
                (job) => jobs.set(job.id, job),
                () => {}
            )
        );
        void pending.then(() => {
            finished = true;
        });
        await vi.waitFor(() => expect(gates).toHaveLength(workers));
        expect(finished).toBe(false);
        expect(peak).toBe(workers);
        while (!finished) {
            for (const resolve of gates.splice(0)) resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const result = await pending;
        expect(result.isOk()).toBe(true);
        expect(active).toBe(0);
        expect(peak).toBeLessThanOrEqual(workers);
        expect([...jobs.values()].every((job) => job.status === UploadJobStatus.Complete)).toBe(
            true
        );
        const reused = jobs.get(0)?.progress;
        expect(reused?.phase).toBe('uploading');
        if (reused?.phase === 'uploading') expect(reused.reused).toBe(reused.total);
    }
);
