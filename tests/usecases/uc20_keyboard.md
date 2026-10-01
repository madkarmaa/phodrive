# UC20: Keyboard and assistive technology

## Scope

Assess keyboard access, focus behavior, dialog cancellation/confirmation, account form validation, action disabling, and upload status announcements. This checkout is isolated at `http://127.0.0.1:5220`; no real account or Google Photos request may be used.

## Initial source review

- Native buttons, form controls, required email/token fields, visible text labels, and `role="alert"` for account messages are present.
- The account menu has `role="dialog"`, an Escape handler, a close button, and account action buttons. Source does not show focus transfer into the menu, a focus trap, or focus restoration to the Manage accounts trigger after dismissal; check with keyboard in Chrome.
- ConfirmDialog delegates to `m3-svelte` Dialog and has Cancel and confirm buttons. Verify focus entry/trapping, Escape cancellation, focus restoration, and that cancellation makes no request.
- Upload status has a polite live heading, per-item `status`/`alert`, a labelled progress indicator, named collapse/close/retry buttons. Verify announcements and disabled actions in a live upload.
- Sidebar Upload and file actions are native buttons. File action and global busy state are passed as `disabled` to most interactive controls. Verify during an in-flight upload/action.

## Live results

Root agent's Chrome proxy opened the isolated local app at `http://127.0.0.1:5220/` (page ID 6) with synthetic accounts/library data and API requests intercepted to return 503. No real credentials were used.

- **Account menu keyboard access:** Focusing Manage accounts and pressing Enter opened the menu, and `aria-expanded` became `true`. Focus stayed on Manage accounts. Tab then focused the Close account menu button.
- **Escape focus return:** Escape from the close button dismissed the menu, but the active element became `BODY`, rather than returning to Manage accounts. This is an observed keyboard focus loss. The menu remained briefly in the DOM during its exit transition; The subsequent stable retest confirmed dismissal.
- **Focus restoration retest after root's patch:** With a fresh reload and the synthetic library fixture reinitialized, Enter on Manage accounts moved focus into the menu to Close account menu. Escape returned focus to Manage accounts and the mocked file remained present. Pass.
- **Delete confirmation dialog:** With a fresh fixture, Enter on Delete opened the dialog. Initial focus was `BODY`; Tab moved focus to Cancel inside the dialog. Escape closed it, returned focus to Delete, preserved the file, and issued no deletion (mock remained active). Pass for cancellation and restoration; focus did not automatically enter the dialog until Tab.
- **Dialog after root's accessibility fix:** A fresh fixture retest after the ConfirmDialog change confirmed Enter on Delete immediately focuses Cancel inside the open dialog. The dialog has the accessible name “Move file to trash.” Root reports Escape had already been observed to restore focus to Delete and preserve the file. Pass for initial focus and named dialog.
- **Account form validation:** Keyboard submission with both fields blank focused the email field and exposed native required validation. Invalid email set `typeMismatch` and kept focus on email. A valid synthetic email with an invalid synthetic token produced the visible `role="alert"` message “Enter your Google account…”. No real credentials were used. Pass for client validation and server-error alert.
- **Active upload announcement/action disabling:** Root ran a real 12-byte synthetic file upload against the intercepted local API with a held request. The status heading announced “Uploading 1 item” via `aria-live="polite"`; the row exposed `role="status"` with “Uploading 0%”. During the upload, Refresh, Upload, Download, and Delete were all disabled. Releasing the held upload completed it and reenabled Upload. Pass for those announcements and disabled states.
- **Upload status minimize/expand/close:** A foreground verification with eight queued synthetic uploads confirmed Minimize removes the queue list and reduces the panel to 65.6 px; Enter on Expand restores the queue. Tab then Enter on Close removed the panel after 300 ms while the fixture remained active and Upload stayed disabled, confirming close hides status without canceling the upload. Pass.
- **Earlier inconclusive close attempt:** A backgrounded-page attempt did not visibly finish the exit animation; a subsequent foreground retest lost its mock fixture before the close action. The later stable foreground run above resolves that uncertainty.
- **Test fixture stability:** Subsequent page reload cleared the in-page mock and file list. The local Vite log shows an HMR update and SSR page reload for `AccountMenu.svelte` (the root agent's change) at 9:03:54 PM, plus repeated font asset allow-list warnings. Later keyboard cases need a fresh mock after source edits settle.
- **Retry coverage:** Failed-file retry behavior is covered by `uc07_network_retry.test.ts`; this browser run did not exercise the retry control with a failed provider response.

## Cases to record

1. Keyboard open/close account menu, focus placement and return, Escape dismissal.
2. File deletion dialog: focus behavior, Escape/Cancel leaves file unchanged, confirmation dispatches only the fake request.
3. Add-account form: tab order, native required/email validation, server-side error announced as alert; fake credentials only and all network requests blocked/intercepted.
4. Upload status: live heading and row status/progress announcements, accessible progress value; collapse/expand/close/retry controls.
5. During active work, Upload/refresh/account switch/file actions/retry are disabled and cannot be triggered by keyboard.
