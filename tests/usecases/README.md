# End-user audit

Audit completed on 2026-10-01 with 24 separate GPT-6 Luna agents using low reasoning. Each case used an isolated checkout and a distinct development port. Verification agents tested and reported; the main agent applied fixes. Chrome checks used the user's existing browser and synthetic accounts with intercepted API responses. Native connection consent was handled by the dedicated GPT-5.6 Sol agent with medium reasoning.

## Coverage

| Case | Port | Scenario and evidence                                                                                                     |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 01   | 5201 | Account validation and editing credentials during authentication; `uc01_accounts.test.ts`                                 |
| 02   | 5202 | Denied browser storage and quota failures; `uc02_storage.test.ts`                                                         |
| 03   | 5203 | Unicode, long, empty, and invalid filenames; `uc03_file_names.test.ts`                                                    |
| 04   | 5204 | Identical content under separate original names, empty files, retries, and legacy headers; `uc04_duplicate_names.test.ts` |
| 05   | 5205 | Mixed batches and duplicate submission; `uc05_mixed_batch.test.ts`                                                        |
| 06   | 5206 | Chunk boundaries, large files, BMP limits, and original hashes; `uc06_large_files.test.ts`                                |
| 07   | 5207 | Interrupted uploads and selective retries; `uc07_network_retry.test.ts`                                                   |
| 08   | 5208 | Slow requests without deadlines, progress, and worker limits; `uc08_slow_network.test.ts`                                 |
| 09   | 5209 | Partial and uncertain remote commits; `uc09_partial_commit.test.ts`                                                       |
| 10   | 5210 | Reload/cancellation, cleanup, and recovery of confirmed chunks; `uc10_reload_upload.test.ts`                              |
| 11   | 5211 | Missing, damaged, shuffled, and invalid download chunks; `uc11_bad_download.test.ts`                                      |
| 12   | 5212 | Empty and large downloads, save failures, and cancellation; `uc12_download_save.test.ts`                                  |
| 13   | 5213 | Partial deletion and account isolation; `uc13_partial_delete.test.ts`                                                     |
| 14   | 5214 | Stale deletion dialogs and changed accounts; `uc14_stale_confirmation.test.ts`                                            |
| 15   | 5215 | Repeated pagination tokens and duplicate entries; `uc15_pagination.test.ts`                                               |
| 16   | 5216 | Stale library responses and refresh recovery; `uc16_refresh_races.test.ts`                                                |
| 17   | 5217 | Search, sorting, filters, and delayed filename discovery; `uc17_search_sort.test.ts`                                      |
| 18   | 5218 | Settings bounds, defaults, persistence failures, and theme; `uc18_settings.test.ts`                                       |
| 19   | 5219 | Cross-tab account changes during an upload; [browser report](uc19_multi_tab.md)                                           |
| 20   | 5220 | Keyboard focus, cancellation, validation, and upload announcements; [browser report](uc20_keyboard.md)                    |
| 21   | 5221 | Narrow touch layouts, 27 accounts, and an eight-job upload panel; [browser report](uc21_mobile.md)                        |
| 22   | 5222 | Malformed multipart, JSON, protobuf, and BMP input; `uc22_malformed_inputs.test.ts`                                       |
| 23   | 5223 | Temporary disk failures and cleanup; `uc23_disk_failure.test.ts`                                                          |
| 24   | 5224 | 80 queued jobs, overlapping actions, and account changes; `uc24_many_jobs.test.ts`                                        |

## Fixes

- Snapshot credentials before asynchronous validation so edits cannot change the identity being saved.
- Give new uploads an identity derived from original filename and content hash. Identical bytes under different names remain separate files; retries of the same name and content retain their identity.
- Limit deletion updates to the matching account and reject stale confirmation targets.
- Deduplicate library entries and reject repeated pagination tokens.
- Reload the newly selected account after an active transfer settles, including changes made in another tab.
- Restore account-menu keyboard focus, focus Cancel in confirmation dialogs, and constrain large account menus to the viewport.

## Verification and limits

Independent verification passed Bun check, test, build, and lint, plus npm check, test, and build. Type checking reported zero errors and warnings. The final suite contains 36 files and 117 tests, including additional identity planning and mismatched-download regressions. The built server returned HTTP 200 from `/` under both Node and Bun; both smoke servers were stopped. All audit servers and browser tabs were closed.

The browser audit used mocked provider traffic, including actual file-input uploads against intercepted API responses. It did not establish fresh Google Photos availability. Earlier prototype verification uploaded the user's `26.2.zip`; this audit did not modify or delete that upload. Browser fixture reloads invalidated a few attempts; those attempts were excluded and stable checks were repeated.

Legacy headers remain readable. Previously collapsed filename aliases cannot be reconstructed from legacy chunks; uploading the original again creates a new filename-aware entry. Older app versions cannot read the new header version. A missing split remains unrecoverable without restoring it or uploading the original file again.

This audit covers the scenarios above and their regression tests. It cannot prove that every conceivable input, browser, network, or provider behavior will succeed.
