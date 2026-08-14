# E2E/CI flake ledger — evidence base

Mined 2026-08-11 from the last 35 runs of each of the `Smoke e2e` and `Network e2e`
workflows (window: 2026-08-01 → 2026-08-11), including **attempt-level** job data —
runs whose latest attempt is green but whose attempt 1 was red are the re-run-cleared
flakes this arc exists to kill. Every red job's log was pulled via
`gh api .../actions/jobs/<id>/logs` (NOT `gh run view --log`, which interleaves
source echoes — see the e2e-testing skill's forensics section).

## Census

15 red jobs across 13 runs: **14 carry puppeteer `TimeoutError`s on specific waits**
(15 timeout occurrences — one job failed two files) and **one is an infra failure**
(the foundry 502, entry 7). Zero assertion failures, zero crashes. Re-runs cleared
all of them (one run needed a second re-run). Every red maps to a ledger entry;
entry 1 (smoke roundtrip) is **FIXED** (2026-08-13 — product root fix in
`implementations-plan/bootstrap-route-decouple/`: the import's account-state restore leg
now runs on a bounded 45s preflight+registration budget with skip-to-Continue records,
merged #357, torn-leg test fold #359, certified per Phase 6 on PR #358 — see that arc's
`lessons/certification.md` for the 3-run matrix). The latent-risk section tracks further
OPEN follow-ups — nothing is silently dropped.

| # | Test file | Suite/shard | Reds | Failing wait | Timeout | Re-run cleared? |
|---|---|---|---|---|---|---|
| 1 | `tests/e2e/backup-roundtrip.test.ts` | smoke | **6** | post-import route wait (`test:132`, hand-rolled) | 90s ×3 retries | yes (incl. one run needing attempt 3) |
| 2 | `tests/e2e/network/backup-restore-integrity.test.ts` | network shard 1 | **4** | `resetProfile` first selector (`helpers.ts:1039`, `reset-checkbox-permanent`) | 5s | yes (every time) |
| 3 | `tests/e2e/network/backup-restore-sw-restart.test.ts` | network shard 3 | 2 | `waitForBalance` convergence leg (`helpers.ts:822` via `test:309`) | 120s | yes |
| 4 | `tests/e2e/network/frozen-account-canary.test.ts` | canary (prover-ON) | 1 | `approveExecute` → `clickByTestId("execute-confirm-btn")` (`test:186` → `popups.ts:263` → `extension.ts:1256`) | 10s | yes |
| 5 | `tests/e2e/network/cancel-mid-prove.test.ts` | network shard 3 | 1 | same `approveExecute` signature (`test:109`) | 10s | yes |
| 6 | `tests/e2e/network/opfs-storage.test.ts` | network shard 1 | 1 | post-`resetProfile` register-hash wait (`test:131`) | 30s | yes |
| 7 | *(infra)* foundry-toolchain install | network heavy/fee-methods | 1 | `foundryup` download from GitHub `releases/latest` → HTTP 502, job dead in 42s | n/a | yes |
| 8 | *(infra)* `Detect changes` job cancelled | both suites, 2026-08-06 15:24 | 2 | run-level cancellation (superseded run), not a flake | n/a | n/a |

## Per-entry evidence

### 1. smoke `backup-roundtrip` — 6 reds (jobs 93560520348, 93614424701, 93639099246, 93641507850, 93645520621, 93645521508)

- Always the same test ("encrypted full backup: export → wrong password rejects →
  decrypt → restore in a fresh extension"), always `TimeoutError: Waiting failed:
  90000ms exceeded` at `backup-roundtrip.test.ts:132`, on **all 3 vitest retries**
  (~335s total, `retry x2`).
- The failing wait polls `location.hash` for `/popup/general | /popup/auth` after
  clicking `import-full-backup-submit-btn` — i.e. it spans restore + the app's
  activation/recovery + routing.
- **Structural contradiction:** the file's own budget comment (line 33–34) allocates
  "import navigation incl. the app's bounded recovery leg (300s)" and the shared
  driver (`helpers/import-drivers.ts` `importFullBackup`) sizes the IDENTICAL wait
  at 300s with the documented rationale (node-client 60s per-request abort ×
  backoff retries; public-RPC throttling). Line 132 hand-rolls it at 90s.
- **Timing signature:** the pre-submit steps (export chain, wrong/right password
  legs) completed in ~20s in every red run — the runner was NOT uniformly slow;
  only the post-submit leg (which transits the public testnet RPC on the smoke
  build, `VITE_NULO_E2E_DEFAULT_NET=testnet`) blew the 90s.
- **Cross-branch time clustering:** reds on three different branches within the
  same evening windows (2026-08-10 18:44 + 22:13, 2026-08-11 00:19→01:09 — incl.
  attempts 1 AND 2 of the same commit red, attempt 3 green), greens before and
  after with unchanged test code ⇒ environmental (remote-RPC health / peak-hour
  runner load) interacting with an undersized wait, not a code regression.
- **Pre-dates this window:** the stable-release-0.27.0 record (2026-07-29,
  `implementations-plan/index.md` entry) already logged a Smoke
  `backup-roundtrip` 90s timeout on the release PR as the "2nd occurrence —
  flaky-test follow-up". The flake is at least a month old and independent of
  the August feature branches.

### 2. network shard 1 `backup-restore-integrity` — 4 reds (93556897384, 93560254065, 93866027049, 93868669969)

- `TimeoutError: 5000ms exceeded` at `helpers.ts:1039` (`resetProfile`'s FIRST
  wait: `reset-checkbox-permanent` visible) via `test:205`, test wall ~65–75s.
- Two of the four reds are from 2026-08-11 (runs 31517426156, 31518232428
  attempt 1) — on the `fix/cold-start-resilience` branch, so #355 did NOT fix
  this one. This is the most-active current flake.
- The reset page (`src/popup/pages/settings/security/reset.vue`) has
  `isAuthRequired: false` and renders the checkboxes unconditionally — there is
  no auth guard or async data gate to blame. The 5s selector wait fails only if
  the popup renderer/router is starved. It runs immediately after the test's
  40-iteration `refreshBalances` spam loop + `reopenAndRecoverAfterImport` —
  self-inflicted service-storm tail is the working hypothesis (to verify).

### 3. network shard 3 `backup-restore-sw-restart` — 2 reds (92984988407, 93645662244)

- `TimeoutError: 120000ms exceeded` in `waitForBalance` (`helpers.ts:822` — a
  full-body text scan for "1,000", polling 3s) at `test:309`, test wall ~292s.
- Preceded by the same 40× `refreshBalances`-and-poll loop (≤ ~120s of refresh
  hammering), i.e. the balance never converged across ~4 minutes. The wallet-side
  cause space (concurrent offscreen balance reads racing/wedging) is exactly what
  #355 ("offscreen single-flight, balance retry") targets — both reds predate
  its merge. The refresh-spam/text-scan wait itself is FIXED (freshness-gated
  row wait, Phase 2).
- **OPEN — observed once, armed, under watch**: during the full-suite pre-push
  gate (2026-08-11), the RECOVERED leg reached the convergence step with **zero
  token-balance rows for the funded account** — and refreshes cannot create rows,
  only re-project existing ones, so no wait could ever converge (the old text
  scan would have parked silently on the same state; the new wait dumped it).
  Suspected mechanism: a mid-restore SW kill landing where the profile finalizes
  but token/balance slices are lost — i.e. a restore-atomicity product gap, not
  a test-wait problem. NOT reproduced in 4 subsequent solo runs + 5 targeted
  runs (all green). The timeout dump now includes a storage census (token rows /
  all balance rows / account rows) that will discriminate slice-loss vs
  row-keying on the next occurrence. If it fires during certification, it resets
  the count and gets root-caused from the census.

### 4+5. `approveExecute` cold-popup — canary red (93556176574) + cancel-mid-prove red (92728645789)

- Both: `TimeoutError: 10000ms exceeded` inside
  `clickByTestId(page, "execute-confirm-btn")` (`extension.ts:1256`, generic 10s)
  called from `approveExecute` (`popups.ts:263`).
- Both call-sites run `waitForExecuteContent()` first — but that only waits for
  `execute-op-item` rows to render. The confirm button requires strictly more:
  `initComplete && !tokenMetadataLoading && !needsFeeSelection && …`
  (`windows/execute/index.vue:524`) and the whole tree is `v-if="isLogined"`
  (`:450`). The gap between "ops rendered" and "approvable" spans the fee
  estimation round-trip — several-to-tens of seconds on a cold shard (the fee
  override branch of `approveExecute` already acknowledges cold-start with its
  own 30s wait; the default branch has NO readiness gate).
- This is the known cold-shard/first-capability-popup limitation
  (`tests/e2e/README.md` "cold-shard rotation", Issue #59) manifesting in the
  two files whose first execute-popup interaction lands earliest in their shard.

### 6. network shard 1 `opfs-storage` — 1 red (93556897384, same job as an integrity red)

- `TimeoutError: 30000ms exceeded` at `test:131`: waiting for
  `location.hash` to include `/popup/register` after `resetProfile`.
- Stale assumption in the test: `reset.vue` **awaits the coordinator's full purge**
  (`handleReset` → `await managers.profile.deleteProfile(...)`; the page itself
  documents a legitimate slow path with a 10s "can take up to ~30 minutes" hint)
  before `router.push`. The integrity test's comment still says "optimistic nav".
  The 30s route wait races an awaited erase cascade (OPFS crypto-erase + legacy
  IndexedDB sweep + in-flight-PXE drain) on a loaded shard — while the
  SUBSEQUENT poll (which would absorb the same time) gets 60s that goes unused
  once the route arrives. Mis-allocated waits around a mis-modeled completion
  signal.
- A rejected `deleteProfile` (toast "Couldn't delete profile") would produce the
  same timeout with zero diagnostics — the fix must dump purge/tombstone state
  on timeout to distinguish.

### 7. infra: foundry-toolchain 502 — 1 red (92728645596, heavy/fee-methods, dead in 42s)

- `foundry-rs/foundry-toolchain`'s `foundryup` bootstrap downloaded from
  GitHub `releases/latest` (unpinned, no retry) → `curl: (22) ... 502` →
  job failed before any test ran.
- Root-cause options: retry wrapper, action version/cache tuning, or dropping the
  Foundry download entirely where the aztec pin's bundled toolchain
  (`FORGE_BIN`/`ANVIL_BIN`, cf. #344) suffices.

### 8. non-flakes recorded for completeness

- Runs 31115708724/31115709564 attempt 1 (2026-08-06 15:24): `Detect changes`
  jobs `cancelled` → aggregator red. Superseded-run cancellation, not flake.
- **The "Infra boot failure (exit 86) — retrying" theory is DISPROVEN for this
  window**: zero `##[warning]Infra boot failure` runtime annotations in any of
  the 15 red logs — every grep hit was the workflow's echoed `run:` source
  (the exact trap the e2e-testing skill documents). No shard in the evidence
  window actually paid a boot retry.

## Post-certification observation: canary prove-duration variance (OPEN — new class, INSTRUMENTED)

> **Watch update (deflake-round-2, 2026-08-14):** the class recurred ONCE during the
> bootstrap-route-decouple certification (trigger-3 red: canary grant `status:"error"` fast
> + transfers 300s confirm timeout; run 31648924385) — matching this section's signature.
> Instrumentation landed in #360: every pg-result mismatch now dumps bounded
> `errorJson` + `pg-error-text`, so the NEXT occurrence carries its payload. Per the
> deflake-round-2 plan: no fix until a recurrence arrives WITH payload evidence.

The post-certification docs-only push (`d914c4e`, tree code-identical to the 3 certified
rounds) hit a canary-job red (run 31547622613, 2026-08-11 ~23:54Z): `transfers` blew its
300s prove-wait AND `frozen-account-canary`'s grant returned status "error". The failure
artifact is decisive: the accelerator-server log ends with **"Proving succeeded" ONE
second after vitest teardown** — the real-BB prove pipeline worked; the shared runner was
~2–4× slower than typical for the 8-circuit ChonkProve chain. Classification: prover-ON
duration variance on shared runners — a DIFFERENT class from the six ledgered wait-bugs
(the canary passed 4× the same day on identical code). Handling: sanctioned genuine-flake
re-run for the merge head (certification runs 1–3 are complete and untouched); if this
class recurs, the fix discussion is prove-budget alignment with the documented 600s
transfers envelope vs runner sizing — an owner decision, not a unilateral bump. Noted
diagnostics gap: the canary's `expect(status).toBe("ok")` assertion prints no error
payload — worth dumping `resultJson` on mismatch in a follow-up.

## Latent risks surfaced during recon (no CI red yet — tracked, not silently dropped)

- `security-reset.test.ts:15`: 10s post-reset route wait racing the awaited purge —
  same structural race as ledger entry 6; fixed in the Fix 5 sweep.
- `approveExecute` dead `feeMethod` keys — **RESOLVED** (deflake-round-2 PR 4/5): both
  popup helpers route through one typed `selectFeeMethod` (`sponsored|public|private`);
  the dead keys are compile errors now; public/private exercised by fee-methods' funded
  submits through the shared path.
- `isInteractionCancelled` window — **RESOLVED product-side** (deflake-round-2 PR 4/5):
  cancellation is durable on the interaction record, approve/resolve refuse cancelled
  records with typed `JobCancelledError` (first service claim wins, both orderings pinned),
  all three windows classify the refusal into the cancelled UI, the confirm button disables,
  and the overlay carries testids. REMAINING follow-up (protocol expansion): no production
  caller of `cancelInteraction` exists — the wallet-sdk/dispatcher never wires a
  cancellation token, so a dApp-driven cancel e2e needs the token plumbed end-to-end AND the
  canceller must settle the pending dApp promise (today nothing does until window dismissal
  or the 10-min reaper).
- Body-text balance scans — **RESOLVED** (deflake-round-2 PR 3/5, #362): every remaining
  site swept to token-scoped freshness/value asserts (incl. two extra same-class sites and
  the three fixture warm-up loops, now fail-hard); `waitForBalance` retired;
  `waitForFreshBalanceRow` proves private raws too.
- `TokenCard.vue` `isUpdating` has no DOM representation (dead branch) — RESOLVED by #357
  (`token-balance-refreshing` dot + failed/stale captions). `isMinting` remains a dead
  branch with no DOM representation — OPEN product follow-up.
- The token-balance projection pipeline persists NO failure record — RESOLVED by #357
  (persisted per-row `syncFailure`, cleared on success; deletion fence + ownership guard
  keep the writes safe).
- Import-tail follow-ups deferred by design in `bootstrap-route-decouple` (owner-ratified):
  durable BACKGROUND re-registration of skipped networks (today the skip records land on the
  Continue-gated errors screen and re-registration is manual); RPC-editing-mid-import (the
  user cannot correct a dead backup-carried rpcUrl during the import); cancellation plumbing
  for the bounded chain-sync tail (deadline enforcement exists, user-initiated cancel does
  not). All three are product follow-ups, not flakes.
- `appearance.test.ts` retry-masked smoke flake — **FIXED** (deflake-round-2 PR 2/5, #361):
  reproduced under CPU load (retry=0), root cause = `setTheme`'s one-shot visibility sample
  racing DropdownRoot's close `<Transition>`; fixed with the `data-dropdown-open` state signal
  + gated `data-toggle-active` waits (the 150ms sleep removed). Post-fix 45/45 load runs; the
  certification campaign on PR 5/5 is the standing proof. First-attempt errors of retried
  passes are now VISIBLE in CI (`RetryErrorReporter`, #360), so this class can no longer hide.
- The exit-86 retry wrapper does not cover setup-step failures — **DECIDED: no widening**
  (deflake-round-2 B7, codex-consulted). The evidence says step-level retries would not have
  saved either observed setup incident: snappy@7.4.0 was DETERMINISTIC (a retry re-installs
  the same broken resolution; the fix was the load-check-gated pin in setup-aztec) and the
  noirup 503s already failed through an inner 3× retry during a sustained outage. Fail-loud
  + targeted, load-check-gated pins beat blanket retries: they surface the cause at setup
  with evidence instead of paying 2× setup time to mask it. Revisit ONLY if a setup failure
  class appears that is (a) transient at the seconds scale and (b) not already inner-retried.
- **14 of the 15 red jobs** carry puppeteer wait-timeouts (15 timeout occurrences —
  job 93556897384 has two); the 15th is the foundry-502 infra failure. Every
  timeout is a **wait on a UI signal downstream of un-modeled async work**
  (nav race, awaited purge cascade, fee-estimation settle, RPC-gated route) —
  none is a wrong assertion, none scattered randomly across files. Genuine flake
  scatters; these cluster on 6 specific waits. (Also rules out the unarmed-dist
  trap: reds are single-file, not the deterministic same-5 signature.)
- Shard topology concentrates risk: shard 1 = integrity + opfs (both drive the
  reset flow), shard 3 = sw-restart + cancel-mid-prove.
- `NULO_E2E_RETRY=0` on network shards (no vitest retry) — every network red is
  a first-try timeout; smoke retries ×2 and the roundtrip red survived all 3
  tries in all 6 jobs (the wait is structurally, not probabilistically, short
  whenever the slow leg engages).
- #355 (`fix/cold-start-resilience`, merged 2026-08-11 17:51) may reduce entry 3;
  it demonstrably does NOT fix entry 2 (two reds on that very branch today).

## deflake-round-2 additions (2026-08-14)

- **A4 e2e cancel driver — DEFERRED BY OWNER (2026-08-13).** Exposing `cancelInteraction`
  through the wallet-sdk schema patch + a network e2e where the dApp cancels mid-execute was
  scoped for deflake-round-3 and explicitly removed from the goal by the owner before the arc
  started. Round 2's product work (durable `cancelledAt`, the `isInteractionCancelled` replay
  RPC, first-claim-wins refusal, typed classification in all three windows) remains covered by
  service/window/composable pins only; there is still no end-to-end proof. Re-open by owner
  decision, not by drift.
- Deferred polish (codex-approved inline shapes; take when touching the helpers anyway):
  fold the baseline capture into `waitForFreshBalanceRow` + a shared `MINT_AMOUNT` fixture
  const; an `assertPgError` mirror for expected-error pg sites (the ok-side dump landed
  class-wide in #360; error-side mirrors stayed bare by scope choice).
- **[SUPERSEDED by deflake-round-3 — the "can WIN" mechanism is unsupported; see below.
  Kept verbatim as the record of what round 2 believed.]** Labeled-PR duplicate-run
  cancellation leaves FAILURE aggregator check-runs on the head
  SHA that can WIN GitHub's latest-per-name required-check resolution → mergeStateStatus
  BLOCKED with every visible gate green (bit #360/#362/#364 in this arc; remedy = empty
  commit → fresh head). Durable fix candidate: aggregator status jobs should conclude
  CANCELLED/neutral when their run is cancelled instead of failure. OPEN CI follow-up.
- `ensureUnlocked`'s first wait (`helpers.ts:82`, 5s auth-selector) lost once under CI load
  in the frozen-account-canary's post-SW-restart leg (run 31730802901, 2026-08-13; rerun
  green; helper untouched by this arc). Same tight-fixed-wait class as entry 2's
  resetProfile 5s — candidate for a causal-signal treatment if it recurs. OPEN watch.
- Retry census (post-A1, pre-certification): two full ARMED smoke runs with retries +
  RetryErrorReporter — ZERO retry-passes suite-wide. The smoke suite enters certification
  retry-clean.
- `backup-restore-sw-restart` (mid-restore-kill test, bootstrap-route-decouple arc) red
  ONCE on #365's content run (shard 3, run 31734785738, 2026-08-13): the designed-retry
  re-import's `waitForHash` 300s lapsed after the log's slow-runner marker fired
  ("post-kill fork unobserved in 45s"). Same head's parallel import tests green (smoke
  import-paths + backup-migration; network backup-restore-integrity + migration-roundtrip
  in other shards) → route path sound; single-occurrence slow-runner flake, PR diff
  (docs+tests) doesn't touch the path. Green on all 3 certification triggers immediately
  after. OPEN watch — if it recurs, the 300s wait needs a causal progress signal, not a
  bigger bound.

## deflake-round-2 certification (2026-08-13, PR #365)

3 consecutive qualifying greens on the frozen tree (e2e-deflake Phase 6 rules): heads
`ba33d81b` → `b164b56e` → `c6ce1264`, each all-three-suites green at run_attempt=1, zero
vitest-retry markers in runtime logs (network shards run NULO_E2E_RETRY=0 by gate design;
smoke's retry:2 unconsumed), zero exit-86/infra-reboot warnings, all 8 network agent jobs
ran green, each campaign run completed before the next trigger. A1–A5 + B6–B7 closed.


## deflake-round-3 (2026-08-14) — two "known" mechanisms did not hold up

### CLOSED

- **Duplicate-aggregator merge trap — MECHANISM UNSUPPORTED.** Round 2 recorded that a
  cancelled duplicate's FAILURE aggregator wins latest-per-name resolution and blocks
  merges. Measured on PR #367: `mergeStateStatus` goes BLOCKED → CLEAN once the survivors
  land, with the duplicate's FAILURE still on the SHA, and on every round-2 "blocked" head
  the FAILURE was the OLDER check-run (6–11 min earlier). Round 2's three empty-commit
  remedies post-date the last survivor success by 41s–4m, so what it observed is NOT
  explained — but it is not this. `pr-quick.yml` dropped `labeled`/`unlabeled` (it never
  reads labels); no gate semantics changed. Full evidence:
  `implementations-plan/deflake-round-3/lessons/phase-1.md`.
- **`ensureUnlocked` silent no-op — FIXED.** It sampled `window.location.hash` once and
  returned early when the router had not settled, leaving callers believing the wallet was
  unlocked. Now decides from the session record's SHAPE plus the route, and proves the
  unlock by that record reappearing for the expected profile with a newer `since` — the
  old route-only wait was satisfiable by the bootstrap's own redirect, i.e. a broken unlock
  could pass. Contract + three documented limits in its TSDoc (password profiles only;
  single profile or trustworthy `nulo:ui:lastActiveProfile`; callers keep a downstream
  postcondition).
- **`launchExtension` frame detach — FIXED.** It navigated `browser.pages()[0]`, a page
  Chrome owns; now creates its own with a bounded create/navigate retry. `openPopupOnce`
  also leaked its page on the retry path, and `isFrameDetachError` did not match
  "Attempted to use detached Frame" — puppeteer's other wording — so the retry could not
  absorb the failure it exists for.
- **`Runtime.terminateExecution` does not kill the service worker — ROOT-CAUSED.** Target
  survives, session record survives, wallet stays unlocked, `nulo:liveness` advances by
  exactly one HEARTBEAT_INTERVAL_MS. `worker().close()` (Chrome's documented method) does
  kill it: new target, session gone, cold-boot write. Three sw-resilience tests un-skipped
  and genuinely green; `sw-restart-network` converted. Details:
  `lessons/phase-3.md`.

### Fixed-wait classification table (deflake-round-3 item 2)

Full sweep of `apps/extension/tests/e2e/**`. `page.waitForTimeout`: **zero occurrences** —
that antipattern is already gone. The overwhelming majority of waits are class B (bounded
waits on a genuinely causal predicate), which are correct as they stand; class-B poll
intervals inside bounded loops (e.g. `authwit-lifecycle.test.ts`'s `waitForRegistry`) were
enumerated and excluded rather than counted as findings.

**Class A — bare clock, no predicate:**

| Site | Duration | Disposition |
|---|---|---|
| `fixtures/helpers.ts` `sendTransfer` (`PXE_ANCHOR_SYNC_WORKAROUND_MS`) | 5s | **KEPT** — documented pin for a real wallet bug; no product signal exists to wait on. The accepted exception. |
| `network/fee-methods.test.ts` ×2 (same `PXE_ANCHOR_SYNC_WORKAROUND_MS`) | 5s each | **KEPT** — same pin, same reason; they share the named constant so a future product signal retires all three together. |
| `fiat-display.test.ts` | 150ms | **FIXED** — waits for Toggle's `data-toggle-active`, and the assertion now reads the value the wait proved. |
| `network/incoming-transfers.test.ts` | 3s | **OPEN** — page mount + client connect + first fetch. Needs a ready signal on the activity list; none exists today. |
| `network/connect-locked-queue.test.ts` | 1.5s | **KEPT + pinned** — asserts an ABSENCE (popup must not open); an absence has no completion signal, so the window is the test. Rationale recorded at the site. |
| `network/in-flight-send-guard.test.ts` | 1s | **KEPT + pinned** — same absence shape (switch must be refused). Noted risk: a guard slower than the window yields a false PASS. |
| `network/account-switch-isolation.test.ts` | 3s | **KEPT + pinned** — observation window for a `MutationObserver` armed before the switch; the observer, not the clock, is the detector. |

**Class C — causal but weak predicate (existence/truthy where staleness is possible):**

| Site | Weakness | Disposition |
|---|---|---|
| `fixtures/helpers.ts` `ensureUnlocked` | one-shot `window.location.hash` sample; returned early before the router settled and the caller believed the wallet was unlocked | **FIXED** — decides from the session record's shape + route; unlock proved by a newer record for the expected profile |
| `fixtures/extension.ts` `launchExtension` | navigated `browser.pages()[0]`, a page Chrome owns and can replace | **FIXED** — owns its page, bounded create/navigate retry, widened detach matching |
| `import-paths.test.ts` | hand-rolled in-page `setTimeout` poll duplicating `revealSecretKey`'s pattern | **FIXED** — bounded `waitForFunction`, value taken from the wait that proved it |
| `onboarding-tab.test.ts` | `while(true)` poll with no deadline of its own | **FIXED** — 20s deadline + named failure |
| `sw-resilience.test.ts` / `sw-restart-network.test.ts` / canary — post-kill liveness | strictly-newer heartbeat believed to prove a respawn | **CORRECTED** — it does not (see round-3 findings); gates kept, claims fixed, real kill primitive adopted in the first two |
| `helpers/import-drivers.ts` `importFullBackup` | single undifferentiated 300s route wait spanning restore + activation | **DEFERRED — see below** |

**`importFullBackup`'s 300s wait — SECOND OCCURRENCE, now the blocking item.** It lapsed
again on deflake-round-3's own close-out PR (#370 content run, shard 3,
`backup-restore-sw-restart.test.ts:444` → `import-drivers.ts:182`), after the first
occurrence on round 2's #365 content run. Two arcs, two content runs, same wait — this is
load-dependent structural behaviour, not a coincidence, and it is the recurrence the watch
below was waiting for. It is NOT caused by round-3's changes (`ensureUnlocked` does not
appear in the stack; the failing wait is the import route wait). **Next arc should treat the
staged design as required work rather than deferred**, since it now demonstrably gates
certification campaigns.

**`importFullBackup`'s 300s wait — the deferred design, unchanged.** The plan's final shape (after
three codex rounds) was: expose a `restoreStage` ref advancing at real stage boundaries,
measure per-stage envelopes in both proving modes, then grant an early-fail window ONLY to
stages with a product-owned deadline — every other stage diagnostics-only, with the
unchanged 300s as the sole failure criterion. That is a product observability change plus a
measurement campaign plus network evidence runs, and the audit explicitly rejected the
cheaper variants (a blind 240/60 split tightens the leg that actually lapsed; a
`restoreStatus`-based stall detector is a shorter timeout in disguise, since that field sits
flat at `"progress"` for the whole leg). It is therefore carried as an OPEN item with the
design already settled, rather than half-done under time pressure. **Trigger:** the next
time `backup-restore-sw-restart` or `backup-restore-integrity` lapses that wait.

### OPEN

- **`wallet-locked-mid-session` — "Expected no popup but 1 new popup target(s) appeared"
  (`#/popup/auth`), one occurrence 2026-08-14** on deflake-round-3's campaign-2 trigger 1
  (shard 4). The test locks the wallet mid-flow and asserts no popup opens; an auth popup
  did. NOT in this arc's change path (it uses `lockWallet`, not the `ensureUnlocked` this
  arc touched), and the same shard was green on the content run minutes earlier — treated
  as a flake and re-triggered, per red→flake→rerun. **Watch:** if it recurs, the question is
  whether the SW opens an auth popup on a mid-session lock (product) or whether the test's
  no-popup window is simply racing the lock (test). Capture the popup's opener before
  assuming either.


- **Two network tests still use the primitive that does not kill.**
  `network/frozen-account-canary.test.ts` (stage 5) and
  `network/backup-restore-sw-restart.test.ts` — the latter's entire premise is a
  mid-restore crash which therefore never happens. Converting them to `worker().close()`
  changes what they exercise and needs its own network evidence run. HIGH value: until
  then, neither proves anything about a restart.
- **sw-resilience test 3 ("strict mode OFF → silent restore") — three measured blockers.**
  (1) its original setup posted to ConfigService over `chrome.runtime.sendMessage`, which
  port-based services never receive (`nulo:config` never written); (2) driving the real
  Settings → Security toggle stalls because that page's `onBeforeMount` config reads leave
  `isLoading` true in a post-unlock/post-restart context; (3) reaching settings via the nav
  tab races the unlock's routing. Needs the config-client reconnect lifecycle investigated.
- **Round-2's liveness-gate claim was overstated** (a strictly-newer heartbeat does not
  prove a respawn — the surviving worker supplies one within 10s). Comments corrected in
  `sw-restart-network` + the canary; the gates stay, since truthy passes instantly against
  a stale value.
- **`pr-quick.yml` retarget gap.** A PR retargeted to `dev`/`main` fires `edited`, which is
  not in its `types:`, so a head with no run of its own can sit at required
  `quality-status: Expected`. Adding `edited` is not the fix (it fires on every title/body
  edit → full re-runs + cancellation churn). Recovery: `gh workflow run pr-quick.yml --ref
  <branch>` targeting the PR's current head, then confirm the check landed on that SHA.
- **`withFreshBalanceRow` deferred out of the arc** (22 references across 7 network files +
  fixtures behind a 25-45 min gate — bisection-killing churn inside a flake-reduction arc).
- **Capture before remedying.** If a PR shows BLOCKED with every gate terminal-green,
  record `/commits/<sha>/check-runs`, repeated `mergeStateStatus` reads over ≥2 min, and
  the base branch's protection config BEFORE pushing anything. Two arcs have now destroyed
  that state by remedying immediately.
