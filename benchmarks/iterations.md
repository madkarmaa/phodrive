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
