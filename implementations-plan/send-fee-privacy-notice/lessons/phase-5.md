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
- ~~The prover-side reason is unknown.~~ **Wrong, and corrected two days later.** The workflow
  already uploads `presto-server.log` as a failure artifact; I never looked. It reads `Failed to fetch
  release metadata … status=403 Forbidden` → `Cannot verify bb v5.2.0: no digest available from GitHub
  API` on the first two `/prove` requests, and a clean download + proof on the third, five minutes
  later. Presto verifies `bb` against the GitHub API before running it; the call is anonymous
  (60/hour per source address, shared between runners) and was rate-limited. The token fix for exactly
  this had already merged (the start step passes `GITHUB_TOKEN`) — but `presto-server` 1.1.1, the
  pinned build, sends no `Authorization` header: token support is on presto's `main`, after the tag.
  Two halves of one fix, shipped the same day in two repos, that never met. Flake ledger #31 in the
  `e2e-testing` skill. Closed 2026-09-20: the owner cut `presto-v1.1.2`, which carries the token
  support, and the pin (version + both SHA-256s) moved to it.
  Lesson: before writing "unknown", list the run's artifacts.

## The confidence pass (owner: "do all the things to take you to high")

- **Composition test for D34** — `fee-freshness.integration.test.ts`: the REAL reader behind the REAL
  store, resolved with the REAL rule, only the chain read faked. Warm a true zero, let private gas
  arrive with no invalidation, fail the forced read once, let the backoff recover. Mutation-checked:
  with D34 reverted it fails `privateFeeJuice: Expected "55" / Received "0"`.
- **E2E mutation checks.**
  - Over-warning mutant (notice for ANY payer under a private origin): all three new network tests red.
    The absence assertions are live — worth proving, since one of them had been vacuous earlier (the
    `{}` trap).
  - Smoke, artificial mutant (a hold pays with Fee Juice): red. But the independent reviewer showed
    that a REALISTIC rule mutant (default to Fee Juice on an unread PRIVATE balance) still passes it,
    because under a dead RPC the public balance is unread too and Fee Juice is ineligible under any
    order. My mutant proved the test can fail; theirs proved it cannot fail *for the rule*. The test is
    kept — fail-closed under a dead node is a real property — and relabelled to say exactly what it
    does and does not prove. "Private unread, public held" is not stageable end to end (the private
    leg is a PXE-local simulation), so it lives at component level, where it is mutation-checked.
  - No new real-chain "gas arrives, reopen within the TTL" test: it needs the prefunded-account fixture
    split in two (+3–4 min on the heaviest shard), while the wire it would prove — a forced read
    crossing client → service worker → reader — is already exercised on a real chain by
    `tx-sendTx-selfPay` (the locked-method mount), and the layers above it by the composition test.
- **Fresh-context review** (top-tier Claude subagent, no plan access, same adversarial ask): **approve,
  moderate-high**; no reachable path to an un-noticed or un-read Fee Juice default. Process miss: I ran
  the mutants in the same tree while it was reading — it noticed, and reviewed HEAD regardless. Run
  reviewers against a quiet tree.
  - Accepted: the smoke relabel above; a stacked doc-comment in `fee-privacy.ts`.
  - Owner-decided, not a defect: Fee Juice ahead of an eligible sponsor under a private origin (D30) —
    the reviewer independently called it the largest privacy cost in the diff, as the driver had at
    the gate.
  - **Follow-up, not fixed (unreachable today):** `commitFromEntry` copies `entry.gas.verified`
    without looking at `entry.stale`. If a forced run is outranked by a newer one, `ensure` still
    resolves and the card could copy the older figure. That needs a `txRefresh` subscriber mounted
    alongside Send on the same key; only Home's gas card has one and the routes are exclusive. The
    naive fix (treat stale as unread) would hold forever, because the card's recovery watch observes
    `retryVersion` only — so the real fix is a second wake source, which deserves its own change the
    day such a co-mount exists.
  - Accepted risk: a forced read taken right after a claim can return `"0"` from a PXE that has not
    synced the note yet. The send then defaults to Fee Juice **with** the notice — a worse default,
    never a silent one.
- **Dark theme**: the network test's opt-in capture now shoots both themes.
