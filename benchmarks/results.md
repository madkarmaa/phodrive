# Final performance results

These results measure production source `e16a27c`. Later commits document experiments only. The AC measurements compare it with the unchanged [original performance baseline](./baseline.md) at production source `86cba81`. Both versions used Node v24.21.0 and the same OS, CPU, dependencies, and workloads. Each case had two warmups and five measured samples. Every case ran in a fresh process, sequentially, without competing builds, tests or browser transfers. No special compiler/CPU flags or forced GC were used. See [reproduction instructions](./README.md) and [all accepted/rejected iterations](./iterations.md).

## Original baseline and final AC run

Times are milliseconds for the entire fixed workload. Improvement is percentage reduction in median latency. Throughput counts source input bytes and excludes metadata-only/failure cases (shown as zero). RSS includes fixtures, framework startup and warmups; it is not an application-only memory budget.

| Benchmark         | Baseline ms | Final ms | Improvement | Final sample range ms | Final MiB/s | Baseline RSS MiB | Final RSS MiB |
| ----------------- | ----------: | -------: | ----------: | --------------------: | ----------: | ---------------: | ------------: |
| hash-tiny         |      13.289 |    2.644 |      +80.1% |          2.52 to 3.96 |       73.86 |            113.5 |          95.9 |
| hash-small        |      54.757 |   41.037 |      +25.1% |        24.38 to 52.38 |      304.61 |            155.3 |         158.2 |
| hash-medium       |      33.571 |   33.069 |       +1.5% |        32.94 to 34.88 |      241.92 |            175.0 |         176.3 |
| hash-large        |     244.732 |  241.284 |       +1.4% |      238.61 to 249.56 |      265.25 |            431.4 |         433.1 |
| hash-very-large   |    1393.672 | 1367.013 |       +1.9% |    1361.33 to 1380.57 |      272.81 |           1577.6 |        1578.6 |
| hash-many         |      22.881 |    8.635 |      +62.3% |          5.42 to 9.78 |       56.54 |            121.3 |         100.8 |
| identity          |       3.008 |    3.024 |       -0.5% |          2.33 to 3.55 |        0.00 |             94.5 |          94.9 |
| chunk-hash-small  |      28.557 |   10.418 |      +63.5% |         8.99 to 10.57 |       46.87 |            124.8 |          99.3 |
| chunk-hash-large  |     407.385 |  392.156 |       +3.7% |      381.20 to 404.86 |      474.22 |            829.6 |         830.4 |
| planning          |      51.068 |   53.934 |       -5.6% |        53.65 to 56.47 |        0.00 |            112.7 |         112.9 |
| prefix            |      83.729 |   53.476 |      +36.1% |        53.28 to 54.34 |        0.00 |             95.5 |          96.6 |
| bmp-encode        |       7.806 |    7.550 |       +3.3% |         7.41 to 13.54 |     8476.49 |            533.8 |         597.8 |
| bmp-stream        |     160.109 |  159.688 |       +0.3% |      153.85 to 161.78 |     1164.56 |           1024.7 |        1024.5 |
| download-stream   |      37.169 |   37.023 |       +0.4% |        36.03 to 37.41 |     1728.68 |            235.1 |         235.4 |
| protocol-page     |      49.150 |   46.060 |       +6.3% |        45.15 to 47.19 |        9.27 |            113.5 |         113.7 |
| group-chunks      |     112.526 |    9.773 |      +91.3% |         9.63 to 12.03 |        0.00 |            149.8 |         110.1 |
| group-many-files  |      44.756 |   32.424 |      +27.6% |        31.43 to 36.60 |        0.00 |            356.9 |         237.1 |
| sort-files        |      43.038 |   18.523 |      +57.0% |        18.36 to 21.78 |        0.00 |            112.4 |         107.2 |
| upload-tiny       |       5.931 |    5.367 |       +9.5% |          4.21 to 6.36 |        0.18 |            100.7 |         100.2 |
| upload-many       |     411.040 |  312.782 |      +23.9% |      298.00 to 327.44 |       59.95 |            268.0 |         335.9 |
| upload-large      |    2694.094 | 2717.303 |       -0.9% |    2694.03 to 2720.31 |      137.24 |           1291.1 |        1291.9 |
| upload-boundaries |    6744.757 | 6691.255 |       +0.8% |    6670.77 to 6703.25 |      138.96 |           2602.7 |        2601.1 |
| upload-mixed-1    |    1736.520 | 1694.533 |       +2.4% |    1692.51 to 1701.28 |      131.58 |            802.9 |         782.1 |
| upload-mixed-4    |    1716.280 | 1668.808 |       +2.8% |    1651.32 to 1696.41 |      133.61 |            845.2 |         847.2 |
| upload-mixed-8    |    1685.675 | 1667.920 |       +1.1% |    1653.07 to 1669.77 |      133.68 |            847.6 |         844.6 |
| upload-mixed-32   |    1666.250 | 1626.110 |       +2.4% |    1623.05 to 1641.24 |      137.12 |            862.5 |         877.0 |
| upload-duplicate  |      63.713 |   57.545 |       +9.7% |        54.09 to 67.22 |      139.02 |            219.4 |         234.7 |
| upload-retry      |      86.975 |   86.034 |       +1.1% |        84.75 to 97.40 |       92.99 |            239.1 |         230.9 |
| failure-paths     |       7.729 |    7.039 |       +8.9% |          6.39 to 9.86 |        0.00 |            139.4 |         141.2 |

## Changes and memory use

- Reuse exclusively owned SHA-1/SHA-256 states in bounded pools: fewer WASM allocations for tiny files and chunks, with failed reads and concurrent state isolation tested.
- Use native SHA-256 for 32 KiB to 1 MiB files: retain the existing read bound, progress/cache behavior, and incremental fallback. Larger inputs continue using bounded incremental hashing.
- Encode BMP metadata directly into the destination prefix and encode the filename once; golden Unicode/boundary fixtures preserve exact protocol bytes.
- Build grouped chunk arrays in place with lazy positional indexes, preserving newest/tied duplicates, names, ordering and completeness. Defer locale comparison when timestamps already determine sort order.

The many-small-file upload workload is 23.9% faster (411.040 to 312.782 ms). Peak RSS rises from 268.0 to 335.9 MiB (25.3%), a measured tradeoff accepted for the repeated throughput benefit. This is not an end-to-end memory reduction. Native hashing stays capped at 1 MiB reads, and idle hasher pools are capped at the existing maximum worker count.

Many-file hashing reduces process peak RSS from 121.3 to 100.8 MiB; small chunk hashing from 124.8 to 99.3 MiB. Single-chunk library grouping falls from 356.9 to 237.1 MiB (33.6%). Exact high-water values vary with normal GC. Many-file hashing sampled external memory drops from about 129 MiB to a few MiB. Sampled heap/external values are not exact allocation totals or retained-memory measurements.

Large-upload peak RSS remains about 1,292 MiB. The combined boundary fixture peaks at about 2,601 MiB. Full-buffer BMP encoding fluctuates in whole-buffer increments (the final AC peak is one 64 MiB buffer above baseline); its byte-copying implementation is unchanged. No standalone browser/server RSS improvement is claimed from this combined-process fixture.

## Remaining bottlenecks

The target of at least 20% lower latency is achieved for tiny/small/many-file hashing, small chunk hashing, prefix encoding, both grouping cases, date sorting, and many-small-file upload. Large-file hashing, planning, streaming, downloads, mixed concurrency, duplicate/retry and failure workloads remain near baseline; small differences are not claimed as causal gains.

AC measurements rejected eager per-file maps, fused SSE decoding, bounded hash read-ahead, and shared metadata encoder/empty bytes. These focused attempts produced negligible gains or regressions, so further complexity is not justified by the current evidence. The protobuf parser was restored to the original source; no protocol optimization is retained or claimed.

Planning measured 53.93 ms in the full AC run versus the 51.068 ms original baseline; its adjacent unchanged-code control measured 50.93 ms. The final shared-allocation candidate repeated at 49.14 ms, only 3.5% below that control in a stress case planning twenty 500 GB files, with no memory benefit. The saving per realistic file was too small to justify the change. The table retains the full-suite result.

Incremental SHA-256 and SHA-1 hashing account for most browser CPU work on large inputs. Google requires the complete encoded chunk SHA-1 before upload starts; server hashing verifies untrusted bytes before commit. Removing either changes correctness. Native WebCrypto requires whole input buffers, so using it for unbounded files would sacrifice bounded memory. Streaming reads on demand and limits output block size. The local mixed workload gains only about 4% from 1 to 32 workers while peak RSS rises from 782.1 to 877.0 MiB; this does not justify changing concurrency defaults. Real Google latency and bandwidth are outside the deterministic transport benchmark.

## Validation

The restored final source passed `bun run check` (0 errors, 0 warnings), `bun run test` (176 tests in 43 files), `bun run build`, and `bun run perf:check`, independently run by a verification-only agent. All 29 final AC benchmark workloads passed. Coverage includes real production multipart/BMP/SSE/protocol handling, hashing, duplicates, partial/retried uploads, cancellation and failed streams. New regression tests cover pooled-state isolation/read failure, native digest fallback/cache/progress, golden BMP bytes, grouping semantics, protobuf offsets/malformed siblings, and fragmented Unicode SSE.

Chrome 155 on Linux was verified through Chrome MCP in the existing browser, with the connection agent accepting the native debugging prompts. UI rendering, all six hashing sizes (0, 1 KiB, 32 KiB, 64 KiB, 1 MiB, 1 MiB + 17), cache/progress, 40 concurrent SHA-256 hashes, 40 concurrent encoded-BMP SHA-1 hashes and stable identity passed against native reference digests.

Saved credentials were available. Actual 1,128-byte and 65,536-byte uploads downloaded byte-for-byte with matching SHA-256 hashes. The 64 KiB duplicate reused the existing Google Photos item. Both generated fixtures were moved to trash through their named UI confirmations; the preexisting file remained untouched. No application warnings or errors were observed.

## Supplemental Chrome hashing comparison

This exercises real browser File/Blob/WebCrypto/WASM behavior separately from the Node suite. The original hashing module is unmodified source from `86cba81`; both implementations use deterministic input bytes, fresh File objects for every operation, matching expected digests and progress, two warmups and five measured samples. Original cases ran first, then final cases, sequentially on AC after builds and Node benchmarks finished. No identity cache result was reused. These are additional browser controls, not replacements for the original Node baseline.

| Browser workload | Original median ms | Final median ms | Reduction | Original samples ms               | Final samples ms                  |
| ---------------- | -----------------: | --------------: | --------: | --------------------------------- | --------------------------------- |
| 200 × 64 KiB     |              464.8 |            97.0 |     79.1% | 456.5, 464.8, 423.8, 481.8, 468.8 | 89.1, 97.0, 89.5, 100.2, 97.2     |
| 500 × 1 KiB      |              370.8 |           196.4 |     47.0% | 359.1, 370.8, 455.8, 423.4, 343.5 | 235.3, 301.1, 196.4, 186.4, 132.9 |

Tiny-file browser samples vary and trend downward; the table preserves all samples and uses the predefined median rather than the fastest sample. No Chrome process-memory reduction is inferred from these timings.

## Ten-run verification

Verification repeated unchanged source `13799f7` on AC power. It ran ten complete 29-case Node suites, then ten complete Chrome hashing comparisons. All runs were sequential with no overlapping benchmarks, builds or uploads. Every case retained two warmups and five measured samples. Node v24.21.0, Bun 1.4.2 and Chrome 155 matched the previous environment. AC was connected at every recorded start/end check; the Chrome page remained visible.

All 290 Node case executions with 1,450 measured samples and 40 Chrome case results with 200 measured samples passed their correctness checks. No application or benchmark implementation changed. Raw diagnostics remain in ignored storage.

The table reports the median of ten per-run medians, with the full range of those run medians. Improvements compare with the immutable original Node baseline. Small differences in unchanged operations are not causal optimization claims; tiny cases such as identity generation show greater timing variation.

| Benchmark         | Ten-run median ms |  Run-median range ms | Improvement vs baseline | Median peak RSS MiB | Maximum peak RSS MiB |
| ----------------- | ----------------: | -------------------: | ----------------------: | ------------------: | -------------------: |
| hash-tiny         |             2.784 |       2.609 to 3.246 |                  +79.0% |                96.0 |                 96.3 |
| hash-small        |            22.233 |     16.412 to 40.566 |                  +59.4% |               155.1 |                158.9 |
| hash-medium       |            33.231 |     33.017 to 34.249 |                   +1.0% |               175.5 |                176.5 |
| hash-large        |           241.942 |   240.827 to 245.264 |                   +1.1% |               433.3 |                433.9 |
| hash-very-large   |          1364.894 | 1363.112 to 1368.723 |                   +2.1% |              1578.3 |               1578.9 |
| hash-many         |             8.158 |       7.038 to 8.780 |                  +64.3% |               101.6 |                102.2 |
| identity          |             3.270 |       2.995 to 5.529 |                   -8.7% |                94.3 |                 94.8 |
| chunk-hash-small  |            10.122 |      9.509 to 10.945 |                  +64.6% |                99.5 |                 99.9 |
| chunk-hash-large  |           386.358 |   384.727 to 388.940 |                   +5.2% |               829.9 |                830.6 |
| planning          |            50.918 |     48.821 to 52.903 |                   +0.3% |               112.9 |                113.5 |
| prefix            |            54.395 |     53.713 to 55.116 |                  +35.0% |                96.5 |                 97.9 |
| bmp-encode        |             7.517 |       7.351 to 9.551 |                   +3.7% |               565.9 |                598.3 |
| bmp-stream        |           157.949 |   153.744 to 159.479 |                   +1.3% |              1025.6 |               1026.0 |
| download-stream   |            36.727 |     36.637 to 37.001 |                   +1.2% |               234.9 |                236.0 |
| protocol-page     |            46.876 |     45.912 to 48.449 |                   +4.6% |               114.2 |                114.7 |
| group-chunks      |             9.859 |      9.658 to 10.197 |                  +91.2% |               110.3 |                110.7 |
| group-many-files  |            31.611 |     23.227 to 33.378 |                  +29.4% |               235.7 |                240.2 |
| sort-files        |            18.636 |     18.412 to 20.417 |                  +56.7% |               107.1 |                107.4 |
| upload-tiny       |             5.162 |       4.882 to 5.470 |                  +13.0% |               100.4 |                103.1 |
| upload-many       |           307.831 |   302.329 to 319.546 |                  +25.1% |               338.3 |                342.5 |
| upload-large      |          2695.462 | 2683.032 to 2709.137 |                   -0.1% |              1291.6 |               1316.8 |
| upload-boundaries |          6676.102 | 6652.034 to 6706.493 |                   +1.0% |              2601.3 |               2602.5 |
| upload-mixed-1    |          1686.831 | 1682.707 to 1698.575 |                   +2.9% |               798.6 |                804.3 |
| upload-mixed-4    |          1663.740 | 1642.743 to 1669.431 |                   +3.1% |               844.9 |                850.9 |
| upload-mixed-8    |          1662.512 | 1651.473 to 1679.431 |                   +1.4% |               846.8 |                853.6 |
| upload-mixed-32   |          1638.659 | 1628.006 to 1664.281 |                   +1.7% |               874.8 |                887.1 |
| upload-duplicate  |            57.068 |     56.543 to 62.706 |                  +10.4% |               218.6 |                220.0 |
| upload-retry      |            87.089 |     85.293 to 93.134 |                   -0.1% |               230.6 |                232.7 |
| failure-paths     |             7.077 |       6.910 to 7.481 |                   +8.4% |               144.4 |                145.3 |

The repeated Node measurements show 25.1% lower latency for many-file upload, 91.2% for grouping, 35.0% for prefix encoding, and 56.7% for date sorting. Large-file uploads remain effectively unchanged. Native small-file hashing ranges from 16.4 to 40.6 ms, so its median does not predict every run. Single-chunk grouping and full-buffer BMP RSS also vary with normal garbage collection. The previously reported many-file upload memory tradeoff remains; these repetitions do not establish lower end-to-end upload memory.

The browser comparisons use the original and final implementations within each unchanged harness run:

| Browser workload | Original median ms | Final median ms | Reduction | Original run-median range ms | Final run-median range ms | Paired reduction range |
| ---------------- | -----------------: | --------------: | --------: | ---------------------------: | ------------------------: | ---------------------: |
| 200 × 64 KiB     |             422.95 |           96.95 |     77.1% |               401.1 to 456.2 |             67.0 to 136.5 |         68.3% to 84.3% |
| 500 × 1 KiB      |             309.85 |          215.35 |     30.5% |               237.7 to 384.2 |            159.0 to 322.9 |          5.8% to 50.3% |

Every paired browser comparison was faster with the final implementation, and every digest/progress validation passed. The repeated tiny-file aggregate is 30.5%, below the earlier single-run estimate of 47.0%, with paired gains ranging from 5.8% to 50.3%. Use the repeated result for expectations; the initial figures above remain recorded evidence, not a guaranteed speedup. Small-file browser hashing repeats at 77.1% lower latency. No live uploads were repeated in this verification phase.

## Commits

Baseline/suite: `45d73b6`, supplementary one-chunk coverage `46f7ef9`.

Accepted optimizations: `cef3c6f` (hasher reuse), `ff06a99` (BMP metadata), `9d01e65` (chunk grouping), `18cebd4` (date sorting), `91c4a58` (bounded native hashing).

Protocol experiment `dcfbcf5` was reverted by `e16a27c`. Additional rejected experiments and retained regression tests are documented in the iteration log and focused commits.
