# e2e-deflake — root-cause fixes for the recurring e2e/CI flakes

- **Tier**: `/blueprint mid` (user-prescribed in the /goal directive; rubric concurs — see ELI5)
- **Worktree**: `e2e-deflake` (branch `worktree-e2e-deflake`, based on dev @ `13b57a6`, includes #355)
- **Evidence base**: [flake-ledger.md](flake-ledger.md) — 15 red CI jobs mined at attempt level, 6 distinct failing waits, all re-run-cleared
- **Approval**: pre-authorized by the owner's /goal directive (2026-08-11), which prescribes scope, tier, constraints, and the success criterion. Deviations from that scope require re-approval; audits below gate correctness, not authorization.
- **eli5_mode**: artifact — published at https://claude.ai/code/artifact/24d2ac79-5ca8-458c-99ee-af2f8ff534af (source: `implementations-plan/e2e-deflake/eli5.html`; redeploy the same path to update)

## Goal + hard constraints (from the /goal directive)

Eliminate the flakes by root-cause fixes. Banned as "fixes": raising timeouts, weakening/neutralizing gates, skipping tests. Every fix must change **what** is awaited (a deterministic signal), not merely **how long**. Success = 3 consecutive fully-green CI runs (quality + smoke + network, forced via `e2e:smoke` + `e2e:network` labels on one PR) with zero re-runs; every unfixed candidate stays OPEN in the ledger with evidence.

**Interpretation note — REVISED after the dual audit (both attacked the original).** The original note argued that some 90s→300s / 10s→60s changes were "structural, not raises." Codex rejected that as interpreting away the directive; fable called it 80% sophistry. **Adopted position:** a fix counts as within-constraint ONLY when the awaited SIGNAL genuinely changes (a different, causal fact is polled), verified by instrumentation — NOT when the same predicate is merely given a longer clock. Where the honest fix is a pure budget change (the only remaining lever is duration), it is NOT applied unilaterally: it is surfaced to the owner as an explicit exception request and the flake stays OPEN in the ledger until the owner rules. This is exactly the /goal's provision for flakes that can't be fixed within the constraints ("track as OPEN with evidence — do not silently drop"). Fix 1 is the one entry that lands here.

## Architecture & Implementation

The blast surface is the e2e layer (`apps/extension/tests/e2e/**`) plus one CI workflow hardening — **no product-source files, period** (round-2 codex: the earlier "small product-side observability additions" allowance contradicted the freeze; struck). No storage-shape changes, no gate-config changes.

### Fix 1 — smoke `backup-roundtrip.test.ts:132` (6 reds) — control-flow CONFIRMED, trigger UNINSTRUMENTED; classified OPEN (owner decision)

**Root-cause status (precise, per round-2 codex)**: the control-flow dependency is
source-confirmed; that RPC latency is the actual timeout trigger remains an inference
until the Phase-5 diagnostics instrument it. The post-import
route-to-`/popup/general` is gated on `appStore.isLogined`, which
`bootstrapActiveProfile` flips ONLY AFTER the **RPC-bound** `await appStore.syncTransactions()`
completes (`useProfileBootstrap.ts:78-87`). On the smoke build the seeded network is the
public testnet (`VITE_NULO_E2E_DEFAULT_NET=testnet`, pinned to dodge the Alpha-mainnet
blackhole); when that RPC is slow/unreachable from CI, `syncTransactions` stalls →
`isLogined` never flips → the 90s route wait times out. **All 3 vitest retries failing
identically** (each a fresh browser/bootstrap) means the RPC was unreachable for the whole
~5min window — sustained, not a transient blip. Therefore raising 90→300s is NOT even a
reliable fix (a >5min RPC outage defeats 300s too — codex's point).

**This is an RPC-dependency problem, not a timeout problem.** The within-constraint fixes
are: (a) a BUILD/ENV fix — point the smoke build's seeded-network RPC at a **fast-failing**
address (connection-refused aborts in ms) instead of a slow-blackholing public URL, so
`syncTransactions` fails fast → `isLogined` flips fast → the 90s is ample. This is the same
genre as the existing `VITE_NULO_E2E_DEFAULT_NET` pin (env-only, ships nothing, no product
logic change) — IF the node client aborts fast on connection-refused (must verify); or
(b) a PRODUCT change to advance the route on local account state before the RPC-bound
tx-sync (owner approval; separate arc). A naked timeout raise is (c) and is banned.

**Plan**: land pure DIAGNOSTICS now (route-trajectory recorder + per-phase timing dumped on
timeout — ships safely, makes the next red self-explaining). Investigate (a) — verify the
node client's connection-refused abort latency and whether a smoke-only RPC-URL env exists.
If (a) works, it's the fix. If not, Fix 1 stays **OPEN — owner decision required** (env
fast-fail vs product decouple vs budget exception), surfaced in the final report with this
evidence. Do NOT unilaterally raise the timeout.

### Fix 2 — `resetProfile` first-selector 5s (4 reds) — REPRODUCED LOCALLY; root cause CORRECTED

**Original hypothesis (renderer starvation) was FALSIFIED.** The flake reproduced solo on
an idle box, first try (twice), and the instrumented parked-state dump is decisive
(`lessons/phase-2.md`): on timeout the router is fully back on `#/popup/general`
(`readyState: complete`, all general-page testids present) — the checkbox never mounts
because **the app already left the reset route.**

**Real root cause (load-independent nav race)**: `navigateByHash` (`helpers.ts:1002-1015`)
sets `window.location.hash` (synchronous URL update) then does a ONE-SHOT
`waitForFunction(hash === target)` that passes on the first poll — BEFORE vue-router
commits the navigation. A competing `router.push("/popup/general")` (the popup re-running
`loadProfile()` on SW-port reconnect, `app.vue:238-245`; and the post-unlock bootstrap +
incoming-trust re-check churn from `reopenAndRecoverAfterImport`) then supersedes the
in-flight reset navigation. `resetProfile` waits 5s for a checkbox on a route the app
reverted. This is the skill's documented "one-shot route checks race vue-router settling —
use settle loops."

**Fix (a genuinely different, causal signal — NOT a longer clock; codex's retry-on-timeout
objection is dropped)**:
- Make `resetProfile`'s navigation SETTLE-STABLE: navigate, then wait for the checkbox to
  appear AND the hash to REMAIN on the reset route across a short settle window; if the hash
  reverted, re-navigate and retry the settle. The awaited signal is now "the reset route
  committed and stuck", not "the hash momentarily equalled the target." (This replaces the
  drafted naive retry-of-the-same-5s-wait, which codex correctly called a disguised raise.)
- Keep the timeout diagnostics (parked hash + `[data-profile-name]` mount + testid list).
- SECONDARY hygiene (NOT the root cause, do not claim it as such): the Fix-4 de-spam
  reduces the SW-reconnect churn that raises the race probability and shortens the purge
  (ReadWriteGuard reader-drain coupling). The settle-stable nav is the fix; de-spam is
  defense-in-depth.

### Fix 3 — `approveExecute` cold-popup 10s (canary + cancel-mid-prove)

**Root cause**: `waitForExecuteContent` gates only on `execute-op-item` rows; the confirm button additionally requires `initComplete && !tokenMetadataLoading && !needsFeeSelection` (`windows/execute/index.vue:524`) — i.e. the fee-estimation settle. The gap spans several-to-tens of seconds on a cold shard (first execute popup: SW cold start + PXE warmup + estimation sim). `clickByTestId`'s generic 10s then times out. The fee-override branch of `approveExecute` already acknowledges this with its own 30s waits; the default branch has no readiness gate. This is the documented cold-shard limitation (Issue #59) landing on whichever file's execute-popup interaction comes first.

**Fix (instrument-first, per both audits — the "first cold popup" story is weak since the
canary failure is on its SECOND execute popup, so confirm the cause before sizing anything)**:
- STEP 1 — instrument `approveExecute`: on the confirm-click timeout, dump content-ready→
  enabled elapsed, the button's `disabled`/`pointerEvents`, `error-text`, the selected
  `data-fee-method`, and the visible op count. Run the two red files locally
  (proverless + the canary prover-ON) to capture which gate is actually open (fee-selection
  settle vs metadata vs ops) and the real latency distribution.
- STEP 2 — the causal predicate (a genuinely better SIGNAL than `clickByTestId`'s blind
  existence+`!disabled` 10s): `waitForExecuteApprovable(page, timeout)` = `execute-confirm-btn`
  exists AND `!btn.disabled` AND `getComputedStyle(btn).pointerEvents !== "none"`. Reading
  the LIVE `disabled` (not re-deriving Vue logic) is drift-proof; it aggregates ALL gates
  (`index.vue:524`; `Button.vue:103`); the pointer-events clause closes the CSS-only
  `loading` gap (`helpers.ts:707-713`). It deliberately does NOT wait for `estimatingOps`
  (not a gate; `approve()` treats it optional).
- STEP 3 — budget: the new predicate waits on the SAME native-disabled fact `clickByTestId`
  did, so a longer clock alone would be a raise. It is within-constraint ONLY if STEP 1
  confirms the gate is a legitimately-slow-but-BOUNDED async settle (fee-estimation), for
  which the repo already has an established causal budget: the sibling Send flow waits
  **120s** on this exact FeeSettingsCard gate (`helpers.ts:704-713`). Adopting that same
  documented budget for the same signal is defensible; if STEP 1 instead shows the gate
  should already be open in <10s (i.e. the real cause is elsewhere), the fix is that other
  cause, NOT a bigger number — and if no causal budget is defensible, this entry goes to the
  owner as an exception like Fix 1.
- `approveExecute` calls the predicate before the final `clickByTestId` (which keeps the
  target-detach swallow); the generic 10s in `clickByTestId` is untouched elsewhere.
- **File map**: the 120s override for the two known-cold callers requires edits to
  `frozen-account-canary.test.ts` + `cancel-mid-prove.test.ts` themselves (codex — was
  missing from the map; added below).
- **Dropped from this arc** (codex — unrelated scope, `"fpc"` has no clean subtitle):
  the `feeMethod` type/testid mismatch → OPEN ledger follow-up, not fixed here.
- NOT closed (ledger follow-up): the `isInteractionCancelled` enabled-but-no-op window.

### Fix 4 — balance-convergence waits (`waitForBalance` 120s, 2 reds; enables Fix 2)

**Root cause**: `waitForBalance` scans body text at 3s polling while the preceding refresh-spam loop can itself prolong convergence (pre-#355: concurrent offscreen balance reads could race/wedge — exactly what #355's single-flight fixed). The test hammers refresh ≤40×, then passively waits; nothing observes sync completion.

**CORRECTNESS BUG in the drafted design (both auditors — this was the sharpest catch)**:
an imported backup ALREADY contains the `1,000` balance AND a nonzero `updatedAt`, so
polling the storage row for the EXPECTED VALUE can pass with **zero post-import/post-reopen
sync** — it would silently stop proving that the wallet re-syncs on-chain after restore.
Expected-value-only polling masks the very regression the test exists to catch.

**Corrected fix (freshness + value + render, per codex/fable)**:
- Capture the exact `(account,token)` row id and its BASELINE `updatedAt` immediately after
  reopen, BEFORE triggering a refresh.
- Trigger ONE `refreshBalances()`, then require the row to satisfy `updatedAt > baseline`
  AND the exact raw balance value — proving a genuine post-reopen re-projection happened,
  not just that stale-but-correct data survived.
- RETAIN a token-scoped DOM assertion after row convergence (`data-symbol` row, per recon)
  so the test still proves projection→render, not just storage.
- Re-trigger the refresh ONLY on an OBSERVABLE finished/failed attempt (a completed queue
  tick that left `updatedAt` unchanged) — NOT on an invented "settled-but-stale" state that
  storage cannot currently distinguish (codex). If no such observable-retry signal exists
  cleanly, the loop is bounded to **≤5 refreshes** within the existing total budget
  (N chosen: 5 — matches the queue's 1s tick × the documented convergence envelope with
  margin; round-2 codex demanded a concrete N).
- Signal source verified: `updatedAt` bumped by `BalanceJobQueue.syncBatch`
  (`balance-job-queue.ts:156-162`); raw-storage poll pattern established
  (`in-flight-send-guard.test.ts:36-49`). Kills the body-text false-positive class
  (`"1,000"` vs `$1,000.00`/`11,000`) as a bonus.
- Ledger follow-up (NOT fixed here): `TokenCard.vue`'s `isUpdating` dead branch.

### Fix 5 — `opfs-storage.test.ts:131` post-reset route 30s

**Root cause**: the test (and a stale comment in the integrity test) models reset navigation as optimistic, but `reset.vue:66` AWAITS the coordinator's full purge (self-documented slow path: minutes) before `router.push`. The 30s route wait races an awaited erase cascade, while the SUBSEQUENT 60s purge-poll goes unused once the route arrives. A rejected `deleteProfile` (error toast, no nav) would also park this wait silently.

**Fix**:
- Invert the wait to observe the purge itself. Tombstone-absence ALONE is ambiguous — it's
  also true BEFORE deletion starts and after a pre-tombstone rejection (both auditors). The
  causal predicate: capture the profile id and PROVE its row exists before submit, then
  require (profile row absent AND exact `nulo:core:profile-tombstones@<id>` absent AND the
  test's owned roots cleared). Tombstone is written before the row delete and cleared only
  after the coordinator's full purge resolves (`profile/service.ts:873/894/897`) — the
  combined predicate is exactly what `reset.vue`'s awaited promise observes. Poll this
  FIRST (correctly-allocated budget, the same total the test already spends), THEN assert
  the route redirect and OPFS/IndexedDB postconditions.
- `security-reset.test.ts` has a 30s FILE-LEVEL test timeout the sweep must fit inside (or
  consciously adjust) — else the sweep is a no-op there (fable).
- Purge-duration coupling (recon): every balance-refresh that reaches PXE registers as a READER on the profile's ReadWriteGuard; the purge's `enterWrite()` drains readers first (documented worst case ~90min under a live proof). Fix 2's de-spam therefore also shortens the purge itself — the two fixes compound.
- On timeout, dump: tombstone/row presence (wedged vs never-started), `location.hash`, whether the "Couldn't delete profile" toast fired (rejected delete — today indistinguishable from a timeout), and `nulo:core:session` presence.
- Fix the stale "optimistic nav" comment in the integrity test; apply the same post-`resetProfile` structure there (its `test:206` 30s register wait shares the race) AND in `security-reset.test.ts:15` (10s post-reset wait — 4th call site, same latent race, recorded in the ledger as latent).

### Fix 6 — CI infra: foundry-toolchain 502 (1 red)

**Root cause**: `.github/actions/setup-aztec/action.yml:28-30` runs bare `foundry-rs/foundry-toolchain@v1` (no version pin, per-commit cache key, no retry) in all 8 network-e2e job instances per PR — and its output is **never consumed**: `resolveFoundryBinary`'s order (`global-setup.ts:28-32`, `CI.md:69-71`) hits the aztec-pin's `internal-bin/forge|anvil` (priority 2, installed by the aztec CLI's own `install_foundry()` with a version-pinned foundry + 3-attempt retry, cached per aztec-version) before `~/.foundry/bin` (priority 4). The 502'd metadata/download call killed a job provisioning a toolchain nothing reads.

**Fix (delete-after-preflight, per both audits — the action is a dormant PATH fallback if
the bundled `internal-bin` is ever incomplete; don't remove a fallback without first making
its replacement fail loudly)**:
- In the SAME PR, ADD a setup preflight to `setup-aztec` asserting the required
  executables + version exist under `internal-bin` (`test -x .../internal-bin/forge` and
  `anvil`) on BOTH the cache-hit and fresh-install paths — so a future aztec-installer
  regression fails at setup with a named cause instead of mid-L1-deploy (fable C1, codex).
- THEN delete the "Install Foundry" step + the dead `FOUNDRY_DIR` export
  (`setup-aztec/action.yml:47`).
- Bump the aztec-CLI cache key/schema once (NON-optional, round-2 codex) so one cold
  install certifies the fresh path under the new preflight — otherwise the deletion ships
  with the fresh-install path untested.
- grep-verify no other `~/.foundry`/`FOUNDRY_DIR` consumer at merge time.
- fix the stale `.github/README.md:45` "triggers on the next sync" claim (`labeled` fires
  immediately).
- Validated by `bun run lint:actions` + empirically by the certification runs (labels force
  canary + heavy, which exercise the L1 deploy the removal must not affect).

### Explicitly NOT fixed (honesty ledger)

- The two `Detect changes`-cancelled reds: run-supersession, not flakes.
- The exit-86 boot-retry theory: **disproven** for the evidence window (zero runtime warnings; source-echo trap).
- Anything that fails to reproduce and resists diagnosis lands in the ledger as OPEN with evidence — never silently dropped.

## Data & control flow (critical path)

Test waits move from "poll a UI artifact that renders somewhere downstream of async work" to "observe the completion signal of the async work itself, then assert the UI": route-committed-and-stable (settle loop), storage-row FRESHNESS+value convergence (raw `chrome.storage` reads — established pattern), native `disabled` flips (design Button contract), tombstone+row+owned-root clearance (coordinator contract), route trajectories recorded for the diagnosis path. **No product code is touched** — every signal comes from a contract that already exists.

## File-level change map

| File | Change |
|---|---|
| `apps/extension/tests/e2e/backup-roundtrip.test.ts` | Fix 1: shared post-import wait + trajectory diagnostics |
| `apps/extension/tests/e2e/helpers/import-drivers.ts` | Fix 1: export the post-import navigation wait as a shared helper (single source for the envelope) |
| `apps/extension/tests/e2e/fixtures/helpers.ts` | Fix 2: hardened `resetProfile`; Fix 4: settle-signal balance wait replacing text-scan usage in the affected tests |
| `apps/extension/tests/e2e/fixtures/popups.ts` | Fix 3: `waitForExecuteApprovable` + `approveExecute` integration + timeout diagnostics |
| `apps/extension/tests/e2e/network/frozen-account-canary.test.ts` | Fix 3: 120s approvable override for the known-cold caller (codex — was missing) |
| `apps/extension/tests/e2e/network/cancel-mid-prove.test.ts` | Fix 3: 120s approvable override for the known-cold caller (codex — was missing) |
| `apps/extension/tests/e2e/network/backup-restore-integrity.test.ts` | Fixes 2/4/5: settle-stable reset, freshness-gated balance, purge-first assertions, stale comment |
| `apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts` | Fix 4: freshness-gated balance settle |
| `apps/extension/tests/e2e/network/opfs-storage.test.ts` | Fix 5: purge-first wait structure |
| `apps/extension/tests/e2e/security-reset.test.ts` | Fix 5 sweep: same purge-first structure (4th `resetProfile` site, latent; mind the 30s file timeout) |
| `.github/actions/setup-aztec/action.yml` | Fix 6: preflight assert + delete foundry-toolchain step + dead `FOUNDRY_DIR` export |
| `.github/README.md` | Fix 6 sweep: stale "label triggers on next sync" claim |
| `implementations-plan/e2e-deflake/**` | ledger, recon, audits, lessons, this plan |

(**No product-source files are touched** — FROZEN per both audits. Recon found deterministic
signals already exist for every red wait; the competing outline's product-observability
additions proved unnecessary. Any future attribute needs owner approval + a named data
contract + leakage review.)

## Trade-offs & alternatives (competing outline for the audits)

**Chosen: fixture/helper-first, ZERO product touches.** Signals are taken from contracts that already exist (native `disabled`, storage rows, tombstones); recon proved nothing observable is missing for any red wait, so no product code changes at all in this arc (absolute freeze — round-2/3 codex). Cheap, low-risk, reviewable per-fix; keeps the certification loop fast.

**Competing outline — product-emitted readiness everywhere**: give the wallet a first-class e2e observability contract (`data-sync-state` on balance views, `data-ready` on approval windows, a `nulo:e2e:journal` of service settlements), then rewrite the e2e helpers to consume only that contract. Strictly better signals and future tests get them for free — but it's a cross-package product change (design-system + popup + windows), triples the review surface, risks shipping test-scaffolding semantics into prod DOM, and the certification protocol would be gating on brand-new product code rather than on deflaked tests. Rejected for this arc; noted as the follow-up direction if the fixture-first signals prove insufficient (revisit trigger: any OPEN ledger entry whose root cause is "no observable signal exists").

**Alternative for Fix 3 considered — fixture-level SW warm-up tap** (Issue #59's structural fix): pre-warm the first capability popup per browser launch. Rejected here: it hides cold-start latency from ALL tests (including ones that should model it), and #59 tracks it as its own design question.

## Security & Adversarial Considerations

- **Threat model**: the changes touch test infrastructure and one CI workflow. Primary risks are (a) weakening the safety net this arc exists to strengthen, (b) leaking test scaffolding into shipped bundles, (c) CI supply-chain surface of the foundry step.
- **No gate changes**: required-check sets, `continue-on-error`, retry counts, and skip predicates are untouched. The certification protocol runs on fresh pushes, never re-run-button greens.
- **Bundle hygiene**: N/A — no product files change this arc (product observability frozen). The `_build-extension.yml` negative bundle-grep + probe-string guard stay authoritative regardless.
- **CI supply chain (Fix 6)**: dropping foundry-toolchain REDUCES surface (one fewer unpinned `releases/latest` download; the aztec toolchain is already SHA-pinned/cached). If pinning instead: exact-version pin + cache, never `latest`. Workflow permissions stay `contents: read`.
- **Input validation**: raw-storage polls in tests treat storage content as untrusted (presence-guard before `JSON.parse` — same discipline the migration framework mandates).
- **No crypto, no auth, no publishing changes.** Aztec pins untouched (the frozen-account canary is exercised as a test subject only).

## Assumptions

**Facts (verified — corrected after audit)**
1. 15 red jobs total: **14 carry puppeteer wait-timeouts (15 timeout occurrences — job
   93556897384 has TWO: integrity + opfs), and the 15th (92728645596) is the foundry-502
   infra failure, NOT a wait-timeout** (codex corrected the drafted "all 15 are timeouts").
   File:line per red in [flake-ledger.md](flake-ledger.md) (mined via `gh api`, attempt-level).
2. `backup-roundtrip.test.ts:132` waits 90s; the shared driver
   (`import-drivers.ts:179-182`) waits 300s for the same successHash with rationale
   **"30s bounded recovery + slow-runner restore + margin"** — NOT the "node-client 60s
   abort × backoff" envelope, which belongs to `waitForActiveAccount`'s 240s
   (`import-drivers.ts:194-200`). (Both auditors caught the misattribution.) Confirmed
   product cause: the route is gated on `isLogined`, flipped only after RPC-bound
   `syncTransactions` (`useProfileBootstrap.ts:78-87`).
3. `reset.vue` awaits the full purge before navigation (`reset.vue:50-102`); the integrity test's "optimistic nav" comment (`:199`) contradicts it.
4. `execute-confirm-btn` disabled-state encodes init+metadata+fee gates (`execute/index.vue:518-524`); design Button emits native `disabled` (`Button.test.ts:20-22`).
5. `waitForExecuteContent` observes only `execute-op-item` (`popups.ts:309-311`).
6. Zero runtime `##[warning]Infra boot failure` annotations in any red log (source-echo trap disproven for this window).
7. The foundry 502 killed job 92728645596 in 42s before tests (log evidence in ledger).
8. Network shards run `NULO_E2E_RETRY=0`; smoke retries ×2 (job-log env dumps).
9. #355 (offscreen single-flight, balance retry) merged 2026-08-11 17:51; the resetProfile flake red twice ON that branch the same day.

**Inferences (updated post-repro/audit)**
1. ~~Renderer starvation~~ **FALSIFIED and replaced by a confirmed fact**: the reset flake
   is a one-shot-nav-wait race (reproduced solo/idle twice; instrumented parked-state proves
   the app reverted to `/popup/general`). See Fix 2 + `lessons/phase-2.md`. Not an inference
   anymore.
2. The smoke roundtrip reds correlate with public-testnet RPC health / evening congestion —
   now BACKED by the product cause (RPC-bound `syncTransactions` gates the route). Still
   can't be strengthened without RPC telemetry; the diagnostics substitute.
3. The sw-restart balance non-convergence had the pre-#355 concurrent-read wedge as a
   contributing cause; #355 may reduce but not eliminate it. Phase-4 instrumentation + the
   freshness-gated Fix 4 will confirm.
4. Cold-shard estimation latency drives the two `approveExecute` reds — **explicitly
   UNCONFIRMED** (codex: the canary red is on its SECOND execute popup, weakening "first
   cold popup"). Fix 3 STEP 1 instruments to confirm which gate is actually slow before
   sizing anything.

**Asks (surfaced — NOT self-resolved)**
1. **Fix 1 budget/decouple exception (OPEN — owner)**: the smoke-roundtrip flake is RPC
   -dependency-bound; within-constraint options are an env fast-fail-RPC (being
   investigated) or a product route-decouple (owner). If the env fix doesn't pan out, the
   owner must choose env-fix vs product-change vs a budget exception. NOT resolved by the
   plan.
2. **Fix 3 budget (conditional — owner if instrumentation shows no causal budget)**: adopting
   the sibling 120s FeeSettingsCard budget is defensible IF STEP-1 instrumentation confirms a
   bounded fee-estimation settle; otherwise surfaced as an exception.
3. Tier = mid, no /harden scheduling, certification protocol → fixed by the directive
   (certification rules written explicitly in Phase 6 per both audits).
4. **Product observability FROZEN**: recon found deterministic signals already exist for
   every red wait, so NO product files change in this arc (both auditors — the plan's earlier
   "if product data-* added" language is struck). Any future attribute needs owner approval +
   a named data contract + leakage review.

## Phases + validation gates

Order REVISED per codex (Fix 4's balance-settle signal is a dependency of Fix 2's de-spam,
so it lands first). Every network gate runs SOLO (auto-memory) with **`NULO_E2E_RETRY=0`**
(codex — `e2e:agent` defaults to 2 vitest retries, which would mask a residual flake in a
targeted gate). "Green" = the gate's exact command exits 0 on attempt 1 with zero vitest
retries.

**Phase 0 — Evidence (DONE)**: ledger from attempt-level CI mining; recon; dual audit.
Gate: ledger + recon.md + audit-codex.md + audit-fable.md exist. ✓

**Phase 1 — Reset-flow fixes (Fixes 2 + 5)** ✓ GREEN (2026-08-11 — see `lessons/phase-1.md`: 3× consecutive solo greens post-fix vs 2/2 pre-fix reds; security-reset 7.4s inside the restored 30s).
Steps: settle-stable `resetProfile` nav (Fix 2); purge-first combined predicate (Fix 5) in
integrity + opfs + the `security-reset.test.ts` sweep. Keep diagnostics.
Gate: `bun run lint` + `bun run typecheck` exit 0; `NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts tests/e2e/network/opfs-storage.test.ts`
green SOLO; `bun run test:e2e tests/e2e/security-reset.test.ts` green; the flake that
reproduced twice pre-fix now passes ≥3× consecutively SOLO. Lessons `phase-2.md` (done) +
`phase-1.md`.
Layers: lint/typecheck + targeted network e2e + smoke.

**Phase 2 — Balance-settle signal (Fix 4)** ✓ GREEN (2026-08-11 — `lessons/phase-2b.md`: 3× consecutive solo greens post cadence-fix; the gate's own diagnostics caught + fixed a write-gated-retry starvation bug first).
Steps: freshness+value+render predicate (baseline `updatedAt` → `>baseline` AND exact value
→ token-scoped DOM assert; bounded ≤N refreshes). Instrument first to confirm the settle
signal fires post-reopen.
Gate: `bun run lint` + `bun run typecheck` exit 0; `NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/backup-restore-sw-restart.test.ts tests/e2e/network/backup-restore-integrity.test.ts`
green SOLO ≥3×; lessons entry.
Layers: lint/typecheck + targeted network e2e.

**Phase 3 — Execute-approvable signal (Fix 3)** — instrument-first.
Steps: STEP-1 diagnostics → capture which gate is slow + latency → STEP-2 predicate →
STEP-3 precedent-grounded budget (or OPEN-exception if no causal budget). 120s overrides in
both known-cold test files.
Gate: `bun run lint` + `bun run typecheck` exit 0; `NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/cancel-mid-prove.test.ts tests/e2e/network/frozen-account-canary.test.ts`
green SOLO ≥3× (canary prover-ON per its own arming); instrumentation evidence in the
lessons entry.
Layers: lint/typecheck + targeted network e2e incl. prover-ON canary.

**Phase 4 — CI foundry hardening (Fix 6)** ✓ GREEN (2026-08-11 — `lessons/phase-4.md`; empirical certification lands with Phase 6's labeled runs).
Gate: `bun run lint:actions` exit 0; workflow diff reviewed against least-privilege; grep
confirms no other `~/.foundry`/`FOUNDRY_DIR` consumer; lessons entry.
Layers: workflow lint (empirically validated in Phase 6's network runs).

**Phase 5 — Smoke roundtrip (Fix 1)** ✓ GREEN as-scoped (2026-08-11 — `lessons/phase-5.md`: diagnostics landed, full smoke suite 23-passed/1-skip solo; the flake itself stays OPEN — owner decision, since every causal fix requires product source, frozen this arc).
Steps: land trajectory + phase-timing diagnostics; investigate the fast-fail-RPC env fix;
if it lands, apply it; else classify OPEN — owner and record the exception ask.
Gate: `bun run lint` + `bun run typecheck` exit 0; armed `bun run test:e2e` SOLO green
(diagnostics don't regress the pass path); lessons entry stating the resolution (fixed via
env, or OPEN — owner with evidence).
Layers: lint/typecheck + smoke e2e.

**Phase 6 — Certification** — written run-counting rules (codex + fable C4).
Pre-push: `bun run test` + full armed `bun run test:e2e` SOLO + full `NULO_E2E_RETRY=0 bun run e2e:agent`
SOLO all green locally.
Then PR into dev labeled `e2e:smoke` + `e2e:network`. **Freeze the tree first** — the three
certification triggers are **EMPTY commits** (`git commit --allow-empty`): distinct commit
SHAs, identical tree content (round-2 codex killed the contradictory "whitespace push +
tree-change resets" pair). **A qualifying green "run" requires ALL of**: (i)
`quality-status` + `smoke-e2e-status` + `network-e2e-status` all green; (ii) GitHub
`run_attempt == 1` on every job (no re-run button); (iii) zero vitest retries in the logs
(smoke hardcodes 2 retries — a green that USED a retry does NOT qualify); (iv) **zero
runtime exit-86 agent retries** — inspect runtime `##[warning]` annotations via
`gh api .../jobs/<id>/logs`, never the source-echoing `gh run view --log` (a green that
needed the infra re-boot is not a certified green); (v) no job skipped that should have
run; (vi) each trigger waited to completion before the next empty commit (concurrency
cancels predecessors — a cancelled/superseded run is void, not counted). Record a 3-row
run-ID / commit-SHA / per-job-conclusion matrix. **Any red resets the count; any
SUBSTANTIVE tree change (a fix) resets the count.** 2-of-3 green with the third
root-caused = checkpoint, not done.
Layers: everything.

## Decision ledger

**Chosen outline**: fixture/helper-first (no product files), confirmed by both audits as
correct vs the product-emitted-readiness competing outline (blast radius vs certification
speed; revisit trigger = any OPEN entry rooted in "no observable signal exists"). Recon
proved the fixture-first signals already exist for every red wait.

**Round-1 dual audit (2026-08-11)**: codex **reject**, fable **conditional approve**. Both
converged on: disguised timeout raises in Fixes 1–3 (terminal predicate unchanged), the
Fix-4 expected-value correctness bug, the Fix-5 tombstone ambiguity, foundry-delete needs a
preflight, certification needs written rules, Fact 1/2 corrections, freeze product changes.

**Resolutions adopted (this revision)**:
- Fix 2 root cause CORRECTED by local reproduction (nav race, not starvation) → genuinely
  causal settle-stable fix; naive retry-on-timeout dropped. (Resolves both auditors' "prove
  the root cause first" + codex's retry objection.)
- Fix 4 correctness bug FIXED (baseline-`updatedAt` freshness + exact value + retained DOM
  assert + bounded retries). (Codex High, fable C3.)
- Fix 5 → combined predicate with pre-existence proof. (Codex Med, fable.)
- Fix 6 → preflight assert BEFORE deletion + a NON-optional one-time cache bump certifying the fresh-install path. (Codex High, fable C1.)
- Fix 3 → instrument-first; budget only if a causal bounded-settle is confirmed, else
  OPEN-exception; file-map corrected. (Codex High.)
- Fix 1 → control-flow dependency source-confirmed (RPC-latency trigger stays
  uninstrumented until Phase-5 diagnostics); NOT unilaterally raised; env-fast-fail
  investigated, else OPEN — owner. (Both High; the honest resolution of the timeout-ban
  tension.)
- Phases reordered (Fix 4 before Fix 2 de-spam); `NULO_E2E_RETRY=0` everywhere; certification
  rules written. (Codex High.)
- feeMethod sweep DROPPED to a follow-up; product changes FROZEN; Facts 1/2 corrected.

**Disputes / still-open**: Fix 1 and (conditionally) Fix 3 carry owner-exception Asks — the
plan does NOT self-resolve the timeout-ban tension for pure-budget cases. These are surfaced,
not silently assumed.

## Audit verdicts

- **Round 1 — codex (gpt-5.6-sol xhigh)**: reject → see [audit-codex.md](audit-codex.md).
  All blocking findings addressed above.
- **Round 1 — fable (Plan agent)**: conditional approve (C1–C4) → see
  [audit-fable.md](audit-fable.md). C1 (preflight) → Fix 6; C2 (Fix 1 exception) → surfaced
  Ask; C3 (Fix 4 render assert + bound) → Fix 4; C4 (certification rules) → Phase 6.
- **Round 2 — final fresh codex pass**: reject (fake settle window; 45s disguised raise;
  Phase-6 contradiction) → all findings fixed same-session (see audit-codex.md § Round 2);
  Fix 1/3 OPEN/conditional posture endorsed.
- **Round 3 — re-verdict (resumed codex session)**: **conditional approve** — conditions:
  monotonic clock for the dwell (`performance.now()` — APPLIED) + reconcile four stale
  decision-trail statements (APPLIED: Trade-offs zero-product wording, cache-bump
  non-optional, Fix 1 root-cause phrasing, ledger census intro). Fixes 2/5 + Phase 6
  explicitly marked Resolved; "no further implementation-level blocker remains."
  → **Gate satisfied: plan approved for implementation** (with Fix 1 and conditionally
  Fix 3 carrying owner-exception Asks in the final report).

## Seeds

(Finalized post-approval; this arc runs under the owner's /goal directive, which supersedes a separate seed handoff — recorded here for grep-ability.)

- Active: the /goal directive of 2026-08-11 (3-consecutive-green certification; no timeout-raise fixes; ledger honesty).
