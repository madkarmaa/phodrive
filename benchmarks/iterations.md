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

Memory impact and interpretation: An interleaved control restored the previous implementation: upload-many 368.74 ms / 304.1 MiB RSS, candidate repeat 360.78 ms / 304.8 MiB. The 2.2% benefit is too small relative to run variability to justify maintaining a custom stream wrapper. Initial apparent improvement over 384.43 ms was mostly noise; full baseline improvement belonged to earlier changes. Tiny workload control5.34 vs4.95 ms is small in absolute terms. Reverted production change.

Correctness: candidate passed check, 174 tests, build and perf:check; byte-fragmented UTF8/BOM/CRLF and cancellation regression retained.

Decision: **REJECT**.
