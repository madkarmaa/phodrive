// Run in the existing Chrome page at http://127.0.0.1:5173/.
// The original module is the unmodified 86cba81 hash.ts, copied to the ignored
// .svelte-kit/performance/browser-original-hash.ts path for Vite to serve.
// Run all four cases sequentially without concurrent builds, tests, or uploads.

(async () => {
    window.__phodriveVerification = {
        original: await import('/.svelte-kit/performance/browser-original-hash.ts'),
        final: await import('/src/lib/browser/upload/hash.ts')
    };

    const state = window.__phodriveVerification;
    state.benchmark = [];
    const hex = (bytes) =>
        Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
    state.runBenchmark = async (implementation, size, count) => {
        const impl = state[implementation];
        const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) % 256);
        const blob = new Blob([bytes]);
        const expected = hex(await crypto.subtle.digest('SHA-256', bytes));
        const runs = [];
        for (let run = 0; run < 7; run++) {
            let verified = 0;
            let progressCalls = 0;
            let progressValid = true;
            const start = performance.now();
            for (let i = 0; i < count; i++) {
                const file = new File([blob], 'bench-' + run + '-' + i + '.bin');
                const hashed = await impl.hashFile(file, (n) => {
                    progressCalls++;
                    progressValid = progressValid && n === size;
                });
                const digest = hashed.unwrap();
                if (digest !== expected) throw new Error('Digest mismatch');
                verified++;
            }
            runs.push({ ms: performance.now() - start, verified, progressCalls, progressValid });
        }
        const samples = runs.slice(2).map((x) => x.ms);
        const median = [...samples].sort((a, b) => a - b)[2];
        const result = {
            implementation,
            workload: size === 65536 ? 'hash-small' : 'hash-many',
            size,
            count,
            warmups: 2,
            samples,
            medianMs: median,
            everyDigestVerified: runs.every((x) => x.verified === count),
            progressValid: runs.every((x) => x.progressValid && x.progressCalls === count),
            freshFilePerHash: true
        };
        state.benchmark.push(result);
        return result;
    };

    await window.__phodriveVerification.runBenchmark('original', 65536, 200);
    await window.__phodriveVerification.runBenchmark('original', 1024, 500);
    await window.__phodriveVerification.runBenchmark('final', 65536, 200);
    await window.__phodriveVerification.runBenchmark('final', 1024, 500);

    return window.__phodriveVerification.benchmark;
})();
