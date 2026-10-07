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
