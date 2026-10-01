# UC21 Mobile and Touch Viewport Audit

Environment: isolated updated build at `http://127.0.0.1:5221/`; fake account/library state; API traffic intercepted by a synthetic setup init script. No real Google credentials or user data used.

## Findings and retest

**Resolved in the updated build:** The 27-account menu initially extended beyond the 320 × 780 viewport without internal scrolling (initial screenshot retained in the temporary audit workspace). After the patch, root verified the menu is bounded and scrollable: top 72 px, bottom 772 px, client height 698 px, scroll height 1,826 px, `overflow-y: auto`, and scroll position 1,127 px at the bottom. At maximum scroll, Sign out is visible (top 645.6 px, bottom 703.6 px within the menu bottom at 772 px); at scroll position 0, the Close button is visible (84.8–116.8 px).

At 320 × 780 with eight long filenames, document/client/scroll widths are all 320 px. Settings Save and Reset controls plus the input remain within the viewport; their maximum right edge was 294 px, with measured bottoms at 364 px and 595 px.

Initial failure evidence remains in the temporary audit workspace.

## Initial layout measurements

| Viewport   | Document width | Library/actions                                       | Result                                                           |
| ---------- | -------------: | ----------------------------------------------------- | ---------------------------------------------------------------- |
| 320 × 780  |      320 / 320 | 8 long filenames                                      | No horizontal overflow. Patched account menu internally scrolls. |
| 375 × 812  |      375 / 375 | 8 long filenames; Download/Delete right edge 337.2 px | No horizontal overflow; actions fit.                             |
| 768 × 1024 |      753 / 753 | 8 long filenames; action right edge 714.8 px          | No horizontal overflow; 15 px scrollbar reduces client width.    |

## Additional interaction checks

- Settings at 320 px: Save, Reset, and the input were reachable; maximum right edge 294 px. Save bottom 364 px; Reset bottom 595 px.
- Upload panel with eight mock queued files at 320 × 780: panel bounds x=14.4–304 px, y=330.4–780 px. The job list scrolls internally (client height 384 px, scroll height 704 px); after scrolling, the final row was fully visible (691.2–779.2 px).
- Minimize reduced the panel to 65.6 px and hid the list. Enter expanded it. Tab then Enter on Close dismissed the panel after 300 ms; uploads were disabled during the mock transfer, which continued as expected.

All requested viewport, menu, settings-control, and upload-panel reachability checks passed after the account menu fix.
