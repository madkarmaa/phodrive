# Performance iterations

All comparisons use the immutable [True Performance Baseline](./baseline.md) and unchanged benchmark workloads. Improvement means reduced median elapsed time: `(baseline - current) / baseline`. Whole-process RSS includes fixtures; sample ranges and repeat runs guide decisions. Benchmarks run serially, after correctness checks.

## Iteration 1: Reuse bounded, exclusively owned hash states

Change: Reuse bounded, exclusively owned hash states.

Hypothesis: Avoid creating a new WebAssembly instance for every file and chunk while resetting each state before reuse.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous |  Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| ---------------- | -------: | -------: | -------: | ---------------------------------: | ------------------------------: |
| hash-tiny        |   13.289 |   13.289 |    3.293 |                    +75.2% / +75.2% |                    113.5 → 95.5 |
| hash-small       |   54.757 |   54.757 |   48.794 |                    +10.9% / +10.9% |                   155.3 → 157.2 |
| hash-many        |   22.881 |   22.881 |    8.370 |                    +63.4% / +63.4% |                   121.3 → 101.0 |
| chunk-hash-small |   28.557 |   28.557 |   11.424 |                    +60.0% / +60.0% |                    124.8 → 98.3 |
| hash-large       |  244.732 |  244.732 |  243.279 |                      +0.6% / +0.6% |                   431.4 → 432.6 |
| chunk-hash-large |  407.385 |  407.385 |  388.936 |                      +4.5% / +4.5% |                   829.6 → 829.9 |
| upload-many      |  411.040 |  411.040 |  369.556 |                    +10.1% / +10.1% |                   268.0 → 335.4 |
| upload-mixed-8   | 1685.675 | 1685.675 | 1672.018 |                      +0.8% / +0.8% |                   847.6 → 842.5 |

Memory impact and interpretation: Repeated small hashes confirmed 63.4% and 59.7% lower latency. Their sampled external memory fell from about 129 MiB to 4 MiB and 3.5 MiB, and RSS fell about 17–21%. Upload-many repeat: 381.71 ms, RSS 303.1 MiB (initial 369.56 ms, 335.4 MiB); baseline RSS 268.0 MiB. Less WASM allocation changes GC timing: upload heap peaks vary and this does not establish lower end-to-end RSS. Retain for substantial hashing benefit with bounded idle state retention; reassess upload memory in final run. Large hash changes are noise, not claimed gains.

Correctness: check, 170 tests, build and perf:check pass; new concurrency and failed-read regression test.

Decision: **KEEP**.

## Iteration 2: Write BMP metadata directly into its destination

Change: Write BMP metadata directly into its destination.

Hypothesis: Remove temporary hash/varint arrays and duplicate UTF8 encoding without changing validation, layout or padding.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | ------------------------------: |
| prefix           |   83.729 |   83.729 |  53.609 |                    +36.0% / +36.0% |                     95.5 → 96.6 |
| planning         |   51.068 |   51.068 |  50.306 |                      +1.5% / +1.5% |                   112.7 → 112.6 |
| chunk-hash-small |   28.557 |   11.424 |  10.386 |                     +63.6% / +9.1% |                     98.3 → 98.9 |
| bmp-encode       |    7.806 |    7.806 |   7.671 |                      +1.7% / +1.7% |                   533.8 → 597.4 |
| upload-many      |  411.040 |  369.556 | 375.908 |                      +8.5% / -1.7% |                   335.4 → 314.2 |

Memory impact and interpretation: Prefix latency improves 36.0%; RSS is flat. Planning and full BMP encoding are unchanged within noise. Full-buffer BMP fixture RSS varies by one 64 MiB allocation due to GC (533.8 to 597.4 MiB); no full-buffer production allocation was added. Upload-many 375.91 ms is within iteration1 repeat variability (369.56–381.71 ms); RSS 314.2 MiB lies between its prior repeat values. Varint uses its documented destination-buffer API.

Correctness: check, 171 tests, build and perf:check pass; fixed pre-change Unicode/index128 protocol golden bytes pass.

Decision: **KEEP**.

## Iteration 3: Borrow immutable protobuf response byte fields

Change: Borrow immutable protobuf response byte fields.

Hypothesis: Avoid copying each nested field while preserving complete bounds, wire-format and duplicate-field checks.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | ------------------------------: |
| protocol-page    |   49.150 |   49.150 |  42.230 |                    +14.1% / +14.1% |                   113.5 → 114.5 |
| upload-many      |  411.040 |  375.908 | 384.427 |                      +6.5% / -2.3% |                   314.2 → 334.4 |
| upload-duplicate |   63.713 |   63.713 |  58.108 |                      +8.8% / +8.8% |                   219.4 → 220.0 |
| upload-retry     |   86.975 |   86.975 |  88.378 |                      -1.6% / -1.6% |                   239.1 → 231.0 |

Memory impact and interpretation: Library parsing improves 14.1%, below the 20% target but material for a one-line allocation reduction. Process RSS is unchanged; payload copies are removed by construction, not an allocation-count measurement. Upload metrics are within prior variation and are not attributed to this change. Parsed field views are internal and their production consumers do not mutate response buffers.

Correctness: check, 172 tests, build and perf:check pass; nonzero backing offsets, malformed siblings and duplicate-field checks covered.

Decision: **KEEP**.

## Iteration 4a: Index every file group eagerly

Change: Index every file group eagerly.

Hypothesis: Replace quadratic chunk scans and array copies with per-file maps.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | ------------------------------: |
| group-chunks     |  112.526 |  112.526 |  10.430 |                    +90.7% / +90.7% |                   149.8 → 111.0 |
| sort-files       |   43.038 |   43.038 |  45.166 |                      -4.9% / -4.9% |                   112.4 → 114.5 |
| group-many-files |   44.756 |   44.756 |  52.174 |                    -16.6% / -16.6% |                   356.9 → 374.4 |

Memory impact and interpretation: Large groups improve 90.7% and RSS drops 149.8 to 111.0 MiB. However many one-chunk groups regress 16.6% (44.76 to 52.17 ms) and RSS rises 356.9 to 374.4 MiB. Do not accept this form; allocate an index only when a group actually has multiple chunk positions.

Correctness: check, 173 tests, build and perf:check pass.

Decision: **REJECT**.

## Iteration 4b: Create chunk indexes only for split files

Change: Create chunk indexes only for split files.

Hypothesis: Keep one owned chunk array, update duplicate positions in place and create a position Map only when a second distinct chunk arrives.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous | Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| ---------------- | -------: | -------: | ------: | ---------------------------------: | ------------------------------: |
| group-chunks     |  112.526 |  112.526 |   9.911 |                    +91.2% / +91.2% |                   149.8 → 110.3 |
| group-many-files |   44.756 |   44.756 |  27.889 |                    +37.7% / +37.7% |                   356.9 → 164.0 |

Memory impact and interpretation: Both classes improve: large groups 91.2%, many one-chunk files 37.7%. RSS falls 149.8 to 110.3 MiB and 356.9 to 164.0 MiB respectively. Compared with rejected eager indexes, elapsed time drops 5.0% and 46.5%; no common-case regression remains. Previous column means last accepted version (original grouping), not the rejected attempt.

Correctness: check, 173 tests, build and perf:check pass; duplicate timestamp ties, naming, ordering, completeness and input immutability preserved.

Decision: **KEEP**.

## Iteration 5: Compare names only when date sorting needs a tie-breaker

Change: Compare names only when date sorting needs a tie-breaker.

Hypothesis: Avoid locale-aware collation on every comparison when timestamps already establish ordering.

Benchmark results (milliseconds per unchanged workload):

| Benchmark  | Baseline | Previous | Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| ---------- | -------: | -------: | ------: | ---------------------------------: | ------------------------------: |
| sort-files |   43.038 |   43.038 |  18.409 |                    +57.2% / +57.2% |                   112.4 → 107.0 |

Memory impact and interpretation: Sorting drops 57.2% against baseline and 59.2% against the immediately preceding 45.17 ms measurement. RSS falls from 114.5 to 107.0 MiB; avoid attributing all process-memory variation to this small comparator change.

Correctness: check, 173 tests, build and perf:check pass; existing Unicode, case, date-tie and immutable sorting coverage retained.

Decision: **KEEP**.

## Iteration 6: Fuse UTF8 decoding and SSE parsing into one stream stage

Change: Fuse UTF8 decoding and SSE parsing into one stream stage.

Hypothesis: Remove one TransformStream and its scheduling/queue overhead while preserving the same parser and validation.

Benchmark results (milliseconds per unchanged workload):

| Benchmark      | Baseline | Previous |  Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| -------------- | -------: | -------: | -------: | ---------------------------------: | ------------------------------: |
| upload-tiny    |    5.931 |    5.931 |    5.222 |                    +11.9% / +11.9% |                   100.7 → 100.2 |
| upload-many    |  411.040 |  384.427 |  367.095 |                     +10.7% / +4.5% |                   334.4 → 301.7 |
| upload-mixed-8 | 1685.675 | 1672.018 | 1657.798 |                      +1.7% / +0.9% |                   842.5 → 845.3 |
| upload-retry   |   86.975 |   88.378 |   92.031 |                      -5.8% / -4.1% |                   231.0 → 229.8 |

Memory impact and interpretation: An interleaved control restored the previous implementation: upload-many 368.74 ms / 304.1 MiB RSS, candidate repeat 360.78 ms / 304.8 MiB. The 2.2% benefit is too small relative to run variability to justify maintaining a custom stream wrapper. Initial apparent improvement over 384.43 ms was mostly noise; full baseline improvement belonged to earlier changes. Tiny workload control 5.34 vs 4.95 ms is small in absolute terms. Reverted production change.

Correctness: candidate passed check, 174 tests, build and perf:check; byte-fragmented UTF8/BOM/CRLF and cancellation regression retained.

Decision: **REJECT**.

## Iteration 7: Overlap one upcoming bounded read with hashing

Change: Overlap one upcoming bounded read with hashing.

Hypothesis: Start at most one future 1 MiB Blob read while updating SHA state on the current block.

Benchmark results (milliseconds per unchanged workload):

| Benchmark        | Baseline | Previous |  Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| ---------------- | -------: | -------: | -------: | ---------------------------------: | ------------------------------: |
| hash-large       |  244.732 |  243.279 |  247.911 |                      -1.3% / -1.9% |                   432.6 → 432.4 |
| chunk-hash-large |  407.385 |  388.936 |  393.164 |                      +3.5% / -1.1% |                   829.9 → 829.1 |
| upload-large     | 2694.094 | 2694.094 | 2711.967 |                      -0.7% / -0.7% |                 1291.1 → 1294.0 |
| upload-mixed-32  | 1666.250 | 1666.250 | 1671.845 |                      -0.3% / -0.3% |                   862.5 → 886.2 |

Memory impact and interpretation: No real speed improvement: 64 MiB hashing 247.91 vs previous 243.28 ms, full chunk 393.16 vs 388.94 ms, large upload 2711.97 vs baseline 2694.09 ms. 32-worker mixed RSS rises 862.5→886.2 MiB and each active hasher can hold one additional 1 MiB block. Reject extra buffering/complexity; restore serial bounded reads.

Correctness: check, 174 tests, build and perf:check pass; failed-read propagation and per-slice bound preserved.

Decision: **REJECT**.

## Iteration 8: Use native SHA-256 for bounded files

Change: Use native SHA-256 for bounded files.

Hypothesis: Native WebCrypto can reduce CPU work and overlap independent small-file hashing. Limit it to 32 KiB–1 MiB; larger files retain incremental bounded reads, tiny files avoid native call overhead, and unavailable or rejected crypto falls back.

AC benchmark results (milliseconds per unchanged workload):

| Benchmark   | Baseline | Previous control | Candidate | Candidate repeat | Improvement vs baseline / previous control |
| ----------- | -------: | ---------------: | --------: | ---------------: | -----------------------------------------: |
| upload-many |  411.040 |          372.370 |   310.580 |          316.800 |                            +22.9% / +14.9% |

Interpretation: Percentages use the candidate repeat. The final AC runs and ten-run verification independently confirm the cumulative upload improvement; see [results.md](./results.md).

Memory impact: Native reads remain capped at the existing 1 MiB bound. The final AC measurements document the upload RSS tradeoff; no end-to-end memory reduction is claimed.

Correctness: check, 176 tests and build passed; native digest equivalence, cache/progress, fallback and single-attempt read failure covered.

Decision: **KEEP**.

## Iteration 9: Avoid filtered arrays during required protobuf field lookup

Change: Use a single scan to preserve duplicate and missing-field validation without a temporary array.

Benchmark evidence: No AC comparison is recorded for this candidate. No performance or memory conclusion is included.

Correctness: check, all 176 tests, build and perf:check passed.

Decision: **REJECT**. The original implementation was restored.

## Iteration 10: Forward complete bounded stream blocks without additional views

Change: Forward pieces already at most 64 KiB directly, preserving bounded output.

Benchmark evidence: No AC comparison is recorded for this candidate. No performance or memory conclusion is included.

Correctness: check, all 176 tests, build and perf:check passed; bounded output and integrity/cancellation paths preserved.

Decision: **REJECT**. The original implementation was restored.

## Iteration 11: Restore copied protobuf byte fields

Change: Restore the original protobuf parser; retain offset, malformed-sibling and duplicate regression tests.

AC verification: The restored parser's ten-run median is 46.876 ms against the original 49.150 ms baseline. The parser implementation is identical to the original; no protocol optimization or memory improvement is claimed.

Correctness: restored source passed check (0 errors/warnings), all 176 tests, build and perf:check; all 29 final benchmark workloads passed.

Decision: **REVERT iteration 3**. This supersedes its initial KEEP decision; do not include the initial apparent gain in final optimization claims.

## Iteration 12: Share empty filename bytes and text encoder during metadata planning

Change: Share empty filename bytes and text encoder during metadata planning.

Hypothesis: Avoid a zero-length typed array for each unnamed later chunk and reuse the stateless encoder.

Benchmark results (milliseconds per unchanged workload):

| Benchmark | Baseline | Previous | Current | Improvement vs baseline / previous | Peak RSS previous → current MiB |
| --------- | -------: | -------: | ------: | ---------------------------------: | ------------------------------: |
| planning  |   51.068 |   50.306 |  48.931 |                      +4.2% / +2.7% |                   112.6 → 113.4 |
| prefix    |   83.729 |   53.609 |  53.813 |                     +35.7% / -0.4% |                     96.6 → 97.0 |

Memory impact and interpretation: On AC, initial planning 48.93 ms versus full preceding suite 53.93 ms looked promising. Adjacent control was 50.93 ms and candidate repeat 49.14 ms: only 3.5% lower latency (original baseline 51.068 ms). Prefix control 55.19 ms versus repeat 53.52 ms overlaps prior accepted 53.48 ms. RSS unchanged (planning control 113.2 versus candidate 113.4 MiB). This planning stress case processes twenty 500 GB files; the absolute saving per realistic file is negligible and does not explain a meaningful end-to-end bottleneck. Restore the already-validated implementation; no further allocation changes are justified by these measurements.

Correctness: check, 176 tests, build and perf:check all passed; Unicode golden bytes unchanged.

Decision: **REJECT**.
