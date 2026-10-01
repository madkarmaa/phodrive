# UC19 multi-tab account switch during upload

## Setup

- Isolated app: `http://127.0.0.1:5219/` from `/tmp/phodrive-usecase-audit-20261001/uc19_multi_tab`.
- Browser actions used explicit page IDs 4 and 5 through Chrome MCP.
- No Google requests or credentials were used. A synthetic initialization script injects two synthetic `.test` accounts and mocks `/api/library` and `/api/upload` in each page before app scripts run.
- The upload response emits queued/progress events and stays open until `window.__phodriveReleaseUpload()` is called. Library responses contain distinct marker files for old and new synthetic accounts.
- The actual file input upload was invoked through Chrome MCP `upload_file`; programmatically dispatching a `change` event did not invoke Svelte's handler.

## Observations

1. Page 4 loaded with `old@example.test` selected and showed `old-account-only.bmp`.
2. A 12-byte synthetic upload started. The page showed `Uploading 1 item`, `Uploading 0%`, and `synthetic-upload.bin`; the library marker remained `old-account-only.bmp`.
3. Page 5, a separate same-origin tab, removed the old account from `localStorage.accounts` and set `selectedAccount` to `new@example.test`. The native browser storage event updated page 4's selected account to `new@example.test` while the upload remained active.
4. While the upload was held, page 4 still showed the old library marker and active upload. The mocked library request log remained exactly `[{ email: "old@example.test", pageToken: "" }]`.
5. Releasing the upload settled it. Page 4 showed the new selected account, but still displayed `old-account-only.bmp`. The upload panel closed and the request log still contained only the initial old-account request; no request for `new@example.test` occurred.

## Result

Confirmed browser failure: after a cross-tab account removal/selection change during an active upload, the first tab does not load the newly selected account's library after the upload finishes. It continues showing the prior account's file marker even though the header reflects `new@example.test`.

Expected after the in-flight upload settles: a library request for `new@example.test`, display of `new-account-only.bmp`, and removal of `old-account-only.bmp` from the visible library.

The test did not establish loss of the in-flight upload itself: its status settled and its panel closed. It did not test the upload confirmation callback with a completed chunk, only account selection/removal, upload settlement, and library refresh.

## Retest after controller fix

The root agent copied the controller fix into the isolated port 5219 workspace and repeated the browser flow with the same synthetic setup:

- Before releasing the old-account upload, the primary tab reflected `new@example.test`, had cleared the old account marker from the visible library, and retained the one active synthetic upload job. The request log still contained only the original old-account library request.
- After releasing the upload, the request log contained both the original `old@example.test` request and a new `new@example.test` request. The page showed `new-account-only.bmp`; `old-account-only.bmp` was absent.

This verifies the newly selected account's library loads after the active upload settles and the previous account's library does not remain visible. The root agent was checking the final upload-panel closed state at report time.

Final retest state: the upload status panel and uploading heading were absent; the request log had one request per account (old, then new), and the only visible file marker was `new-account-only.bmp`.
