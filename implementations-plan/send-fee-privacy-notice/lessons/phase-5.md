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

First written off as "needs a real profile in a real browser". That was wrong, and the owner called
it: the smoke harness already IS a real Chrome with a fresh profile, the observation is read-only and
needs no funds, and an unarmed build seeds Alpha as the active network. The only thing that separates
it from a gated test is the live public RPC, which makes it a one-off probe, not a gate.

Run as a throwaway e2e (never committed) on the unarmed build: fresh profile → Send → wait for the
card to settle. Result, settled in 8.6 s:

`{"origin":"private","method":null,"degraded":null,"nudge":"You have no private gas yet…","notice":false,"takeover":"Get private gas"}`

So on Alpha the protocol PrivateFPC **is** listed and both balances were **positively read as `"0"`**
(`none`, the only state allowed to say "you have none") — not a hold, and not a fallback to Fee Juice.
A brand-new Alpha user sees the private-gas nudge and the "Get private gas" primary button.

## Gate

- `bun run audit:vue` exit 0 (typecheck ∥ 6620 tests ∥ lint, then build) — before the loop's fixes, and
  re-run after them: exit 0 (6621 tests), with `bun run test` 0 and `bun run lint` 0.
- After the loop: armed smoke build 0 · `send-fee-privacy.test.ts` retry 0 exit 0 · the Phase 4
  network command retry 0 re-run on the final code: exit 0, 4 files / 11 tests.

## CI on the PR

- **First attempt: `extension-network-e2e-status` red — and I first reported CI without seeing it**,
  because I read the check list through `tail -25` and the two red rows were above the cut. Read the
  whole list, or grep it for `fail|pending`.
- Red jobs: the prover-ON canary (`frozen-account-canary` — `grantPublicAuthwit` "could not process
  the request"; `transfers` — no "Transaction submitted" within 300 s) and shard 3/5
  (`backup-restore-sw-restart`, a 120 s wait). Other PRs' runs were green, so it was not assumed a
  flake: both canary tests were reproduced locally prover-ON (3/3 green) and the failed jobs re-run.
- **Cause (canary): the runner's native prover, not the diff.** Attempt 1's presto-server summary
  reads `3 /prove requests, 1 successful proofs`; with `VITE_NULO_PRESTO_REQUIRED=1` there is no
  fallback, so each failed proof is a failed test. Attempt 2, same commit: `8 /prove requests, 8
  successful proofs`, 3/3 files green. Shard 3's test never opens Send and passed on the re-run.
- The canary step prints only proof COUNTS; the presto-server log lines for a failed proof are not in
  the job log, so the prover-side reason is unknown. Worth a follow-up: tail the log on any
  `PROVE_COUNT != PROVE_SUCCESS`, not only on zero successes.
