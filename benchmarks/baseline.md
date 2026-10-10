# Original performance baseline

This baseline was measured on 2026-10-07 against production source `86cba81d19ca4a64c955815da9bac1619615744a`, before production edits. It used Node v24.21.0, Linux 7.2.9-1-cachyos, and a 13th Gen Intel Core i7-13650HX with normal machine settings. Each workload ran in an isolated child process with two warmups and five measured samples. Reproduce it with `bun run perf --output=/absolute/path/baseline.json`; see the [methodology](./README.md).

The baseline excludes the initial pilot. The corrected suite batches tiny and small hashes into 200 operations to reduce timer noise and restores transport progress callbacks. Failure cases omit throughput because aborted operations consume unequal byte counts. These corrections did not change production code.

| Benchmark         | Median ms | Minimum to maximum ms |   MiB/s | Process peak RSS MiB | Sampled external MiB | Sampled heap MiB |
| ----------------- | --------: | --------------------: | ------: | -------------------: | -------------------: | ---------------: |
| hash-tiny         |    13.289 |       6.883 to 15.586 |   14.70 |                113.5 |                154.4 |             33.8 |
| hash-small        |    54.757 |      51.800 to 59.447 |  228.28 |                155.3 |                128.0 |             21.0 |
| hash-medium       |    33.571 |      33.460 to 35.470 |  238.30 |                175.0 |                 83.7 |             17.2 |
| hash-large        |   244.732 |    240.459 to 246.828 |  261.51 |                431.4 |                 81.0 |             16.0 |
| hash-very-large   |  1393.672 |  1382.181 to 1400.497 |  267.59 |               1577.6 |                 72.8 |             14.8 |
| hash-many         |    22.881 |      20.194 to 32.702 |   21.34 |                121.3 |                129.1 |             30.0 |
| identity          |     3.008 |        2.307 to 3.606 |    0.00 |                 94.5 |                  3.3 |             22.6 |
| chunk-hash-small  |    28.557 |      27.827 to 33.325 |   17.10 |                124.8 |                129.2 |             35.2 |
| chunk-hash-large  |   407.385 |    380.058 to 410.324 |  456.49 |                829.6 |                 83.9 |             14.9 |
| planning          |    51.068 |      50.930 to 54.685 |    0.00 |                112.7 |                  2.8 |             30.5 |
| prefix            |    83.729 |      83.038 to 84.018 |    0.00 |                 95.5 |                  3.0 |             23.0 |
| bmp-encode        |     7.806 |       7.744 to 11.209 | 8198.89 |                533.8 |                450.9 |             17.0 |
| bmp-stream        |   160.109 |    153.356 to 160.560 | 1161.50 |               1024.7 |                376.1 |             22.2 |
| download-stream   |    37.169 |      35.877 to 37.357 | 1721.86 |                235.1 |                132.1 |             34.4 |
| protocol-page     |    49.150 |      46.953 to 49.701 |    8.69 |                113.5 |                  3.7 |             31.6 |
| group-chunks      |   112.526 |    110.764 to 119.178 |    0.00 |                149.8 |                  2.8 |             44.4 |
| sort-files        |    43.038 |      42.507 to 43.599 |    0.00 |                112.4 |                  2.8 |             35.5 |
| upload-tiny       |     5.931 |        4.846 to 8.434 |    0.16 |                100.7 |                 10.6 |             26.4 |
| upload-many       |   411.040 |    407.027 to 421.741 |   45.62 |                268.0 |                 74.1 |             61.5 |
| upload-large      |  2694.094 |  2691.020 to 2697.365 |  138.43 |               1291.1 |                750.4 |             27.0 |
| upload-boundaries |  6744.757 |  6717.738 to 6986.096 |  137.86 |               2602.7 |               1492.5 |             30.4 |
| upload-mixed-1    |  1736.520 |  1702.912 to 1739.100 |  128.40 |                802.9 |                386.7 |             31.4 |
| upload-mixed-4    |  1716.280 |  1671.074 to 1797.718 |  129.91 |                845.2 |                410.3 |             29.8 |
| upload-mixed-8    |  1685.675 |  1675.642 to 1797.035 |  132.27 |                847.6 |                418.7 |             36.6 |
| upload-mixed-32   |  1666.250 |  1648.792 to 1679.536 |  133.81 |                862.5 |                450.0 |             40.4 |
| upload-duplicate  |    63.713 |      54.811 to 69.129 |  125.56 |                219.4 |                121.1 |             21.0 |
| upload-retry      |    86.975 |      84.953 to 94.587 |   91.98 |                239.1 |                141.4 |             21.3 |
| failure-paths     |     7.729 |       6.689 to 10.272 |    0.00 |                139.4 |                 51.6 |             24.3 |

## Interpretation and success criteria

The target is at least 20% lower median latency, confirmed beyond sample variability. Keep workloads, integrity checks, chunk layout, hashing algorithms, and operation counts fixed. Compare every iteration with this baseline and the previous accepted implementation. Reject added complexity or substantial memory growth unless measurements justify it.

Browser SHA-256 reads bounded 1 MiB slices and caches hashes by immutable File identity. Google requires SHA-1 of the complete BMP before upload. The server also checks incoming bytes against that SHA-1 before committing. File and chunk hashing account for most browser CPU work on large inputs. Multipart input and BMP output follow demand, with output blocks limited to 64 KiB and no full-upload storage. Two p-limit pools bound active files and chunks. Server aborts cancel provider requests and incoming streams. Browser retries preserve confirmed chunks. The server throttles progress and combines SSE updates when the browser reads slowly. Google authentication, uploads, and downloads depend on network latency; the test transport measures local overhead.

Metadata planning allocates data without reading file contents. In this baseline, prefix generation allocates temporary arrays and encodes names twice. Protobuf parsing copies nested byte fields. Grouping scans and copies growing chunk arrays. Date sorting compares names even when timestamps determine order. These are candidates for measurement, with no optimization gains established yet.

RSS includes startup, fixtures, and warmups. Browser, server, and test-provider code all run in one process. Fixture creation can determine the process peak, especially for boundary datasets. Sampled heap and external memory do not count allocations precisely. These measurements do not establish Google network throughput or separate browser and server memory use. Baseline validation passed `bun run check`, all 169 tests, and `bun run build`.

## Additional common-case coverage

Before accepting chunk-group indexing, the suite added `group-many-files`. It runs ten passes over 10,000 distinct one-chunk files plus 2,500 duplicate confirmations, using the same fixture generator. The original cases stayed unchanged. This additional baseline was measured in a detached worktree at `45d73b6`, with production source still at `86cba81d`. It used the same machine, runtime, two warmups, and five samples.

| Benchmark        | Median ms | Minimum to maximum ms | Process peak RSS MiB |
| ---------------- | --------: | --------------------: | -------------------: |
| group-many-files |    44.756 |      40.103 to 46.340 |                356.9 |
