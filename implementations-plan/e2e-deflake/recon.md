# recon.md — Phase 0.4 codebase recon (e2e-deflake)

Four read-only recon passes (2026-08-11) over the surfaces the fixes touch, plus a
local baseline run. Everything below is verified against dev @ `13b57a6` (post-#355).
This file feeds the plan and every audit: attack the design against it.

## Local baseline

- `backup-roundtrip.test.ts` solo on the idle homelab, armed build: **36s total**
  (vs ≥90s for just the post-submit leg in every CI red) — the flake is
  environment-interacting, not logic-broken.

## 1. Balance render/refresh/sync surface

- **The deterministic settle fact already exists in storage**: each balance is one
  row `nulo:core:token-balances@<id>` (`token-balance/spec.ts:9-18`) whose
  `updatedAt` is bumped by `BalanceJobQueue.syncBatch` at the exact moment a
  projected balance lands (`balance-job-queue.ts:156-162`). `updatedAt: 0` =
  never-synced (drives `TokenCard`'s `isInitialSync`).
- Queue mechanics: enqueues are **coalesced/deduped** (`balance-job-queue.ts:78-84`),
  drained on a 1s tick in batches of ≤12 — refresh-spam does NOT flood the queue,
  but each click is renderer work (dropdown open/wait/click) and each projection is
  PXE load.
- `tokens-menu-refresh` refreshes ALL rows for the account — `TokensView.vue:276-282`
  receives the click `MouseEvent` as its `tb` arg, so the single-token branch is
  unreachable (existing quirk, relied on by tests).
- **In-flight state is NOT observable**: `TaskService` tasks are memory-only
  (`task/service.ts:32`); `TokenCard`'s `isUpdating` is a dead branch with zero DOM
  representation (`TokenCard.vue:67,114-120`); `BalanceView`'s `.refreshing` class
  covers only the displayed token. Completion (the row write) IS observable.
- **Storage-polling from puppeteer is an established pattern**:
  `in-flight-send-guard.test.ts:36-49` (journal rows), `sw-resilience.test.ts`
  (`nulo:liveness`). Apply verbatim to balance rows.
- **Latent false-positive class**: `waitForBalance` scans `document.body.textContent`
  for e.g. `"1,000"` — matches `$1,000.00` fiat or `11,000`. Row-value reads kill it.
- Gas/Fee-Juice balances are a SEPARATE pipeline (`balances.store.ts` +
  `GasBalanceReader`; #355's retry/degraded-cache is gas-specific), memory-only, not
  refreshed by `tokens-menu-refresh` — out of scope here (none of the red waits are
  gas waits).
- Call-site sweep for the fix: `helpers.ts:569,821` (defs; also `sendTransfer`
  internal use at `:665`), `extension.ts:201,660,750,897` (fixture loops),
  `backup-restore-integrity.test.ts:172,179,190,196`,
  `backup-restore-sw-restart.test.ts:303,309`, plus non-red sites
  (`backup-migration-roundtrip`, `account-switch-isolation`, `receive-unregistered`,
  `transfers`, `in-flight-send-guard`) — the arc fixes the RED sites + the shared
  helper; non-red sites migrate only where zero-risk (see plan scope).

## 2. Execute-popup readiness ("approvable")

- Three independent async gates feed Confirm (`windows/execute/index.vue`):
  `initComplete` (payload+op resolution — the SAME fact `waitForExecuteContent`
  observes via `execute-op-item`), `tokenMetadataLoading` (register_token only,
  starts AFTER initComplete flips), `needsFeeSelection` (flips false only after
  `FeeSettingsCard.runInit` → `balancesStore.ensure` → commit → model round-trip).
- **`estimatingOps` does NOT gate the button** (absent from `:disabled` at `:524`;
  `approve()` treats `estimateId` as optional) — a readiness wait must NOT wait for
  estimates to settle (over-waiting).
- The `:disabled` expression aggregates all real gates; design Button emits NATIVE
  `disabled` (`Button.vue:103`). `loading` state is CSS-only
  (`pointer-events: none`) — invisible to a disabled-check, so the predicate adds
  `getComputedStyle(btn).pointerEvents !== "none"` (precedent: `helpers.ts:707-713`).
- **Recommended predicate** (drift-proof — reads the live attribute, doesn't
  re-derive the boolean logic):
  `btn && !btn.disabled && getComputedStyle(btn).pointerEvents !== "none"`.
- **Budget precedents**: `INIT_FETCH_TIMEOUT_MS = 20_000` per store leg
  (`balances.store.ts:106-112`, doc: "the Confirm gate behind it");
  `sendTransfer` waits **120s** on the SAME FeeSettingsCard-driven gate
  (`helpers.ts:704-713`); cold-path 60s convention (`fee-methods.test.ts:206`,
  `helpers.ts:689-697`); measured CI cold-shard multiplier 100-300× vs warm local
  (`implementations-plan/e2e-stabilization/lessons/phase-3a.md`). → 60s default,
  120s for the known-cold callers.
- Default-path call sites (no readiness gate today): 12 files incl. the two red
  ones; fee-override sites get a partial gate incidentally (the method-item testid
  is init-gated; the trigger is NOT).
- **Latent bug found in the touched function**: `approveExecute`'s
  `feeMethod: "sponsored"|"fj"|"fpc"` — runtime testids are
  `send-fee-method-{public|private|sponsored}` (`FeeMethodSelector.vue:42`,
  `fee-helpers.ts:163,172,196`); `"fj"`/`"fpc"` can never match (unexercised today).
- Known gap NOT closed by this arc: `isInteractionCancelled` leaves the button
  enabled while `approve()` no-ops (`index.vue:341`; `DappCancelledOverlay` has no
  testid). No current test races a cancel against approveExecute. Ledger follow-up.
- Auto-close race on approve is already handled by `clickByTestId`'s
  target-detach swallow — keep the final click delegated to it.

## 3. Reset/purge flow

- `deleteProfile` runs 3 phases (`profile/service.ts:852-901`): fast SW phase 1
  (tombstone WRITE `nulo:core:profile-tombstones@<id>` before row delete), awaited
  phase 2 purge via the coordinator (storage purges are ms; the slow tail is
  offscreen RPCs: `clearChainState`×N then `clearProfileState`, each acquiring the
  profile `ReadWriteGuard` write side — **readers drain first**), fast phase 3
  (tombstone CLEAR only after the whole purge resolves).
- **Tombstone ABSENCE = the authoritative completion signal**, equivalent to the
  awaited promise resolving; a rejected purge leaves it present (and shows the
  "Couldn't delete profile" toast, no navigation).
- **Reader-drain coupling**: every balance refresh that reaches PXE is a reader on
  that guard (worst case documented ~90min under a live proof, `rw-guard.ts:8-16`;
  `reset.vue` itself documents ~30min). The tests' refresh storms directly delay
  the purge they later wait on.
- **Checkbox-mount mechanism**: reset page is a LAZY async route chunk
  (vite-plugin-pages default — only the index route is sync); its first dynamic
  import + render queues on the popup's single JS thread behind the storm (40
  un-awaited refresh RPC callbacks + `auth.vue:105-110`'s fire-and-forget
  `refreshBalances(10, accounts)` + `syncTransactions` + notification check, which
  race ahead of the hash flip `reopenAndRecoverAfterImport` returns on). Router
  guard is cheap on this path (`popup/index.ts:55-101`, no SW call when profile
  set); NOT an auth/data gate. Corroboration: `security-reset.test.ts` runs the
  same 5s wait storm-free, never flaked.
- `resetProfile` call sites: `security-reset.test.ts:12`,
  `backup-restore-integrity.test.ts:205`, `opfs-storage.test.ts:130` — helper
  hardening covers all three. **`security-reset.test.ts:15` has its own 10s
  post-reset route wait with the same latent race** (not yet blown; fix in-sweep).
- Diagnostics to attach on timeout: tombstone/row presence, `location.hash`,
  `[data-profile-name]` mount state, error-toast fired, `nulo:core:session`
  presence — distinguishes wedged purge / rejected delete / stuck router /
  starved mount.

## 4. CI workflows + foundry

- **`foundry-rs/foundry-toolchain@v1` is redundant**: only caller is
  `.github/actions/setup-aztec/action.yml:28-30` (bare, no version pin, per-SHA
  cache key), running in all 8 network-e2e job instances per PR. The resolver
  order (`global-setup.ts:28-32`, `CI.md:69-71`) hits the aztec pin's
  `internal-bin/forge|anvil` (priority 2) before `~/.foundry/bin` (priority 4);
  the aztec CLI installer's own `install_foundry()` installs a version-pinned
  foundry with a 3-attempt retry, cached per aztec-version behind `Cache Aztec
  CLI`. Nothing reads the action's output. The dead `FOUNDRY_DIR` export at
  `action.yml:47` is also unread. Smoke has zero foundry exposure.
- **The exit-86 retry wrapper** (`_network-e2e.yml:238-284`) fires ONLY on exit 86
  from the agent step (sandbox never ready AND no test ran), retries the full
  agent once, and does NOT cover setup-step failures (foundry, puppeteer,
  accelerator installs). Orthogonal to `NULO_E2E_RETRY` (vitest per-test retry,
  pinned "0" on the PR gate).
- **Label mechanics for certification**: `pr-network-e2e.yml:104-113` /
  `pr-smoke-e2e.yml:97-106` — `workflow_dispatch` OR base=main OR label OR
  (base=dev AND paths-filter). Both workflows subscribe to `labeled`/`unlabeled`,
  so adding `e2e:smoke` + `e2e:network` fires fresh runs IMMEDIATELY (the
  `.github/README.md:45` "next sync" claim is stale — fix in-sweep).
- Aggregators: `network-e2e-status` needs changes+decide+5-shard matrix+heavy+
  heavy-concurrent+canary; `smoke-e2e-status` needs changes+decide+smoke. The
  prover-ON canary runs `transfers` + `tx-sendTx-default` + `frozen-account-canary`.
- Risk noted: the redundancy argument is resolution-order-based; empirical
  validation = the certification runs themselves (labels force canary + heavy,
  which exercise the L1 deploy hardest). Grep for `~/.foundry`/`FOUNDRY_DIR`
  consumers at merge time (none found today outside `setup-aztec` + the resolver
  docs).

## Reuse / adapt / dedup verdicts

- **Reuse as-is**: raw-storage polling pattern; `clickByTestId` (final click +
  detach swallow); `waitForHash`; the 300s import-nav envelope in
  `importFullBackup` (`import-drivers.ts:179-182`); `data-symbol` row scoping.
- **Adapt**: `resetProfile` (mount-retry + diagnostics); `approveExecute`
  (readiness gate); `waitForBalance` call sites in the red tests → row-value
  polls; `backup-roundtrip`'s hand-rolled 90s wait → shared driver envelope.
- **Do NOT duplicate**: a second inline copy of the import-nav wait (export the
  driver's); a re-derived boolean readiness predicate (read the live `disabled`).
- **Explicitly out of scope** (ledger follow-ups): `TokenCard.isUpdating` dead
  branch; `DappCancelledOverlay` testid; gas-balance settle signal; product-emitted
  readiness contract (competing outline, rejected).
