# True Performance Baseline

Measured 2026-10-07 against production source `86cba81d19ca4a64c955815da9bac1619615744a`, before any production edits. Runtime v24.21.0; linux 7.2.9-1-cachyos; 13th Gen Intel(R) Core(TM) i7-13650HX. Normal machine settings; sequential isolated child processes; two warmups and five samples per fixed workload. Reproduce with `bun run perf --output=/absolute/path/baseline.json`; see [methodology](./README.md).

The initial pilot was discarded before freezing this baseline: tiny/small hashing was batched into 200 operations to reduce timer noise, transport progress callbacks were restored, and failure throughput was removed because aborted operations consume unequal byte counts. The table below uses only the corrected suite. No production code changed during this correction.

| Benchmark         | Median ms |        Min–max ms |   MiB/s | Process peak RSS MiB | Sampled external MiB | Sampled heap MiB |
| ----------------- | --------: | ----------------: | ------: | -------------------: | -------------------: | ---------------: |
| hash-tiny         |    13.289 |      6.883–15.586 |   14.70 |                113.5 |                154.4 |             33.8 |
| hash-small        |    54.757 |     51.800–59.447 |  228.28 |                155.3 |                128.0 |             21.0 |
| hash-medium       |    33.571 |     33.460–35.470 |  238.30 |                175.0 |                 83.7 |             17.2 |
| hash-large        |   244.732 |   240.459–246.828 |  261.51 |                431.4 |                 81.0 |             16.0 |
| hash-very-large   |  1393.672 | 1382.181–1400.497 |  267.59 |               1577.6 |                 72.8 |             14.8 |
| hash-many         |    22.881 |     20.194–32.702 |   21.34 |                121.3 |                129.1 |             30.0 |
| identity          |     3.008 |       2.307–3.606 |    0.00 |                 94.5 |                  3.3 |             22.6 |
| chunk-hash-small  |    28.557 |     27.827–33.325 |   17.10 |                124.8 |                129.2 |             35.2 |
| chunk-hash-large  |   407.385 |   380.058–410.324 |  456.49 |                829.6 |                 83.9 |             14.9 |
| planning          |    51.068 |     50.930–54.685 |    0.00 |                112.7 |                  2.8 |             30.5 |
| prefix            |    83.729 |     83.038–84.018 |    0.00 |                 95.5 |                  3.0 |             23.0 |
| bmp-encode        |     7.806 |      7.744–11.209 | 8198.89 |                533.8 |                450.9 |             17.0 |
| bmp-stream        |   160.109 |   153.356–160.560 | 1161.50 |               1024.7 |                376.1 |             22.2 |
| download-stream   |    37.169 |     35.877–37.357 | 1721.86 |                235.1 |                132.1 |             34.4 |
| protocol-page     |    49.150 |     46.953–49.701 |    8.69 |                113.5 |                  3.7 |             31.6 |
| group-chunks      |   112.526 |   110.764–119.178 |    0.00 |                149.8 |                  2.8 |             44.4 |
| sort-files        |    43.038 |     42.507–43.599 |    0.00 |                112.4 |                  2.8 |             35.5 |
| upload-tiny       |     5.931 |       4.846–8.434 |    0.16 |                100.7 |                 10.6 |             26.4 |
| upload-many       |   411.040 |   407.027–421.741 |   45.62 |                268.0 |                 74.1 |             61.5 |
| upload-large      |  2694.094 | 2691.020–2697.365 |  138.43 |               1291.1 |                750.4 |             27.0 |
| upload-boundaries |  6744.757 | 6717.738–6986.096 |  137.86 |               2602.7 |               1492.5 |             30.4 |
| upload-mixed-1    |  1736.520 | 1702.912–1739.100 |  128.40 |                802.9 |                386.7 |             31.4 |
| upload-mixed-4    |  1716.280 | 1671.074–1797.718 |  129.91 |                845.2 |                410.3 |             29.8 |
| upload-mixed-8    |  1685.675 | 1675.642–1797.035 |  132.27 |                847.6 |                418.7 |             36.6 |
| upload-mixed-32   |  1666.250 | 1648.792–1679.536 |  133.81 |                862.5 |                450.0 |             40.4 |
| upload-duplicate  |    63.713 |     54.811–69.129 |  125.56 |                219.4 |                121.1 |             21.0 |
| upload-retry      |    86.975 |     84.953–94.587 |   91.98 |                239.1 |                141.4 |             21.3 |
| failure-paths     |     7.729 |      6.689–10.272 |    0.00 |                139.4 |                 51.6 |             24.3 |

## Interpretation and success criteria

Target at least 20% lower median latency in categories with credible local opportunities, confirmed beyond sample variability. Keep workload, integrity validation, chunk layout, hashing algorithms, and operation counts fixed. Report smaller improvements conservatively and reject complexity or significant memory growth without a justified benefit. Compare every iteration to this table and its immediate predecessor.

Browser SHA-256 reads bounded 1 MiB slices and caches only immutable File identity. SHA-1 covers the complete BMP and is required before starting Google uploads. Server SHA-1 verifies untrusted incoming bytes before commit; it is not redundant validation. Full-file and chunk hashing dominate the byte-heavy browser path. Multipart ingestion and BMP output are demand-driven, limited to 64 KiB outgoing blocks; the server does not spool full uploads. Google auth, hash lookup, start, transfer, commit and remote downloads are I/O-bound in deployment; deterministic transport isolates local overhead here. Two p-limit pools bound active files and global chunks. Server aborts cancel provider requests and incoming streams; browser retries explicitly preserve confirmed chunks. Progress is throttled and server SSE coalesces updates under backpressure.

Metadata planning is CPU/allocation-bound without reading file contents. Prefix generation allocates temporary arrays and encodes names twice. Protobuf parsing repeatedly copies nested byte fields. Grouping scans and copies growing per-file chunk arrays. Date sorting computes a locale comparison even when timestamps decide the result. These are measured candidate opportunities, not yet optimization claims.

RSS includes startup, fixtures and warmups, and all browser/server/fake-provider work runs in one process. Fixture creation can dominate the OS lifetime peak, particularly boundary datasets. Sampled heap/external memory is not a precise allocation counter. This baseline makes no claim about Google network throughput or standalone browser/server memory. Baseline correctness: `bun run check`, all 169 tests, and `bun run build` passed.

## Additional common-case coverage

Before accepting chunk-group indexing, `group-many-files` was added to test ten passes over 10,000 distinct one-chunk files plus 2,500 duplicate confirmations. It uses the same grouping fixture generator and does not change any original case. Its baseline was measured in a detached worktree at `45d73b6` (production still exactly `86cba81d`), with the same two warmups/five samples and machine/runtime. This is additional original-source coverage, not a replacement baseline.

| Benchmark        | Median ms |    Min–max ms | Process peak RSS MiB |
| ---------------- | --------: | ------------: | -------------------: |
| group-many-files |    44.756 | 40.103–46.340 |                356.9 |
