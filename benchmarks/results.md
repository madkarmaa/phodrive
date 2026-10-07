# Final performance results

Final production source: `e16a27c` (later commits document experiments only). Measured on AC power against the unchanged [True Performance Baseline](./baseline.md), production source `86cba81`. Same Node v24.21.0, OS, CPU, dependencies, workloads, two warmups and five measured samples per case. Every case ran in a fresh process, sequentially, without competing builds, tests or browser transfers. No special compiler/CPU flags or forced GC were used. See [reproduction instructions](./README.md) and [all accepted/rejected iterations](./iterations.md).

The device switched to battery during the work and subsequently returned to AC. Battery results are preserved separately below; they are not substituted for the original baseline or mixed into the AC comparison.

## Performance summary: original baseline versus final AC run

Milliseconds per entire fixed workload, not per file. Improvement is percentage reduction in median latency. Throughput counts source input bytes and excludes metadata-only/failure cases (shown as zero). RSS includes fixtures, framework startup and warmups; it is not an application-only memory budget.

| Benchmark         | Baseline ms | Final ms | Improvement | Final sample range ms | Final MiB/s | Baseline RSS MiB | Final RSS MiB |
| ----------------- | ----------: | -------: | ----------: | --------------------: | ----------: | ---------------: | ------------: |
| hash-tiny         |      13.289 |    2.644 |      +80.1% |             2.52–3.96 |       73.86 |            113.5 |          95.9 |
| hash-small        |      54.757 |   41.037 |      +25.1% |           24.38–52.38 |      304.61 |            155.3 |         158.2 |
| hash-medium       |      33.571 |   33.069 |       +1.5% |           32.94–34.88 |      241.92 |            175.0 |         176.3 |
| hash-large        |     244.732 |  241.284 |       +1.4% |         238.61–249.56 |      265.25 |            431.4 |         433.1 |
| hash-very-large   |    1393.672 | 1367.013 |       +1.9% |       1361.33–1380.57 |      272.81 |           1577.6 |        1578.6 |
| hash-many         |      22.881 |    8.635 |      +62.3% |             5.42–9.78 |       56.54 |            121.3 |         100.8 |
| identity          |       3.008 |    3.024 |       -0.5% |             2.33–3.55 |        0.00 |             94.5 |          94.9 |
| chunk-hash-small  |      28.557 |   10.418 |      +63.5% |            8.99–10.57 |       46.87 |            124.8 |          99.3 |
| chunk-hash-large  |     407.385 |  392.156 |       +3.7% |         381.20–404.86 |      474.22 |            829.6 |         830.4 |
| planning          |      51.068 |   53.934 |       -5.6% |           53.65–56.47 |        0.00 |            112.7 |         112.9 |
| prefix            |      83.729 |   53.476 |      +36.1% |           53.28–54.34 |        0.00 |             95.5 |          96.6 |
| bmp-encode        |       7.806 |    7.550 |       +3.3% |            7.41–13.54 |     8476.49 |            533.8 |         597.8 |
| bmp-stream        |     160.109 |  159.688 |       +0.3% |         153.85–161.78 |     1164.56 |           1024.7 |        1024.5 |
| download-stream   |      37.169 |   37.023 |       +0.4% |           36.03–37.41 |     1728.68 |            235.1 |         235.4 |
| protocol-page     |      49.150 |   46.060 |       +6.3% |           45.15–47.19 |        9.27 |            113.5 |         113.7 |
| group-chunks      |     112.526 |    9.773 |      +91.3% |            9.63–12.03 |        0.00 |            149.8 |         110.1 |
| group-many-files  |      44.756 |   32.424 |      +27.6% |           31.43–36.60 |        0.00 |            356.9 |         237.1 |
| sort-files        |      43.038 |   18.523 |      +57.0% |           18.36–21.78 |        0.00 |            112.4 |         107.2 |
| upload-tiny       |       5.931 |    5.367 |       +9.5% |             4.21–6.36 |        0.18 |            100.7 |         100.2 |
| upload-many       |     411.040 |  312.782 |      +23.9% |         298.00–327.44 |       59.95 |            268.0 |         335.9 |
| upload-large      |    2694.094 | 2717.303 |       -0.9% |       2694.03–2720.31 |      137.24 |           1291.1 |        1291.9 |
| upload-boundaries |    6744.757 | 6691.255 |       +0.8% |       6670.77–6703.25 |      138.96 |           2602.7 |        2601.1 |
| upload-mixed-1    |    1736.520 | 1694.533 |       +2.4% |       1692.51–1701.28 |      131.58 |            802.9 |         782.1 |
| upload-mixed-4    |    1716.280 | 1668.808 |       +2.8% |       1651.32–1696.41 |      133.61 |            845.2 |         847.2 |
| upload-mixed-8    |    1685.675 | 1667.920 |       +1.1% |       1653.07–1669.77 |      133.68 |            847.6 |         844.6 |
| upload-mixed-32   |    1666.250 | 1626.110 |       +2.4% |       1623.05–1641.24 |      137.12 |            862.5 |         877.0 |
| upload-duplicate  |      63.713 |   57.545 |       +9.7% |           54.09–67.22 |      139.02 |            219.4 |         234.7 |
| upload-retry      |      86.975 |   86.034 |       +1.1% |           84.75–97.40 |       92.99 |            239.1 |         230.9 |
| failure-paths     |       7.729 |    7.039 |       +8.9% |             6.39–9.86 |        0.00 |            139.4 |         141.2 |

## Major improvements and memory

- Reuse exclusively owned SHA-1/SHA-256 states in bounded pools: fewer WASM allocations for tiny files and chunks, with failed reads and concurrent state isolation tested.
- Use native SHA-256 for 32 KiB–1 MiB files: retain the existing read bound, progress/cache behavior, and incremental fallback. Larger inputs continue using bounded incremental hashing.
- Encode BMP metadata directly into the destination prefix and encode the filename once; golden Unicode/boundary fixtures preserve exact protocol bytes.
- Build grouped chunk arrays in place with lazy positional indexes, preserving newest/tied duplicates, names, ordering and completeness. Defer locale comparison when timestamps already determine sort order.

The many-small-file upload workload is 23.9% faster (411.040 to 312.782 ms). Peak RSS rises from 268.0 to 335.9 MiB (25.3%), a measured tradeoff accepted for the repeated throughput benefit. This is not an end-to-end memory reduction. Native hashing stays capped at 1 MiB reads, and idle hasher pools are capped at the existing maximum worker count.

Many-file hashing reduces process peak RSS from 121.3 to 100.8 MiB; small chunk hashing from 124.8 to 99.3 MiB. Single-chunk library grouping falls from 356.9 to 237.1 MiB (33.6%); the battery pair showed 354.2 to 160.6 MiB. Exact high-water values vary with normal GC. Many-file hashing sampled external memory drops from about 129 MiB to a few MiB. Sampled heap/external values are not exact allocation totals or retained-memory measurements.

Large-upload peak RSS remains about 1,292 MiB, the combined boundary fixture about 2,601 MiB. Full-buffer BMP encoding fluctuates in whole-buffer increments (the final AC peak is one 64 MiB buffer above baseline); its byte-copying implementation is unchanged. No standalone browser/server RSS improvement is claimed from this combined-process fixture.

## Convergence and remaining bottlenecks

The target of at least 20% lower latency is achieved for tiny/small/many-file hashing, small chunk hashing, prefix encoding, both grouping cases, date sorting, and many-small-file upload. Large-file hashing, planning, streaming, downloads, mixed concurrency, duplicate/retry and failure workloads remain near baseline; small differences are not claimed as causal gains.

Rejected experiments include eager per-file maps, fused SSE decoding, bounded hash read-ahead, array-free protobuf lookup, extra stream-view branching, and shared metadata encoder/empty bytes. The initially accepted protobuf buffer views were reverted after three paired controls failed to reproduce the benefit; the final parser equals the original source. Several successive focused attempts produced negligible gains or regressions, so further complexity is not justified by the current evidence.

Planning measured 53.93 ms in the full AC run versus the 51.068 ms original baseline; its adjacent unchanged-code control measured 50.93 ms. The final shared-allocation candidate repeated at 49.14 ms, only 3.5% below that control in a stress case planning twenty 500 GB files, with no memory benefit. It was rejected as immaterial per realistic file. Keep the full-suite result visible instead of replacing it with a favorable repeat.

Browser incremental SHA-256/SHA-1 remains the dominant byte-heavy CPU cost. Google requires the complete encoded chunk SHA-1 before upload starts; server hashing verifies untrusted bytes before commit. Removing either changes correctness. Native WebCrypto requires whole input buffers, so using it for unbounded files would sacrifice bounded memory. Streaming already follows demand with bounded output. The local mixed workload gains only about 4% from 1 to 32 workers while peak RSS rises from 782.1 to 877.0 MiB; this does not justify changing concurrency defaults. Real Google latency and bandwidth are outside the deterministic transport benchmark.

## Correctness

The restored final source passed `bun run check` (0 errors, 0 warnings), `bun run test` (176 tests in 43 files), `bun run build`, and `bun run perf:check`, independently run by a verification-only agent. All 29 final AC benchmark workloads passed. Coverage includes real production multipart/BMP/SSE/protocol handling, hashing, duplicates, partial/retried uploads, cancellation and failed streams. New regression tests cover pooled-state isolation/read failure, native digest fallback/cache/progress, golden BMP bytes, grouping semantics, protobuf offsets/malformed siblings, and fragmented Unicode SSE.

Chrome 155 on Linux was verified through Chrome MCP in the existing browser, with the connection agent accepting the native debugging prompts. UI rendering, all six hashing sizes (0, 1 KiB, 32 KiB, 64 KiB, 1 MiB, 1 MiB + 17), cache/progress, 40 concurrent SHA-256 hashes, 40 concurrent encoded-BMP SHA-1 hashes and stable identity passed against native reference digests.

Saved credentials were available. Actual 1,128-byte and 65,536-byte uploads downloaded byte-for-byte with matching SHA-256 hashes. The 64 KiB duplicate reused the existing Google Photos item. Both generated fixtures were moved to trash through their named UI confirmations; the preexisting file remained untouched. No application warnings/errors were observed; an initial diagnostic-module URL was blocked by the dev server and resolved by moving that temporary module into an already-allowed generated directory.

## Supplemental Chrome hashing comparison

This exercises real browser File/Blob/WebCrypto/WASM behavior separately from the Node suite. The original hashing module is unmodified source from `86cba81`; both implementations use deterministic input bytes, fresh File objects for every operation, matching expected digests and progress, two warmups and five measured samples. Original cases ran first, then final cases, sequentially on AC after builds and Node benchmarks finished. No identity cache result was reused. These are additional browser controls, not replacements for the original Node baseline.

| Browser workload | Original median ms | Final median ms | Reduction | Original samples ms               | Final samples ms                  |
| ---------------- | -----------------: | --------------: | --------: | --------------------------------- | --------------------------------- |
| 200 × 64 KiB     |              464.8 |            97.0 |     79.1% | 456.5, 464.8, 423.8, 481.8, 468.8 | 89.1, 97.0, 89.5, 100.2, 97.2     |
| 500 × 1 KiB      |              370.8 |           196.4 |     47.0% | 359.1, 370.8, 455.8, 423.4, 343.5 | 235.3, 301.1, 196.4, 186.4, 132.9 |

Tiny-file browser samples vary and trend downward; the table preserves all samples and uses the predefined median rather than the fastest sample. No Chrome process-memory reduction is inferred from these timings.

## Separate battery control

After the power-mode change, the original production source was rerun from baseline commit `45d73b6` in an isolated checkout with the unchanged suite plus the documented `group-many-files` addition. The final source was then run under the same battery conditions. This additional control preserves comparability without modifying the True Performance Baseline. Both complete suites used the same warmups/samples and sequential isolation.

| Benchmark         | Original source ms |  Final ms | Improvement | Control RSS MiB | Final RSS MiB |
| ----------------- | -----------------: | --------: | ----------: | --------------: | ------------: |
| hash-tiny         |             24.828 |     8.564 |      +65.5% |           111.7 |          94.9 |
| hash-small        |             93.411 |    42.008 |      +55.0% |           139.9 |         158.6 |
| hash-medium       |             56.834 |    57.270 |       -0.8% |           168.7 |         172.2 |
| hash-large        |            416.945 |   409.095 |       +1.9% |           409.7 |         409.5 |
| hash-very-large   |           2370.493 |  2365.110 |       +0.2% |          1576.9 |        1578.2 |
| hash-many         |             36.774 |    13.955 |      +62.1% |           115.2 |         100.6 |
| identity          |              6.723 |     6.956 |       -3.5% |            93.9 |          94.2 |
| chunk-hash-small  |             54.769 |    19.315 |      +64.7% |           129.1 |          98.8 |
| chunk-hash-large  |            678.632 |   675.068 |       +0.5% |           830.1 |         829.7 |
| planning          |             85.442 |    94.560 |      -10.7% |           111.6 |         113.2 |
| prefix            |            145.682 |    94.948 |      +34.8% |            95.4 |          96.7 |
| bmp-encode        |             16.977 |    15.076 |      +11.2% |           405.8 |         405.3 |
| bmp-stream        |            250.715 |   249.499 |       +0.5% |          1024.6 |        1025.6 |
| download-stream   |             61.236 |    61.392 |       -0.3% |           235.0 |         234.3 |
| protocol-page     |             86.902 |    80.023 |       +7.9% |           113.7 |         113.5 |
| group-chunks      |            177.498 |    16.173 |      +90.9% |           148.6 |         109.8 |
| group-many-files  |             74.279 |    40.422 |      +45.6% |           354.2 |         160.6 |
| sort-files        |             76.201 |    31.945 |      +58.1% |           112.4 |         107.2 |
| upload-tiny       |              9.493 |    10.915 |      -15.0% |           100.3 |         100.6 |
| upload-many       |            742.863 |   544.382 |      +26.7% |           268.2 |         341.0 |
| upload-large      |           4621.083 |  4599.565 |       +0.5% |          1293.5 |        1291.7 |
| upload-boundaries |          11439.835 | 11567.853 |       -1.1% |          2607.9 |        2600.6 |
| upload-mixed-1    |           2936.974 |  2914.440 |       +0.8% |           803.5 |         798.2 |
| upload-mixed-4    |           2907.421 |  2920.697 |       -0.5% |           831.0 |         832.2 |
| upload-mixed-8    |           2899.397 |  2864.800 |       +1.2% |           846.7 |         844.7 |
| upload-mixed-32   |           2864.650 |  2862.255 |       +0.1% |           876.1 |         874.2 |
| upload-duplicate  |             96.818 |    96.716 |       +0.1% |           193.1 |         193.4 |
| upload-retry      |            155.815 |   159.906 |       -2.6% |           199.4 |         200.5 |
| failure-paths     |             13.661 |    17.196 |      -25.9% |           145.1 |         144.5 |

The many-file upload gain repeated (742.863 to 544.382 ms, 26.7%), with RSS rising 268.2 to 341.0 MiB. Sampled external memory fell 80.0 to 72.3 MiB while sampled heap rose 60.6 to 94.4 MiB. Large and concurrent uploads remained close to controls.

Apparent short-case regressions were checked with paired repeats, without replacing the full-suite values above:

| Case          | Original / final pair 1 ms | Original / final pair 2 ms | Interpretation                               |
| ------------- | -------------------------: | -------------------------: | -------------------------------------------- |
| planning      |              84.33 / 84.99 |              83.99 / 84.33 | Full-suite 94.56 ms candidate did not recur. |
| upload-tiny   |                9.65 / 9.92 |               10.67 / 9.52 | Direction varies; no claimed change.         |
| failure-paths |              11.75 / 14.71 |              14.85 / 12.98 | Direction varies; no claimed change.         |

Identity generation is unchanged; additional original medians 7.07/7.21/6.99 ms and candidate 6.08/7.48/5.05 ms demonstrate short-case variability. Protobuf-view repeat results and the final revert are documented in iteration 11.

## Ten-run verification

Repeated unchanged source `13799f7` on AC power: ten full 29-case Node suites, followed by ten complete Chrome hashing harnesses. All runs were sequential with no overlapping benchmarks, builds or uploads. Every case retained two warmups and five measured samples. Node v24.21.0, Bun 1.4.2 and Chrome 155 matched the previous environment. AC was connected at every recorded start/end check; the Chrome page remained visible.

All **290 Node case executions / 1,450 measured samples** and **40 Chrome case results / 200 measured samples** passed their correctness checks. No application or benchmark implementation changed. Raw diagnostics remain in ignored storage.

The table reports the median of ten per-run medians, with the full range of those run medians. Improvements compare with the immutable original Node baseline. Small differences in unchanged operations are not causal optimization claims; tiny cases such as identity generation show greater timing variation.

| Benchmark         | Ten-run median ms | Run-median range ms | Improvement vs baseline | Median peak RSS MiB | Maximum peak RSS MiB |
| ----------------- | ----------------: | ------------------: | ----------------------: | ------------------: | -------------------: |
| hash-tiny         |             2.784 |         2.609–3.246 |                  +79.0% |                96.0 |                 96.3 |
| hash-small        |            22.233 |       16.412–40.566 |                  +59.4% |               155.1 |                158.9 |
| hash-medium       |            33.231 |       33.017–34.249 |                   +1.0% |               175.5 |                176.5 |
| hash-large        |           241.942 |     240.827–245.264 |                   +1.1% |               433.3 |                433.9 |
| hash-very-large   |          1364.894 |   1363.112–1368.723 |                   +2.1% |              1578.3 |               1578.9 |
| hash-many         |             8.158 |         7.038–8.780 |                  +64.3% |               101.6 |                102.2 |
| identity          |             3.270 |         2.995–5.529 |                   -8.7% |                94.3 |                 94.8 |
| chunk-hash-small  |            10.122 |        9.509–10.945 |                  +64.6% |                99.5 |                 99.9 |
| chunk-hash-large  |           386.358 |     384.727–388.940 |                   +5.2% |               829.9 |                830.6 |
| planning          |            50.918 |       48.821–52.903 |                   +0.3% |               112.9 |                113.5 |
| prefix            |            54.395 |       53.713–55.116 |                  +35.0% |                96.5 |                 97.9 |
| bmp-encode        |             7.517 |         7.351–9.551 |                   +3.7% |               565.9 |                598.3 |
| bmp-stream        |           157.949 |     153.744–159.479 |                   +1.3% |              1025.6 |               1026.0 |
| download-stream   |            36.727 |       36.637–37.001 |                   +1.2% |               234.9 |                236.0 |
| protocol-page     |            46.876 |       45.912–48.449 |                   +4.6% |               114.2 |                114.7 |
| group-chunks      |             9.859 |        9.658–10.197 |                  +91.2% |               110.3 |                110.7 |
| group-many-files  |            31.611 |       23.227–33.378 |                  +29.4% |               235.7 |                240.2 |
| sort-files        |            18.636 |       18.412–20.417 |                  +56.7% |               107.1 |                107.4 |
| upload-tiny       |             5.162 |         4.882–5.470 |                  +13.0% |               100.4 |                103.1 |
| upload-many       |           307.831 |     302.329–319.546 |                  +25.1% |               338.3 |                342.5 |
| upload-large      |          2695.462 |   2683.032–2709.137 |                   -0.1% |              1291.6 |               1316.8 |
| upload-boundaries |          6676.102 |   6652.034–6706.493 |                   +1.0% |              2601.3 |               2602.5 |
| upload-mixed-1    |          1686.831 |   1682.707–1698.575 |                   +2.9% |               798.6 |                804.3 |
| upload-mixed-4    |          1663.740 |   1642.743–1669.431 |                   +3.1% |               844.9 |                850.9 |
| upload-mixed-8    |          1662.512 |   1651.473–1679.431 |                   +1.4% |               846.8 |                853.6 |
| upload-mixed-32   |          1638.659 |   1628.006–1664.281 |                   +1.7% |               874.8 |                887.1 |
| upload-duplicate  |            57.068 |       56.543–62.706 |                  +10.4% |               218.6 |                220.0 |
| upload-retry      |            87.089 |       85.293–93.134 |                   -0.1% |               230.6 |                232.7 |
| failure-paths     |             7.077 |         6.910–7.481 |                   +8.4% |               144.4 |                145.3 |

The main Node gains are repeatable: many-file upload is 25.1% below baseline, grouping 91.2%, prefix encoding 35.0%, and date sorting 56.7%. Large-file uploads remain effectively unchanged. Native small-file hashing is notably variable (16.4–40.6 ms), so its median is not a guarantee for every run. Single-chunk grouping and full-buffer BMP RSS also vary with normal garbage collection. The previously reported many-file upload memory tradeoff remains; these repetitions do not establish lower end-to-end upload memory.

The browser comparisons use the original and final implementations within each unchanged harness run:

| Browser workload | Original median ms | Final median ms | Reduction | Original run-median range ms | Final run-median range ms | Paired reduction range |
| ---------------- | -----------------: | --------------: | --------: | ---------------------------: | ------------------------: | ---------------------: |
| 200 × 64 KiB     |             422.95 |           96.95 |     77.1% |                  401.1–456.2 |                67.0–136.5 |             68.3–84.3% |
| 500 × 1 KiB      |             309.85 |          215.35 |     30.5% |                  237.7–384.2 |               159.0–322.9 |              5.8–50.3% |

Every paired browser comparison was faster with the final implementation, and every digest/progress validation passed. However, the repeated tiny-file aggregate is **30.5%**, below the earlier single-run **47.0%** estimate, with paired gains ranging from 5.8% to 50.3%. Use the repeated result for expectations; the initial figures above remain recorded evidence, not a guaranteed speedup. Small-file browser hashing repeats at 77.1% lower latency. No live uploads were repeated in this verification phase.

## Commits

Baseline/suite: `45d73b6`, supplementary one-chunk coverage `46f7ef9`.

Accepted optimizations: `cef3c6f` (hasher reuse), `ff06a99` (BMP metadata), `9d01e65` (chunk grouping), `18cebd4` (date sorting), `91c4a58` (bounded native hashing).

Protocol experiment `dcfbcf5` was reverted by `e16a27c`. Additional rejected experiments and retained regression tests are documented in the iteration log and focused commits.
