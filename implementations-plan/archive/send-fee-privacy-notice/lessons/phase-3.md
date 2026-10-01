# Phase 3 — the row and the page

- **The notice derives from the method that pays, not the one displayed.** `payerNotice` reads
  `effectiveMethod`; a pending preview (saved Fee Juice pick, balances still loading) shows Fee Juice
  in the trigger but pays nothing, so it warns about nothing. Pinned by the "while loading" case.
- **One row, two wordings.** The destination only swaps the body (`data-notice-shape`); it never
  re-emits settings — pinned by counting `update:modelValue` across a destination flip.
- **e2e hooks added with the row, not after it:** `fee-settings-card[data-origin]` on the card root.
  Without it an e2e cannot tell "settled under the origin I just chose" from "still showing the last
  origin's method" — the dropdown attribute alone is ambiguous across an origin flip.
- **No UI beyond the table.** The remedy reuses the nudge's link class plus one orange modifier; the
  no-gas nudge and the page takeover only change wording under a private origin.
- **Signing hang.** `git commit` sat in `ssh-keygen` past 120 s; rerun as `SSH_AUTH_SOCK= git commit`
  (stays signed — `%G?` = G). Remove the stale `index.lock` first.
- Gate: lint 0 · typecheck 0 · modules 459/459 · armed smoke build 0 · full smoke suite exit 0
  (32 files passed, 1 skipped; 123 tests passed, 6 skipped). Screenshot of the row: captured by the
  Phase 4 network run (`NULO_E2E_SHOT_DIR`), attached to the PR.
