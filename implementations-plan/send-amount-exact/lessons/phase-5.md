# Phase 5 · Captures for the PR

- The throwaway spec was copied into `tests/e2e/network/` for each run and deleted after it; it
  was never staged, and `git status` shows no spec left. Each run: `e2e:agent`, proverless,
  retry 0, `NULO_E2E_SHOT_DIR` set. Firefox and Chrome each exited 0: 1 test passed, 0 skipped, 8
  captures.
- Files, per browser: `p5-1-typed-million`, `p5-2-typed-18-decimals`, `p5-3-max-exact` and
  `p5-4-review-max`, each also as `-dark`; all sixteen inspected. The spec also measured each
  element in the 360 px popup (scroll width against client width).

| Capture | Field at rest | Corner | Review amount |
|---|---|---|---|
| 1 · 1,234,567.5 typed and left, fee estimated, Confirm on | every digit visible in both browsers | "1,235,567.12345678 TST", visible | — |
| 2 · 1.123456789012345678 typed and left | wider than the field (422 px in 246, Chrome): Chrome shows its head, "1.1234567890"; Firefox its tail, "89012345678" | visible | — |
| 3 · Max, "1,235,567.123456789012345678" | wider than the field (573 px in 246, Chrome): Chrome shows "1,235,567.1234", Firefox "78901234567" | visible | — |
| 4 · the review sheet from the publish strip | as 3 | as 3 | **cut in both browsers**: "1,235,567.123456789012" shows, and "345678 TST" runs off the popup (467 px of text in a 320 px box) |

- **Ask A-1 is live**: the sheet cuts a long amount in both browsers.
- **An amount wider than the field rests differently per browser**: Chrome scrolls an input
  back to its start when it is left, Firefox leaves it scrolled where it was (at its end here),
  so in Firefox a long amount at rest shows only its tail. The input does this for any amount
  wider than the field (about 11 characters at this size), dev's included; keeping every decimal
  makes such amounts common, since Max on a typical 18-decimal balance fills one. Put to the
  owner as Ask A-3.
- **The dark captures of the sheet and the buttons are caught mid-transition**: `shotSend` flips
  the theme and shoots at once, and `PopupCard` and `Button` transition their colours over 0.2 s,
  so the sheet reads washed out and Chrome's Confirm looks dimmed. Read the light captures for
  them; the dark page captures are otherwise sound.
- **Gate.** Eight captures per browser, each inspected and recorded above; no spec left.
