import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test, vi } from 'vitest';
import { MIB } from './fixtures';
import { createWorkloads, type TransportSlot } from './workloads';

const WARMUPS = 2;
const SAMPLES = 5;
const MEMORY_SAMPLE_MS = 5;

const transport = vi.hoisted<TransportSlot>(() => ({ fetcher: null, fetcherWithProgress: null }));
vi.mock('@madkarmaa/phodrive-core/server/fetcher', () => ({
    photosFetch: (...args: Parameters<typeof fetch>) => transport.fetcher!(...args),
    photosFetchWithProgress:
        (callback: (sent: number) => void) =>
        (...args: Parameters<typeof fetch>) =>
            transport.fetcherWithProgress!(callback)(...args)
}));

/** Time each sample while tracking the process's peak heap and external memory. */
async function measure(run: () => Promise<void> | void) {
    const samplesMs: number[] = [];
    const peak = { external: 0, heap: 0 };
    const sampleMemory = () => {
        const memory = process.memoryUsage();
        peak.external = Math.max(peak.external, memory.external);
        peak.heap = Math.max(peak.heap, memory.heapUsed);
    };

    const timer = setInterval(sampleMemory, MEMORY_SAMPLE_MS);
    try {
        for (let sample = 0; sample < SAMPLES; sample++) {
            sampleMemory();
            const start = performance.now();
            await run();
            samplesMs.push(performance.now() - start);
            sampleMemory();
        }
    } finally {
        clearInterval(timer);
    }

    return { samplesMs, peak };
}

const name = process.env.PHODRIVE_PERF_CASE;

test(`performance: ${name}`, async () => {
    assert.ok(name);
    const workloads = createWorkloads(transport);
    assert.ok(Object.hasOwn(workloads, name), `Unknown benchmark: ${name}`);

    const { run, bytes } = await workloads[name]();
    for (let warmup = 0; warmup < WARMUPS; warmup++) await run();

    const { samplesMs, peak } = await measure(run);
    const medianMs = samplesMs.toSorted((a, b) => a - b)[Math.floor(SAMPLES / 2)];
    const result = {
        name,
        samplesMs,
        medianMs,
        bytes,
        mibPerSecond: bytes / MIB / (medianMs / 1000),
        peakRssMiB: process.resourceUsage().maxRSS / 1024,
        peakExternalMiB: peak.external / MIB,
        peakHeapMiB: peak.heap / MIB
    };

    await writeFile(process.env.PHODRIVE_PERF_RESULT!, JSON.stringify(result));
});
