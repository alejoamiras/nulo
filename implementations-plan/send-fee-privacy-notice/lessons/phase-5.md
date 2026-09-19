# Phase 5 — docs, the full gate, and the post-implementation loop

## The codex fix loop (whole diff from the base, `high`, one resumed session — 3 rounds)

- **Round 1 — reject, 5 findings.** Four accepted, one declined with a reason codex then accepted.
  - *P1, accepted (D31).* The forced mount read was gated on a private origin, but the origin flips to
    private inside one mount with no further read — a card mounted under a public origin could default
    a later private send to Fee Juice on a TTL-cached zero. Every Send mount now reads fresh.
  - *P2, accepted (D32).* A public-origin hold on a healthy store reused "…retrying in the
    background"; nothing retries there. That was my Phase 2 call and it was wrong — reusing an existing
    string is not the same as the string being true. The row is now absent in that state.
  - *P3, accepted (D33).* FPC rows do not exist before the FPC list loads, so a saved sponsor pick
    previewed as nothing; the unit test for the preview only covered `fj`. The record keeps a
    display-only label.
  - *P3, declined.* `[data-testid="send-destination-field"] input` is the shared `sendTransfer`
    helper's own selector; a dedicated testid is a harness-wide change.
  - *P3, accepted.* Two comments: one generalisation the fallback itself disproves, one "nothing is
    cast" above a cast.
- **Round 2 — reject, 1 new P1 (D34), reproduced by codex against the real reader + store + resolver.**
  A forced read that *fails* is recovered by the store's backoff loop, which read unforced and
  recommitted the reader's still-valid cached zero. The lesson is about where a guarantee lives: the
  card asked for freshness, the reader honoured it (Phase 2's re-entry fix), and the layer between
  them dropped it on the one path nobody drives by hand. Fixed statelessly in `runRetry`.
- **Round 3 — approve.** "No new material findings. … The stateless fix closes the reported gap
  without adding unnecessary lifecycle state. No new material comment-quality or privacy issues found."
- `/code-review` was not run (`code_review: off`).

## I7 — the Alpha observation (informational, not gating)

Not performed live: it needs a real profile on Alpha in a real browser, which an unattended session
does not have. From the code: the protocol PrivateFPC is derived and listed on every network by the
FPC service (canonical salt), so on Alpha the private-origin walk starts at Private Fee Juice; an
account with no private gas reads `"0"` when the PrivateFPC utility read succeeds and `null` when it
fails, and only the former may default to Fee Juice. Left for the owner's manual pre-release smoke:
open Send on a fresh Alpha profile and note whether the card holds or offers the nudge.

## Gate

- `bun run audit:vue` exit 0 (typecheck ∥ 6620 tests ∥ lint, then build) — before the loop's fixes, and
  re-run after them: exit 0 (6621 tests), with `bun run test` 0 and `bun run lint` 0.
- After the loop: armed smoke build 0 · `send-fee-privacy.test.ts` retry 0 exit 0 · the Phase 4
  network command retry 0 re-run on the final code: exit 0, 4 files / 11 tests.
