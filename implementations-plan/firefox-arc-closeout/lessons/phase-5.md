# Phase 5 — the passkey canary on Firefox

## What landed

- `BrowserDriver.credentialOutlivesPage` (`fixtures/browser/index.ts`, Chrome `false`, Firefox `true`), exported by
  the seam like `isFirefox`. The Firefox driver object gained the one line; the privileged function's body was not
  touched.
- `passkey-execution-canary.test.ts` runs on both browsers. Where the credential outlives the page the spec closes
  the anchor popup before the kill (Firefox declines to end a background under an open extension page) and opens a
  fresh popup for the ceremony; where it does not (Chrome) the anchor popup stays open across the kill exactly as
  before. `ceremonyPopup` is the one page stage 4 drives; the header states the credential-scope rule instead of
  "FTN discipline", the restart helper and step lines stop naming a service worker, and the test title is unchanged
  (it is what `canary-expectations.json` will name).
- `browser-seam.test.ts`: `credentialOutlivesPage` joins `BROWSER_FLAGS`, and `driver.<flag>` is now flagged like
  `driver.kind` (a driver fact read through the driver object escaped the identifier scan). Two unit cases.

## Gate

- `cd ROOT && bun run lint` → exit 0; `cd EXT && bun run test -- scripts/e2e` → 6 files, 91 tests (89 + 2), green;
  debt maps unchanged.
- **Mutation check (the seam pin):** with `"credentialOutlivesPage"` taken out of `BROWSER_FLAGS` and the
  `driver.<flag>` clause reverted, `browser-seam.test.ts` → `2 failed | 42 passed` ("a driver fact", "a driver fact on
  the driver"); restored → 44 passed, then the whole `scripts/e2e` again green (6 files, 91 tests).
- **Prover-ON** (native `presto-server` 1.1.1, bb 5.2.0, `VITE_NULO_PRESTO_REQUIRED=1`, `--retry=0`, alone),
  `tests/e2e/network/passkey-execution-canary.test.ts`:
  - **Chrome** → `Test Files 1 passed (1)`, `Tests 2 passed (2)`, 0 skipped; the canary named
    (`✓ passkey canary — register via PRF ceremony, ctor-deploy with real proof, authwit consume, SW-restart
    ceremony re-unlock 47164ms`); `Duration 98.14s`; step wall clock 1 min 45 s.
  - **Firefox** → `Test Files 1 passed (1)`, `Tests 2 passed (2)`, 0 skipped; the canary named (`… 72340ms`);
    `Duration 123.42s`; step wall clock 2 min 11 s.
  - All four stages' step lines on both browsers: registration ceremony, A's ctor-deploy mined, B's authwit consume
    mined, `terminating the background` → `background restarted; the ceremony popup must present the lock screen` →
    `post-restart ceremony unlock ok` → the post-restart tx mined. Both kills were real (no "already stopped it"
    warning on either browser). On Firefox the fresh popup booted straight into `#/popup/auth` and the ceremony's
    `credentials.get` was answered by the session-scoped authenticator after the anchor page was gone — the driver
    fact holds as stated. **Stage 4 passed on Firefox: the pre-declared stop was not reached.**
  - Presto: 6 `/prove` requests, 6 `Proving succeeded`, three per browser by timestamp.

## The 22-minute rule, before Phase 6's workflow edits

GitHub's own durations for the canary job as it stands (three files on Chrome, two on Firefox): Chrome PR
`5 min 50 s` and `6 min 09 s` (runs 35654487613, 35658773310), nightly `7 min 02 s` (35618361402); Firefox PR
`4 min 33 s` and `4 min 58 s`, nightly `5 min 35 s`. Locally each canary costs ~2 min per browser including its
sandbox turnaround (Phase 4: 1 min 57 s / 2 min 15 s; this phase: 1 min 45 s / 2 min 11 s). The four-file job is
therefore expected near **9–10 min on Chrome and ~10 min on Firefox** — far under 22, so the split path is not
taken; Phase 6 measures the real job on the PR, slower browser, over at least two runs.
