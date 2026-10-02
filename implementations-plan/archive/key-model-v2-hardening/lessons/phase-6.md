# Phase 6 lessons — the missing e2e + reconciliation

- **GATE GREEN on the complete P1–P6 tree**: `bun run audit:vue` exit 0 · `bun run test:e2e` exit 0
  (28 files / 93 passed — up from 26/87: the 6 new tests) · `bun run e2e:agent
  passkey-execution-canary + frozen-account-canary + profile-reimport-matrix` prover-ON exit 0
  (3 files / 7 passed). The two canaries passing TOGETHER is the real signal: the passkey chain
  (512-bit reduce, arc 4) and the mnemonic chain (untouched) both execute against a live node with
  real proofs, and the reimport matrix proves restore still works under the DEK rewrap.
- **The new suite paid for itself on its FIRST run** by catching a genuinely shipped bug:
  `AccountImportPopup.handlePickFile` guarded on `typeof picked === "string"` while `pickFile()`
  resolves a `File` — so the "Choose file…" button silently did nothing. It shipped in the parent
  plan's P5, i.e. exactly the phase whose promised smoke tests were never written, and no unit test
  could see it (the popup's logic was never mounted in one). This is the concrete argument for
  writing the e2e a gate names instead of marking the phase ✓ on the strength of adjacent suites.
- **`navigateToSettings` only works from `/popup/general`** — it enters through the BOTTOM NAV,
  which settings sub-pages don't render. A suite that navigates repeatedly (export → import →
  export…) must use `navigateByHash` instead; the first version of this file timed out on
  `clickNavTab` in every test for exactly this reason.
- **Popup transitions stick in headless Chrome** (documented repo quirk): the leftover dimmer
  swallows the next click. `closeStuckPopup(page)` before each navigation is the remedy the repo
  already had — new popup-driving suites should adopt it from the start.
- **Per-row testids need row-scoped clicks**: `account-export-btn` repeats on every account row, so
  it is always dispatched through the row matched by `data-account-name`. A bare `clickByTestId`
  silently targets the LAST match — a wrong-target pass, not a failure.
- **Iterate an e2e file ALONE** (`test:e2e -- tests/e2e/<file>`) rather than through the whole
  suite: ~15s per cycle vs ~6 min, and the failure isn't buried in 90 other results. Only run the
  full suite once the file is green.

LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/phase-6.md
