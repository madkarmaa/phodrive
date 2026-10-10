# Local performance suite

Run the suite with `bun run perf --output=/absolute/path/results.json` or `npm run perf -- --output=/absolute/path/results.json`. Run `bun run perf:check` to type-check it. To select cases, pass their names, for example `bun run perf hash-many prefix upload-many --output=/tmp/subset.json`.

Write raw JSON outside the repository or in the ignored `.vitest/performance/` directory. Create the directory first. Both package managers launch the suite with Node, the default production runtime. The suite needs no Google account or network.

Each case runs in a fresh Vitest child process with two warmups and five measured samples. Run cases sequentially, without overlapping builds, tests, other benchmarks, or browser transfers. Use the same machine and runtime on AC power for controls and candidates.

Latency is the median elapsed time for the entire fixed workload. The JSON contains every sample, input bytes, throughput, process peak RSS, and sampled heap and external memory.

## Workloads

Small hash cases batch 200 operations. Many-file hashing and small chunk hashing use 500. Prefix encoding uses 10,000 headers. Planning uses twenty 500 GB metadata-only plans. Library parsing uses ten 1,000-photo pages. Grouping runs ten passes over 4,096 chunks plus 1,024 duplicates. Sorting runs ten sorts of 10,000 files.

`group-many-files` runs ten passes over 10,000 one-chunk files plus 2,500 duplicates to check indexing overhead. Its original-source baseline is recorded separately.

Byte workloads include 0 B, 1 B, 1 KiB, 64 KiB, 8 MiB, 64 MiB, a full 195,000,000-byte chunk, and a 391,048,576-byte file. Uploads test sizes of 194,999,999, 195,000,000, 195,000,001, and 390,000,001 bytes. The mixed dataset contains 64 files of 64 KiB, four of 8 MiB, and one of 196,048,576 bytes. Each run uses the same dataset with 1, 4, 8, or 32 workers. Many-file upload uses 300 files of 64 KiB.

Each cold hash or upload sample creates new File objects. Only the retry case reuses its File. The suite does not bypass or prepopulate production caches.

## Upload verification

Uploads run the production browser preparation, chunk scheduling, FormData, multipart parsing, BMP encoding, Google Photos protocol, SSE handling, and confirmation checks. A test provider replaces external transport. It consumes and hashes every transferred byte, checks content length, calls progress callbacks, and returns deterministic protobuf responses.

The server verifies input integrity before committing. Duplicate uploads also drain and verify all input. The retry case checks an uncertain commit through a hash lookup. Failure cases cover invalid multipart content, mismatched hashes, short transfers, cancellation, and rejected payload streams. Correctness tests also cover malformed metadata, partial confirmations, and corrupted downloads.

## Memory and throughput

Memory metrics cover the whole process, including fixtures, framework startup, warmups, and normal garbage collection. The combined browser and server fixture holds File and Blob buffers in one process. It does not measure separate browser and server RSS.

`maxRSS` is the OS lifetime peak. Heap and external memory values are maxima sampled every 5 ms and at sample boundaries. They are not allocation totals or exact instantaneous peaks. The suite uses no forced garbage collection or special compiler or CPU flags. Compare repeated runs on the same machine and runtime, and treat small changes cautiously.

Throughput counts original input bytes. Protocol parsing counts encoded page bytes instead. Metadata-only and failure cases have no byte throughput.

See [baseline.md](./baseline.md) for the original measurements, [iterations.md](./iterations.md) for accepted and rejected changes, and [results.md](./results.md) for the final AC measurements and ten-run verification.

## Supplemental browser hashing

Copy `src/lib/browser/upload/hash.ts` from production commit `86cba81` into `.svelte-kit/performance/browser-original-hash.ts`. Create that ignored directory after project setup, and keep the copied source unmodified.

Start `bun run dev`, open its URL in an existing Chrome window, and evaluate [browser-hashing.js](./browser-hashing.js) in the browser console or Chrome MCP. The script imports the original and current hashing modules through the dev server. It runs two warmups and five samples for 200 files of 64 KiB and 500 files of 1 KiB. Each operation uses a fresh File. Results contain every sample and validation flag.

Run this comparison separately from other benchmarks, builds, and uploads. It needs no Google account. Remove the temporary original module afterward.
