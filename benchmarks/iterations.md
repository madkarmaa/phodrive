# Performance iterations

All comparisons use the immutable [original performance baseline](./baseline.md) and unchanged benchmark workloads. Improvement is the reduction in median elapsed time, calculated as `(baseline - current) / baseline`. RSS includes fixtures. Sample ranges and repeated runs guide decisions. Benchmarks run sequentially after correctness checks.

## Iteration 1: Reuse bounded, exclusively owned hash states

The hypothesis was to avoid creating a new WebAssembly instance for every file and chunk while resetting each state before reuse.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous |  Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| ---------------- | -------: | -------: | -------: | ---------------------------------: | -------------------------------: |
| hash-tiny        |   13.289 |   13.289 |    3.293 |                    +75.2% / +75.2% |                    113.5 to 95.5 |
| hash-small       |   54.757 |   54.757 |   48.794 |                    +10.9% / +10.9% |                   155.3 to 157.2 |
| hash-many        |   22.881 |   22.881 |    8.370 |                    +63.4% / +63.4% |                   121.3 to 101.0 |
| chunk-hash-small |   28.557 |   28.557 |   11.424 |                    +60.0% / +60.0% |                    124.8 to 98.3 |
| hash-large       |  244.732 |  244.732 |  243.279 |                      +0.6% / +0.6% |                   431.4 to 432.6 |
| chunk-hash-large |  407.385 |  407.385 |  388.936 |                      +4.5% / +4.5% |                   829.6 to 829.9 |
| upload-many      |  411.040 |  411.040 |  369.556 |                    +10.1% / +10.1% |                   268.0 to 335.4 |
| upload-mixed-8   | 1685.675 | 1685.675 | 1672.018 |                      +0.8% / +0.8% |                   847.6 to 842.5 |

Repeated small hashes confirmed 63.4% and 59.7% lower latency. Their sampled external memory fell from about 129 MiB to 4 MiB and 3.5 MiB, and RSS fell about 17% to 21%. A repeated upload-many run took 381.71 ms with 303.1 MiB RSS. The initial run took 369.56 ms with 335.4 MiB RSS, against a baseline of 268.0 MiB. Fewer WASM allocations change garbage collection timing. Upload heap peaks vary, and these results do not establish lower end-to-end RSS. Keep the lower hashing latency and bounded pool of idle states. Reassess upload memory in the final run. Large-file hashing times fall within measurement noise.

Validation passed `check`, 170 tests, `build`, and `perf:check`. A new regression test covers concurrent hashing and failed reads.

Keep this change.

## Iteration 2: Write BMP metadata directly into its destination

The hypothesis was to remove temporary hash/varint arrays and duplicate UTF8 encoding without changing validation, layout or padding.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | -------------------------------: |
| prefix           |   83.729 |   83.729 |  53.609 |                    +36.0% / +36.0% |                     95.5 to 96.6 |
| planning         |   51.068 |   51.068 |  50.306 |                      +1.5% / +1.5% |                   112.7 to 112.6 |
| chunk-hash-small |   28.557 |   11.424 |  10.386 |                     +63.6% / +9.1% |                     98.3 to 98.9 |
| bmp-encode       |    7.806 |    7.806 |   7.671 |                      +1.7% / +1.7% |                   533.8 to 597.4 |
| upload-many      |  411.040 |  369.556 | 375.908 |                      +8.5% / -1.7% |                   335.4 to 314.2 |

Prefix latency improves 36.0%; RSS is flat. Planning and full BMP encoding are unchanged within noise. Full-buffer BMP fixture RSS varies by one 64 MiB allocation due to GC (533.8 to 597.4 MiB); no full-buffer production allocation was added. Upload-many 375.91 ms is within iteration1 repeat variability (369.56 to 381.71 ms); RSS 314.2 MiB lies between its prior repeat values. Varint uses its documented destination-buffer API.

Validation passed `check`, 171 tests, `build`, and `perf:check`. The Unicode and chunk-index-128 fixtures matched the protocol bytes recorded before the change.

Keep this change.

## Iteration 3: Borrow immutable protobuf response byte fields

The hypothesis was to avoid copying each nested field while preserving complete bounds, wire-format and duplicate-field checks.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | -------------------------------: |
| protocol-page    |   49.150 |   49.150 |  42.230 |                    +14.1% / +14.1% |                   113.5 to 114.5 |
| upload-many      |  411.040 |  375.908 | 384.427 |                      +6.5% / -2.3% |                   314.2 to 334.4 |
| upload-duplicate |   63.713 |   63.713 |  58.108 |                      +8.8% / +8.8% |                   219.4 to 220.0 |
| upload-retry     |   86.975 |   86.975 |  88.378 |                      -1.6% / -1.6% |                   239.1 to 231.0 |

Library parsing improves 14.1%, below the 20% target but material for a one-line allocation reduction. Process RSS is unchanged; payload copies are removed by construction, not an allocation-count measurement. Upload metrics are within prior variation and are not attributed to this change. Parsed field views are internal and their production consumers do not mutate response buffers.

Validation passed `check`, 172 tests, `build`, and `perf:check`. Tests cover nonzero buffer offsets, malformed sibling fields, and duplicate fields.

Keep this change.

## Iteration 4a: Index every file group eagerly

The hypothesis was to replace quadratic chunk scans and array copies with per-file maps.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | -------------------------------: |
| group-chunks     |  112.526 |  112.526 |  10.430 |                    +90.7% / +90.7% |                   149.8 to 111.0 |
| sort-files       |   43.038 |   43.038 |  45.166 |                      -4.9% / -4.9% |                   112.4 to 114.5 |
| group-many-files |   44.756 |   44.756 |  52.174 |                    -16.6% / -16.6% |                   356.9 to 374.4 |

Large groups improve 90.7% and RSS drops 149.8 to 111.0 MiB. However many one-chunk groups regress 16.6% (44.76 to 52.17 ms) and RSS rises 356.9 to 374.4 MiB. Do not accept this form; allocate an index only when a group actually has multiple chunk positions.

Validation passed `check`, 173 tests, `build`, and `perf:check`.

Reject this change.

## Iteration 4b: Create chunk indexes only for split files

The hypothesis was to keep one owned chunk array, update duplicate positions in place and create a position Map only when a second distinct chunk arrives.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | -------------------------------: |
| group-chunks     |  112.526 |  112.526 |   9.911 |                    +91.2% / +91.2% |                   149.8 to 110.3 |
| group-many-files |   44.756 |   44.756 |  27.889 |                    +37.7% / +37.7% |                   356.9 to 164.0 |

Both classes improve: large groups 91.2%, many one-chunk files 37.7%. RSS falls 149.8 to 110.3 MiB and 356.9 to 164.0 MiB respectively. Compared with rejected eager indexes, elapsed time drops 5.0% and 46.5%; no common-case regression remains. Previous column means last accepted version (original grouping), not the rejected attempt.

Validation passed `check`, 173 tests, `build`, and `perf:check`. Tests preserved duplicate timestamp ties, names, order, completeness checks, and input immutability.

Keep this change.

## Iteration 5: Compare names only when date sorting needs a tie-breaker

The hypothesis was to avoid locale-aware collation on every comparison when timestamps already establish ordering.

Benchmark results (milliseconds per unchanged workload):

| Benchmark  | Baseline | Previous | Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| ---------- | -------: | -------: | ------: | ---------------------------------: | -------------------------------: |
| sort-files |   43.038 |   43.038 |  18.409 |                    +57.2% / +57.2% |                   112.4 to 107.0 |

Sorting drops 57.2% against baseline and 59.2% against the immediately preceding 45.17 ms measurement. RSS falls from 114.5 to 107.0 MiB; avoid attributing all process-memory variation to this small comparator change.

Validation passed `check`, 173 tests, `build`, and `perf:check`. Existing tests cover Unicode, case, timestamp ties, and immutable sorting.

Keep this change.

## Iteration 6: Fuse UTF8 decoding and SSE parsing into one stream stage

The hypothesis was to remove one TransformStream and its scheduling/queue overhead while preserving the same parser and validation.

Benchmark results (milliseconds per unchanged workload):

| Benchmark      | Baseline | Previous |  Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| -------------- | -------: | -------: | -------: | ---------------------------------: | -------------------------------: |
| upload-tiny    |    5.931 |    5.931 |    5.222 |                    +11.9% / +11.9% |                   100.7 to 100.2 |
| upload-many    |  411.040 |  384.427 |  367.095 |                     +10.7% / +4.5% |                   334.4 to 301.7 |
| upload-mixed-8 | 1685.675 | 1672.018 | 1657.798 |                      +1.7% / +0.9% |                   842.5 to 845.3 |
| upload-retry   |   86.975 |   88.378 |   92.031 |                      -5.8% / -4.1% |                   231.0 to 229.8 |

An interleaved control restored the previous implementation: upload-many 368.74 ms / 304.1 MiB RSS, candidate repeat 360.78 ms / 304.8 MiB. The 2.2% benefit is too small relative to run variability to justify maintaining a custom stream wrapper. The initial comparison against 384.43 ms overstated the gain. Earlier changes account for the improvement against baseline. Tiny workload control 5.34 vs 4.95 ms is small in absolute terms. Reverted production change.

The candidate passed `check`, 174 tests, `build`, and `perf:check`. The regression test for byte-fragmented UTF-8, BOM, CRLF, and cancellation remains.

Reject this change.

## Iteration 7: Overlap one upcoming bounded read with hashing

The hypothesis was to start at most one future 1 MiB Blob read while updating SHA state on the current block.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous |  Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| ---------------- | -------: | -------: | -------: | ---------------------------------: | -------------------------------: |
| hash-large       |  244.732 |  243.279 |  247.911 |                      -1.3% / -1.9% |                   432.6 to 432.4 |
| chunk-hash-large |  407.385 |  388.936 |  393.164 |                      +3.5% / -1.1% |                   829.9 to 829.1 |
| upload-large     | 2694.094 | 2694.094 | 2711.967 |                      -0.7% / -0.7% |                 1291.1 to 1294.0 |
| upload-mixed-32  | 1666.250 | 1666.250 | 1671.845 |                      -0.3% / -0.3% |                   862.5 to 886.2 |

Times increased. Hashing 64 MiB took 247.91 ms against the previous 243.28 ms. A full chunk took 393.16 ms against 388.94 ms. Large uploads took 2711.97 ms against the baseline of 2694.09 ms. 32-worker mixed RSS rises 862.5 to 886.2 MiB and each active hasher can hold one additional 1 MiB block. Reject the extra buffering and restore sequential bounded reads.

Validation passed `check`, 174 tests, `build`, and `perf:check`. Tests confirmed read-error propagation and bounded slices.

Reject this change.

## Iteration 8: Use native SHA-256 for bounded files

The hypothesis was that native WebCrypto could reduce CPU work and overlap independent small-file hashes. Limit it to 32 KiB to 1 MiB; larger files retain incremental bounded reads, tiny files avoid native call overhead, and unavailable or rejected crypto falls back.

AC benchmark results (milliseconds per unchanged workload):

| Benchmark   | Baseline | Previous control | Candidate | Candidate repeat | Improvement vs baseline / previous control |
| ----------- | -------: | ---------------: | --------: | ---------------: | -----------------------------------------: |
| upload-many |  411.040 |          372.370 |   310.580 |          316.800 |                            +22.9% / +14.9% |

Percentages use the candidate repeat. The final AC runs and ten-run verification independently confirm the cumulative upload improvement; see [results.md](./results.md).

Native reads remain capped at the existing 1 MiB bound. The final AC measurements document the upload RSS tradeoff; no end-to-end memory reduction is claimed.

Validation passed `check`, 176 tests, and `build`. Tests cover native digest equivalence, caching, progress, fallback, and read failures without retries.

Keep this change.

## Iteration 9: Avoid filtered arrays during required protobuf field lookup

This change used a single scan to validate duplicate and missing fields without a temporary array.

No AC comparison is recorded for this candidate. No performance or memory conclusion is included.

Validation passed `check`, all 176 tests, `build`, and `perf:check`.

Reject this change. The original implementation was restored.

## Iteration 10: Forward complete bounded stream blocks without additional views

This change forwarded pieces of at most 64 KiB directly, without creating another view.

No AC comparison is recorded for this candidate. No performance or memory conclusion is included.

Validation passed `check`, all 176 tests, `build`, and `perf:check`. Tests confirmed bounded output, integrity checks, and cancellation.

Reject this change. The original implementation was restored.

## Iteration 11: Restore copied protobuf byte fields

This change restored the original protobuf parser and retained tests for offsets, malformed sibling fields, and duplicates.

The restored parser's ten-run median is 46.876 ms against the original 49.150 ms baseline. The parser implementation is identical to the original; no protocol optimization or memory improvement is claimed.

The restored source passed `check` with no errors or warnings, all 176 tests, `build`, and `perf:check`. All 29 final benchmark workloads passed.

Revert iteration 3. This replaces the initial decision to keep it. The final results exclude its initial apparent gain.

## Iteration 12: Share empty filename bytes and text encoder during metadata planning

The hypothesis was to avoid a zero-length typed array for each unnamed later chunk and reuse the stateless encoder.

Benchmark results (milliseconds per unchanged workload):

| Benchmark | Baseline | Previous | Current | Improvement vs baseline / previous | Previous to current peak RSS MiB |
| --------- | -------: | -------: | ------: | ---------------------------------: | -------------------------------: |
| planning  |   51.068 |   50.306 |  48.931 |                      +4.2% / +2.7% |                   112.6 to 113.4 |
| prefix    |   83.729 |   53.609 |  53.813 |                     +35.7% / -0.4% |                     96.6 to 97.0 |

On AC power, planning initially took 48.93 ms against 53.93 ms in the preceding suite. An adjacent control took 50.93 ms, and a repeated candidate run took 49.14 ms, only 3.5% faster. The original baseline was 51.068 ms. The prefix control took 55.19 ms and the repeat took 53.52 ms, close to the previously accepted 53.48 ms. Planning RSS stayed similar at 113.2 MiB for the control and 113.4 MiB for the candidate. This planning stress case processes twenty 500 GB files; the absolute saving per realistic file is negligible and does not explain a meaningful end-to-end bottleneck. Restore the previous implementation. These measurements do not justify further allocation changes.

Validation passed `check`, 176 tests, `build`, and `perf:check`. Unicode fixtures matched the original bytes.

Reject this change.
