# bootstrap-route-decouple — product fix for the smoke backup-roundtrip flake (e2e-deflake ledger entry 1)

- **Tier**: `/blueprint mid` (prescribed by the owner's /goal directive; rubric concurs — 1 HIGH dimension: security sensitivity of the restore pipeline)
- **Worktree**: `bootstrap-route-decouple` (branch `worktree-bootstrap-route-decouple`, based on dev @ `d5eda02`, includes #356)
- **Continues**: [implementations-plan/e2e-deflake/](../e2e-deflake/plan.md) — Fix 1 was classified OPEN (owner decision); this arc is the owner's product fix
- **Approval**: Phase-0 UX discussion completed with the owner 2026-08-12 (this session); design decisions recorded below verbatim. Plan approval gate pending.
- **Audit state**: fable round 1 **conditional approve** (conditions folded — [audit-fable.md](audit-fable.md)); codex round 1 **reject** (all three blocking findings addressed in this revision — dispositions in [audit-codex.md](audit-codex.md)); final fresh codex pass pending.
- **eli5_mode**: artifact — published at https://claude.ai/code/artifact/476020d5-63c1-42c2-ba98-6a7e6ef6e3ff (source: `implementations-plan/bootstrap-route-decouple/eli5.html`; redeploy the same path to update)

## Goal + success criteria (from the /goal directive)

Fix the smoke `backup-roundtrip` flake at its product root. Success = (1) owner-approved UX
design recorded in this plan (§ Owner-approved design), (2) the product change merged to dev
via the normal gates, (3) the codex iteration loop + post-impl review completed with findings
folded, (4) smoke backup-roundtrip green on 3 consecutive labeled CI runs with its 90s bound
UNCHANGED (certification rules: [e2e-deflake plan.md Phase 6](../e2e-deflake/plan.md) —
empty-commit triggers, attempt-1 only, zero hidden retries, any red resets the count).
Hard constraints carried from the deflake arc: timeout raises stay banned; CI gates stay
untouched; e2e waits observe causal signals; ledger OPEN entries get status updates, never
silent drops.

## Corrected root cause (source-verified 2026-08-12; supersedes the arc's framing)

The e2e-deflake arc confirmed the **control flow** (route to `/popup/general` gated on
`appStore.isLogined`, flipped last in `bootstrapActiveProfile`) but left the **trigger**
uninstrumented (`lessons/phase-5.md`: "control-flow confirmed, trigger uninstrumented").
Source verification on dev @ `d5eda02` corrects the trigger:

1. **`syncTransactions` is NOT chain-RPC-bound.** It is a port RPC to the SW that performs a
   `chrome.storage.local` read (`apps/extension/src/wallet/services/transaction/service.ts:128-130`,
   reshaped by #325). Every awaited leg of `useProfileBootstrap.bootstrapActiveProfile` /
   `hydrateKnownProfile` is storage/local-crypto-bound ([recon.md §A](recon.md)). **The popup
   bootstrap cannot hang on a dead RPC on today's tree.**
2. **The genuinely chain-RPC-bound leg is the ACCOUNT-STATE restore inside the import flow.**
   `useFullBackupImport.restoreBackup` awaits — after `profileService.finalizeRestore` (session
   open, every storage slice already written) and before `restoreStatus = "finished"` — the
   account-state restore (`useFullBackupImport.ts:678-684`): `AccountStateService.restore` →
   `PxeServiceClient.registerSender`/`registerContract` per item
   (`wallet/services/account-state/service.ts:211-270`) → offscreen `createChainRuntime` →
   **`node.getL1ContractAddresses()`** (`packages/aztec-runtime/src/pxe/chain-runtime.ts:157`)
   against **the RESTORED network's rpcUrl (carried in the backup — which, for a backup exported
   from a seeded wallet, is the public testnet drpc URL)**. Only after this resolves does
   `completeImport` run and push the route.
3. **On a degraded RPC the flow dies in one of two dishonest shapes**, both parking the route
   (audit-corrected — the previously listed third shape, a 90s+ "Importing…" park, is
   unreachable because the popup→SW per-request timer always fires first,
   `extension-messaging/src/core/base-client.ts:122-131`):
   (a) HANGING RPC: the popup's `restore` RPC dies at the **60s** popup→SW default
   (`extension-messaging/src/background/client.ts:17`) → outer catch → the UI shows
   **"Import failed"** for an import whose storage restore SUCCEEDED and whose session is open;
   (b) FAILING RPC: per-item errors flip `isRestoreHasErrors` and the flow **never auto-routes**
   — the finished-with-errors screen (Continue + View Errors, `popup/pages/import.vue:308-321`)
   waits for a click the e2e never gives. (Underlying envelopes: node client 60s/attempt × 4
   attempts ≈ 246s worst; SW→offscreen 90s/call — recon §D.)
4. **Caveat (epistemic honesty — hardened per both audits):** the account-state attribution is
   source-traced, NOT yet empirically pinned; and whether the smoke backup's account-state
   slice is even non-empty is UNVERIFIED (fresh account creation does not register the contract
   with PXE, `account/service.ts:150`; export arrays may be empty,
   `account-state/service.ts:145`). **Phase 1 is a BLOCKING gate**: inspect the real exported
   smoke backup, reproduce the stall against a controlled endpoint, and STOP + reassess if the
   account-state leg is not the stall.

Real-user impact (why this is a product bug, not a test bug): a wallet import blocks its
completion on public-RPC reachability, reports failure for a succeeded import, and strands on
an error screen when the network hiccups — for chain-registration state that is non-critical to
entering the wallet.

## Owner-approved design (Phase-0 decisions, 2026-08-12 — recorded verbatim)

The owner REJECTED the durable background-deferral design (SW-side pending-registration record +
retry worker) as its-own-arc/over-engineering, and chose: **import REQUIRES a working RPC
(blocking), with bounded, honest failure handling**:

1. **Bounded connectivity preflight** before the registration leg, auto-retried with
   **exponential backoff** (owner-specified), total envelope bounded.
2. **Bounded total budget** on the registration leg itself (covers RPC-dies-mid-import).
3. **On failure/expiry**: record per-item "skipped — couldn't reach network" into the existing
   `restoreErrorLog` and land on the EXISTING finished-with-errors screen (**Continue + View
   Errors — the Continue gate stays; no auto-route**; owner's explicit choice).
4. **Durable background re-registration + RPC-editing-mid-import** go to the e2e-deflake ledger
   as TODO/OPEN follow-ups.
5. Whole-path worst case must stay comfortably under the smoke test's UNCHANGED 90s bound
   (§ Budget envelope).

**Bundled scope (owner opted in):** token-balance persisted failure record; TokenCard
`isUpdating` DOM render; restore-atomicity check (detect + surface, not auto-repair).

**Test vehicle:** owner approved a never-ships `VITE_NULO_E2E_TESTNET_RPC_URL` seed override;
recon found the synthetic-backup vehicle strictly better (zero product lines — the registration
leg dials the backup-carried URL); BOTH auditors ratify the swap; owner confirms at the gate
(Ask 1).

**Smoke test change:** the post-submit wait gains one causal branch — route advanced OR the
Continue button visible (click it, then wait for the route). The 90s bound is untouched.

## Architecture & Implementation

### The fix (Shape A page-side orchestration + SW-side input hardening; § Competing outline)

**Deadline arithmetic (round-2 codex — one implementable model, no contradictory budgets):**
`deadlineAt = tailStart + 45_000` is captured once, page-side, when the chain-sync tail begins.
The preflight consumes at most `min(21_000, deadlineAt - now)`; the registration leg then gets
`remaining = min(30_000, deadlineAt - now)` as BOTH its page-side race budget AND a
`deadlineMs` argument the service enforces ("do not LAUNCH more work past the deadline" —
service-side, so a stateful multi-network backup cannot traverse caps × 90s sequentially after
the page moved on). Every number below derives from this model.

1. **Slice normalization at ONE pure boundary** (codex H6 + round-2 M3): a shared pure
   normalizer (unit-tested; used by BOTH the page preflight and `AccountStateService.restore`'s
   entry): null-safe item guards; **merge items by networkId first** (duplicate items cannot
   bypass caps); caps are AGGREGATE per network (defaults, owner-tunable — Ask 6: ≤8 networks,
   ≤16 input items, ≤64 senders + ≤32 contracts per network, total serialized slice ≤32 MiB —
   contract artifacts are legitimately MB-scale); the `networks` argument validated; excess/
   invalid content collapses into ONE fixed-size summary record, never one record per attacker
   entry. (Also fixes the latent malformed-item record at `account-state/service.ts:227-235`
   whose error today vanishes in the collector.)
2. **Preflight with a REAL fetch-boundary abort** (round-2 codex H1 — replaces the draft's
   uncancelled `withTimeout` race): a new bounded probe primitive — `probeChainId(rpcUrl,
   timeoutMs)` added to the node-factory port + adapter + `FakeNodeFactory` in lockstep (a NEW
   method; `createNode`'s signature untouched) — performs a SINGLE non-retrying `getNodeInfo`
   attempt whose AbortController fires at `timeoutMs` (the `fetchOnce` layer,
   `aztec-runtime/src/utils/fetch.ts:34-77`, without the `retry(makeBackoff)` wrapper). Exposed
   via a new `NetworkService.probeNodeStatus(networkId, timeoutMs)` RPC. The page-side
   `preflightNetworkConnectivity` helper keeps the owner's shape: **5s per attempt × 3 attempts,
   exponential backoff waits [2s, 4s]**, semaphore ≤3, deduped networks, **probing only networks
   with ≥1 registrable sender/contract after normalization (empty child arrays ⇒ zero probes)**.
   Abandoned-probe amplification is GONE (the SW aborts the socket at the boundary); refused
   endpoints reject in ~ms per attempt (total ≈6s incl. backoff); hanging costs exactly 21s.
   Classification: **GO only on `Active`**; `Inactive`/timeout/abort = unreachable →
   skip-with-record; **`InvalidChain` = per-network "wrong network" failure** through the same
   Continue gate. This is LOCAL preflight cancellation — not the rejected registration-wide
   AbortSignal plumbing (round-2 codex concurs).
3. **Registration budget**: the (normalized) registration leg is raced page-side at `remaining`
   (< the 60s popup→SW ceiling so OUR semantics fire first) AND receives `deadlineMs: remaining`
   as an additive, zod-validated third parameter — the service checks the deadline before
   LAUNCHING each item and returns skip records for the rest once expired. A **settled flag**
   guards BOTH `restoreStatus`/routing AND the `restoreErrorLog` append path
   (`recordRestoreErrors` APPENDS — a losing-side late result must not append; unit-pinned).
4. **Service-local fail-fast** (fable refinement): after a connectivity-class failure on a
   network, its remaining items are skipped with bounded records. Residual abandoned work after
   all bounds: at most the in-flight item's 90s offscreen call — a small constant. Full
   registration-wide cancellation plumbing stays REJECTED for this arc → ledger follow-up +
   Ask 5.
5. **Skip-with-record — audit-corrected shape** (codex C1 = fable H1): synthesized skips are a
   bounded explicit variant `{ networkId, restoreError: <constant string>, senders: [],
   contracts: [] }` — attacker items are NEVER spread into the log. `collectRestoreErrors`'s
   account-state branch (`utils/full-backup-helpers.ts:75-89`) gains a presence-guarded
   TOP-LEVEL `restoreError` check (child arrays guarded against non-arrays). Unit pins:
   synthesized skips flip `isRestoreHasErrors`; **Continue — not auto-route — wins**; malformed
   items don't throw.
6. **Continue gate stays** (owner). Continue/View-Errors buttons gain testids
   (`import-full-backup-continue-btn`, `import-full-backup-view-errors-btn`) in BOTH shells.

### Budget envelope (modeled — Phase 1 records measured timings; codex M8)

| Scenario | Path | Modeled time to an actionable screen |
|---|---|---|
| Healthy RPC | unchanged + one fast bounded probe | unchanged (~seconds) |
| RPC refused at import | storage restore + preflight ≈6s (ms/attempt + backoff waits) + skip | **≤ ~25s** |
| RPC hanging at import | storage restore + preflight 21s (aborted at the fetch boundary per attempt) + skip | **≤ ~40s** |
| RPC dies between preflight and registrations | + registration remainder ≤30s (service stops launching at the deadline) | **≤ ~66s** |

"Storage restore 5–15s" is an estimate for ordinary backups (caps bound the pathological case);
Phase 1 measures the real smoke path. The smoke test's UNCHANGED 90s wait observes: route
advanced (healthy) OR Continue visible (degraded) → click → route (session already open;
`waitForProfileActive` resolves immediately; the post-Continue leg is storage-bound — verified,
recon §A). Today's contrast: hanging RPC = 60s to a dishonest "Import failed".

### Bundled item 1 — token-balance persisted failure record

- `TokenBalanceRaw`/`TokenBalanceRawSchema`/`TokenBalanceInfo` (`token-balance/spec.ts:11-28`):
  optional `syncFailure?: { at: number; message: string }` — message BOUNDED (truncated ~200
  chars, normalized; full text transient-only — codex L14). Additive to storage (recon §B).
- `BalanceJobQueue.syncBatch` error paths (`balance-job-queue.ts:142-144,166-178`):
  **re-read the live row** (don't resurrect deleted/stale rows — mirror the success path's
  existence recheck), write `syncFailure` with balances + `updatedAt` untouched, and emit
  `onTokenBalanceUpdated` with the **complete current `TokenBalanceInfo`** (codex M12 —
  TokensView replaces rows from the event payload). Success path **clears** `syncFailure`.
- **Five-listener sweep** (fable M6): `send.vue:103`, `TokensView.vue:162`,
  `BalanceView.vue:218`, `SelectBalanceTypePopup.vue:52`, `tokens/[id].vue:52` — each verified
  or adjusted for failure emits (esp. `tokens/[id].vue`, which renders the payload as fresh).
- Tests consciously updated: `balance-job-queue.test.ts:243-258` pin, `storage-codecs.test.ts`
  corpus `full` fixture, repository/service tests.
- UI (TokenCard): `syncFailure` post-initial-sync → dim last-known amount
  (GasBalanceCard `.amount_stale`) + caption "Couldn't refresh"
  (`data-testid="token-balance-failed"`); existing per-row refresh is the retry.

### Bundled item 2 — TokenCard `isUpdating` render

Pulsing dot alongside the visible balance (GasBalanceCard `.refreshing_dot` pattern,
`data-testid="token-balance-refreshing"`); `TokenCard.test.ts:82-93` rewritten to assert the
dot. The sibling `isMinting` description dead-branch is NOTED (ledger follow-up), not fixed.

### Bundled item 3 — restore-atomicity check (audit-rewritten: smaller + reachable)

- **Marker**: raw `nulo:core:restore-pending@<profileId>` valued `{profileId, pxeGeneration,
  at}` (generation-bound — codex C3). Written **marker-BEFORE-row** in BOTH restore branches
  (password `profile/service.ts:1332-1353` AND passkey `:1409-1439` — fable H2) under the
  facade lock, with compensation on row-write failure. **Cleared at `finalizeRestore` ENTRY**
  (the call itself proves slices complete — resolves fable M3's finalize-throw false positive:
  those survivors keep their documented unlock recovery), on `deleteProfile` (live AND
  crash-resume cleanup), and lazily purged when no matching profile row / generation exists.
- **Guarantee — explicitly NARROWED (codex C2, option b; owner Ask 4)**: the marker covers the
  STORAGE-SLICE window [restore-start → finalize-entry]. The post-finalize chain-registration
  leg is bounded + user-visible (Continue gate) but NOT crash-durable — a popup killed inside
  that ≤51s window loses only the skip-record display, never storage slices. The
  crash-durable alternative (completeRestore machinery) is the rejected durable-deferral arc.
- **Detection**: at `openSessionVerified` ENTRY (single locked chokepoint — safe under
  entry-clearing; runs BEFORE the account-integrity delegate, fixing precedence by ordering).
  Marker present + valid generation match ⇒ typed **`RestoreTornError`**; session withheld.
  **Fail-closed on corruption** (round-2 codex M4): a raw marker key that EXISTS for a live
  profile but cannot be decoded blocks (tombstone precedent — existence decides,
  `tombstone-repository.ts:27`); only a generation MISMATCH against a live profile is purged.
- **The typed error is a registered `WalletError` subclass** (round-2 codex H2):
  `RestoreTornError` lives in `packages/extension-messaging/src/errors.ts` with a
  reconstruction-switch entry + round-trip test — otherwise it flattens to a plain `Error`
  across the RPC boundary and `auth.vue`'s `instanceof` can never match. A REAL transport test
  (service → client reconstruction), not only a mocked component test.
- **Rehydration path returns, never throws** (round-2 codex H2): `SessionManager.restore`'s
  profile lookup does not catch throws (`session-manager.ts:341`) — a throwing callback would
  abort `ProfileService` init. The marker check there makes the lookup return `undefined` so
  the persisted session is silently CLOSED; the user lands on auth and the interactive unlock
  produces the typed error + message.
- **Surface (audit-corrected — the barrier was UNREACHABLE)**: auth.vue catches the typed error
  and renders an inline explanation ("This profile's import didn't finish — delete it and
  re-import your backup") with the EXISTING Delete-profile affordance on that screen. The
  barrier component, blocked-record repository, and second storage root from the draft are
  **dropped** (codex H7 proved the withheld user lands on auth, which the barrier exempts).
- Tests (round-2 codex M4's explicit list): composition-harness crash-boundary pins —
  marker-before-row, compensation, BOTH branches, entry-clear, double-finalize no-op,
  finalize on a non-restored profile, wrong-id finalize, invalid-password/pending-secret
  failure AFTER entry-clear (unlock recovery preserved), corrupt marker fail-closed,
  generation-mismatch guarded purge, rehydration-close without init failure, delete/crash-
  resume clears; transport round-trip test; auth-screen component test; torn fixture folded
  into the `backup-restore-sw-restart.test.ts` outcome matrix (consciously updated — fable M3).

### Data & control flow (critical path after the fix)

submit → trust gates → marker → storage-slice restores → `finalizeRestore` (marker cleared at
entry; session opens; popup bootstrap runs concurrently) → slice validation/caps → **preflight
(Active-only GO; ≤21s hanging / ≈6s refused)** → registration leg raced at the deadline
remainder (≤30s) with service-local fail-fast → `restoreStatus="finished"` → no errors:
auto-route | errors: Continue + View Errors → click → route.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/composables/importPreflight.ts` (NEW) | bounded probe, exp backoff, Active-only GO, semaphore, injectable |
| `apps/extension/src/composables/useFullBackupImport.ts` | deadline + preflight + registration race + skip synthesis + settled guard (incl. error-log append path) |
| `apps/extension/src/utils/full-backup-helpers.ts` | `collectRestoreErrors`: top-level account-state check + presence guards |
| `apps/extension/src/wallet/services/account-state/service.ts` | entry validation/caps + service-local fail-fast + malformed-item record fix |
| `apps/extension/src/popup/pages/import.vue` + `onboarding/pages/import.vue` | Continue/View-Errors testids |
| `apps/extension/src/popup/pages/auth.vue` | typed `RestoreTornError` inline message |
| `apps/extension/src/wallet/services/profile/service.ts` | marker write (both branches, marker-before-row) + entry-clear + delete/crash-resume clears + `openSessionVerified`/rehydration checks + typed error |
| `apps/extension/tests/e2e/backup-roundtrip.test.ts` | post-submit causal branch sharing ONE `submittedAt + 90_000` deadline (Continue click consumes the remainder — a fresh post-click wait would silently raise the bound; round-2 codex M2) + the stale "RPC-bound syncTransactions" comment corrected |
| `apps/extension/tests/e2e/import-dead-rpc.test.ts` (NEW) | refused + blackhole + stateful variants; the stateful stub must ANSWER `getNodeInfo` (preflight passes), then OBSERVE `getL1ContractAddresses`, then blackhole — the asserted method sequence proves the registration race engaged; 127.0.0.1 bind, socket-tracked finally-close, per-test retry 0 |
| `packages/aztec-runtime` node-factory port + adapter + `core/testing/fake-node-factory.ts` | NEW `probeChainId(rpcUrl, timeoutMs)` (bounded, non-retrying, abort-at-boundary) — lockstep update |
| `packages/extension-messaging/src/errors.ts` (+ round-trip test) | `RestoreTornError` registered WalletError subclass + reconstruction switch |
| `apps/extension/src/wallet/services/profile/session-manager.ts` | rehydration lookup returns `undefined` on marker (silent session close, no init abort) |
| `apps/extension/src/wallet/services/network/service.ts` | NEW `probeNodeStatus(networkId, timeoutMs)` RPC (existing `getNodeStatus`/`_getChainId` untouched) |
| `apps/extension/tests/e2e/helpers/import-drivers.ts` | synthetic account-state slice via the existing `extraData` hook; REAL derived account address (integrity-coordinator-safe); stub-server helper |
| `apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts` | outcome matrix consciously updated for the marker (fable M3) |
| `wallet/services/token-balance/spec.ts` / `balance-job-queue.ts` + tests + `storage-codecs.test.ts` | bundled item 1 |
| `popup/components/modules/general/TokenCard.vue` + test (+ the five-listener sweep files as needed) | bundled items 1+2 UI |
| `implementations-plan/e2e-deflake/flake-ledger.md` | entry 1 → FIXED (post-cert); TODO entries (durable re-registration; RPC-edit-mid-import; isMinting dead branch; cancellation plumbing) |
| `.claude/skills/e2e-testing/SKILL.md` | deflake-lessons update post-cert |

**NOT touched**: `_getChainId` defaults, `NodeFactory.createNode` signature, trust-gate order /
rollback bookkeeping / P7 discipline, deletion tombstones, `deletionState.isReserved`, CI
gates, the 90s smoke bound, driver 300s/240s budgets.

## Competing outline (the implementation-shape fork within the approved UX)

**Shape A — page-side orchestration (+ SW-side input hardening) — CHOSEN.** Bounds live where
the UX lives; the security-audited restore RPC signature is unchanged; `withTimeout` exists;
trivially unit-testable. Accepted cost: budget-expiry abandons in-flight SW/offscreen work —
bounded to a small constant by caps + preflight-gating + service-local fail-fast; the skip log
may overstate ("skipped" items can complete late) — settled-flag guards the log itself.

**Shape B — SW-side budget in `AccountStateService.restore`** — rejected: signature/semantics
change on the audited surface, and WITHOUT a cancellation primitive it abandons the same work
merely SW-side (codex round 1 concurs: "would not fix this").

**Shape B+ — codex's hybrid (deadline propagated to the node-fetch boundary with real
`AbortSignal` cancellation)** — rejected FOR THIS ARC as a registration-wide mechanism:
cross-boundary plumbing (popup→SW→offscreen→node client) at the infra scale the owner declined
twice; the bounded-abandonment residual (one in-flight 90s call) does not justify it now.
→ ledger follow-up + Ask 5. **Two hybrid-lite elements WERE adopted from it in round 2**: the
fetch-boundary-aborted preflight probe (local, one new port method) and the additive
`deadlineMs` parameter on the registration RPC (service stops launching work at the deadline)
— the small, honest subset that kills the amplification without the plumbing.

## Security & Adversarial Considerations

- **Threat model**: the backup blob is ATTACKER-CONTROLLED. New surfaces + mitigations:
  - Preflight probes backup-carried URLs: `isAllowedRpcUrl` boundary unchanged (https any /
    http loopback, `aztec-node-factory-adapter.ts:32-47`); probes deduped, semaphored (≤3),
    capped (≤8 networks), 3 bounded attempts each — strict improvement over today's unbounded
    246s envelope.
  - Slice content: zod-validated + capped at the SW restore entry (H6); skip records are
    CONSTANT strings in a bounded variant — attacker items never spread into the log;
    `syncFailure.message` truncated; error log renders through the existing escaped viewer.
  - Abandoned-work amplification: bounded by caps × self-terminating transport envelopes;
    residual documented + ledgered (Ask 5).
  - Marker keys are SW-written, generation-bound, and NOT injectable via backups (the slice
    registry rejects unknown slices, `backup-migration-registry.ts:191-212,249-252` — fable-
    verified).
- **Session semantics (audit focus)**: the flake fix does not touch `isLogined`, bootstrap
  ordering, `shouldAdvanceToGeneral` (Q-15), or `completeImportWithRecovery` outcomes. The torn
  check adds a typed refusal BEFORE session open, ordered before the integrity delegate;
  strict-mode needs-unlock keeps working (lock-race tests are explicit Phase-2 deliverables —
  codex M13: lock during preflight / during registration / at Continue click ⇒ no route
  advance, no session resurrection, needs-unlock authoritative).
- **Restore invariants preserved**: trust-gate order, rollback bookkeeping, P7 discipline —
  new logic sits strictly after finalize and outside the backup-service loop (both auditors
  verified).
- **Storage**: two additive shapes (`syncFailure` field; `restore-pending` marker — the torn
  record was dropped). Pre-production baseline (no migrations); neither is backup-exported.
- **Least privilege / supply chain / crypto**: no new deps, no workflow changes, no crypto.
- **E2E hygiene**: `listen(0)` on 127.0.0.1, socket-tracked finally-close; `http://localhost:1`
  refused literal; per-test isolation fixtures; REAL derived account address in synthetic
  backups (a fabricated one trips the integrity coordinator — fable).

## Assumptions

**Facts (verified — citations in [recon.md](recon.md); Fact 5 audit-corrected)**
1. `syncTransactions` is a storage read; every awaited bootstrap leg is storage/local-crypto-
   bound (recon §A).
2. The account-state restore is awaited pre-"finished", post-finalize
   (`useFullBackupImport.ts:655-684`); it dials restored networks' URLs via PXE offscreen boot
   (`chain-runtime.ts:157`).
3. Timeout envelopes: node 60s×4 (~246s; refused ≈ms), popup→SW 60s, SW→offscreen 90s
   (recon §D).
4. The errors screen never auto-routes; Continue calls `completeImport(importedProfile)`.
5. **(corrected)** `collectRestoreErrors`'s account-state branch consumes per-SENDER/
   per-CONTRACT `restoreError` only (`full-backup-helpers.ts:77-85`); item-level errors are
   dropped today — this plan fixes the collector (top-level check + guards).
6. `withTimeout` races without cancelling (`balances.store.ts:120-137`).
7. Balance-failure signal today = in-memory 60-min TaskService record only; no retry; no
   failure event (recon §B).
8. `TokenBalanceRaw` optional fields are additive-safe; shape-pin tests enumerated (recon §B).
9. TokenCard `isUpdating` is a dead branch (recon §B).
10. No restore-in-progress marker exists; torn profiles unlock normally;
    `ensureDefaultAccount` silently mints (recon §C).
11. `buildSyntheticBackup` embeds `network[0].rpcUrl` + an `extraData` hook;
    `http://localhost:1` is the refused literal (recon §D).
12. Smoke vitest: retry 2, testTimeout 60s default (per-test overrides required).
13. `getNodeStatus` never throws — refused/no-primary/timeout ⇒ `Inactive`; wrong chain ⇒
    `InvalidChain` (`network/service.ts:544-558`).
14. Fresh account creation does NOT register the account contract with PXE
    (`account/service.ts:150`); the export's per-network arrays MAY be empty
    (`account-state/service.ts:145`).

**Inferences (labeled for attack; audit-updated)**
1. The account-state leg is what parked the 6 CI reds — source-traced, unproven. **Phase 1 is
   a BLOCKING verification gate** (inspect the real smoke backup; repro with it; stop +
   reassess on falsification). The hanging manifestation is expected as shape (a)
   ("Import failed" at ~60s), not a silent park.
2. Abandoned SW/offscreen work after budget expiry is bounded to a small constant by caps +
   preflight-gating + fail-fast (NOT "harmless" — the residual is documented + ledgered).
3. Failure emits carrying complete `TokenBalanceInfo` are safe for all five listeners
   (verified per-listener in Phase 3; `tokens/[id].vue` gets an explicit look).
4. Under entry-clearing, `openSessionVerified` + the rehydration callback cover every entry
   path into a torn profile (create/import ids are fresh; password-change needs a live
   session; rehydration is guarded).

**Asks (owner rulings needed at the approval gate)**
1. **Env override**: drop `VITE_NULO_E2E_TESTNET_RPC_URL` in favor of the synthetic-backup
   vehicle (zero product lines; both auditors ratify). Confirm the deviation.
2. **Persisted shapes**: `syncFailure` field + `restore-pending` marker (generation-bound,
   deletion-lifecycle specified) — pre-production baseline, no migrations. Confirm.
3. **Torn-restore surface**: typed unlock refusal + auth-screen message + existing delete flow
   (session withheld; finalize-throw false positive resolved by entry-clearing). Confirm.
4. **Marker guarantee scope**: "restore atomicity" = the storage-slice window; the
   post-finalize registration leg is bounded + visible but NOT crash-durable. Confirm.
5. **Cancellation plumbing** (AbortSignal through SW/offscreen/node) deferred to a ledger
   follow-up. Confirm.
6. **Attacker-input caps** (round-2-refined; aggregate per network after merge-by-networkId):
   ≤8 networks, ≤16 input items, ≤64 senders + ≤32 contracts per network, total serialized
   slice ≤32 MiB (artifacts are legitimately MB-scale), ~200-char bounded messages. Confirm or
   adjust.

## Phases + validation gates

"Green" = the exact command exits 0 on attempt 1 with zero vitest retries. Network-touching
gates run SOLO.

**Phase 1 — BLOCKING empirical verification (no product change)**
(a) Run the smoke export flow locally; decrypt + inspect the REAL exported backup; record the
account-state slice content (senders/contracts per network). **Empty child arrays inside a
non-empty item count as FALSIFICATION** (zero registrable work ⇒ this leg cannot be the stall).
(b) Reproduce the stall: the real backup, its embedded endpoint doctored to the controlled stub
(refused + blackhole + stateful) **with the checksum recomputed over the doctored body**
(validation precedes restore, `useFullBackupImport.ts:238`) — document the doctoring; the stub
LOGS every observed JSON-RPC method. (c) **Negative control**: the same backup with the
account-state slice removed must import CLEANLY against the same dead endpoint — required
result: "full slice stalls, no-account-state control completes". (d) If falsified at any step,
**STOP — reassess root cause with codex before any implementation**. Extend
`buildSyntheticBackup`'s account-state support (test-side) as needed.
**Gate**: `lessons/phase-1.md` with slice-content evidence + stub method logs + paired-control
result + measured timings + the verdict; `bun run lint` + `bun run typecheck` exit 0.
Layers: lint/typecheck + manual e2e evidence.

**Phase 2 — The fix + tests**
Slice validation/caps + fail-fast + malformed-item fix (SW); `importPreflight.ts` (unit:
backoff sequence, per-attempt race, Active-only classification, InvalidChain failure records,
semaphore, deadline remainder); `useFullBackupImport` tail (deadline, race, skip synthesis,
settled guard incl. error-log append pin); `collectRestoreErrors` top-level check + guards
(unit: skips flip `isRestoreHasErrors`, Continue wins, malformed items don't throw); Continue/
View-Errors testids (both shells); **lock-race tests** (lock during preflight / registration /
Continue — codex M13); new `import-dead-rpc.test.ts` (refused; blackhole; stateful preflight-
passes-then-blackhole — asserts account-state engagement pre-submit, per-test retry 0); smoke
`backup-roundtrip.test.ts` causal branch (90s byte-identical).
**Gate**: `bun run test` + `bun run lint` + `bun run typecheck` exit 0; armed FULL
`bun run test:e2e` SOLO green attempt-1. Layers: unit + smoke e2e.

**Phase 3 — Token-balance failure record + TokenCard states**
Spec field (bounded message) + job-queue failure writes (live-row re-read, full-info emits,
clear-on-success); five-listener sweep; TokenCard dot + failed state; conscious pin updates.
**Gate**: `bun run test` + `bun run --cwd apps/extension test:components` + `bun run lint` +
`bun run typecheck` exit 0. Layers: unit + component.

**Phase 4 — Restore-pending marker + torn-restore refusal**
Marker (both branches, marker-before-row, compensation, generation binding, entry-clear,
delete/crash-resume clears, lazy purge); `openSessionVerified` + rehydration checks; typed
error; auth.vue message; composition-harness crash-boundary tests; auth component test;
`backup-restore-sw-restart.test.ts` outcome matrix updated.
**Gate**: `bun run test` exit 0; armed `bun run test:e2e` SOLO green attempt-1;
`NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/backup-restore-sw-restart.test.ts` SOLO green (fable gate condition).
Layers: unit + composition + smoke + targeted network e2e.

**Phase 5 — Full local gates + PR + certification + merge**
Pre-push per the deflake protocol (codex M11 — NOT weakened): `bun run audit:vue` clean; full
armed `bun run test:e2e` SOLO; **full `NULO_E2E_RETRY=0 bun run e2e:agent` SOLO**. PR → dev
labeled `e2e:smoke` + `e2e:network`; content commits first, then certification per e2e-deflake
Phase 6 (tree frozen; 3 EMPTY-commit triggers; qualifying green = all three statuses green,
run_attempt==1 everywhere, zero vitest retries in logs, zero runtime exit-86 annotations, no
skipped-required jobs, completion before next trigger; any red or substantive tree change
resets). **The post-cert docs-only commit (before merge — the deflake precedent) carries: the
3-row matrix in `lessons/phase-5.md`, the e2e-deflake `flake-ledger.md` update (entry 1 →
FIXED + the new TODO/OPEN entries: durable re-registration; RPC-editing-mid-import; `isMinting`
dead branch; cancellation plumbing), and the e2e-testing skill lessons** (round-2 codex L1 —
they need a delivery path INSIDE the PR). Squash-merge (title ≤93 chars).
**Gate**: certification matrix recorded; ledger diff reviewed (no silent drops); PR merged with
required checks green. Layers: all.

**Phase 6 — Close-out (post-merge)**
`implementations-plan/index.md` status flips for both arcs (rides the PR where possible; a
trailing docs PR only if something was missed); final owner report in chat (shipped, UX
decisions as approved, codex consults + verdicts, remaining OPEN items); suggest
`agent-worktree done bootstrap-route-decouple`.
**Gate**: report delivered; index current. Layers: docs.

## Decision ledger

- **Owner-rejected (Phase 0)**: durable SW-side deferred registration (→ ledger TODO);
  page-side best-effort background registration (silent loss). Owner-adjusted: exponential
  backoff. Owner-kept: Continue gate.
- **Audit round 1 (parallel)**: fable **conditional approve** (4 conditions — all folded);
  codex **reject** (3 blocking — all addressed). Full dispositions + cross-auditor dispute
  resolutions in [audit-codex.md](audit-codex.md) / [audit-fable.md](audit-fable.md). Key
  resolutions: skip-record shape rebuilt (C1/H1); marker generation-bound, both branches,
  entry-cleared, guarantee NARROWED to the storage-slice window (C2 option b + fable M3);
  runExclusive-≠-atomicity mechanics adopted (C3); Shape B+ cancellation plumbing REJECTED for
  this arc — caps + semaphore + preflight-gating + service-local fail-fast adopted instead
  (H4 partial); InvalidChain = per-network failure (H5 over fable L8); barrier/blocked-record
  DROPPED for the reachable auth-screen typed refusal (H7); Phase 1 became a blocking
  verification gate (M9/Inference-5 attack); e2e third stateful variant (M10); full pre-push
  e2e:agent restored (M11).
- **Still disputed / open**: none between auditors after resolutions; owner Asks 1–6 pending at
  the gate.

## Audit verdicts

- **Round 1 — fable (Plan agent, model fable, fresh)**: **conditional approve** →
  [audit-fable.md](audit-fable.md); all four conditions folded.
- **Round 1 — codex (gpt-5.6-sol xhigh, fresh)**: **reject** → [audit-codex.md](audit-codex.md);
  all three blocking findings addressed in this revision (C1 skip-shape, C2 marker scope,
  C3 marker atomicity + H4-H7/M8-M13/L14 dispositions logged).
- **Round 2 — final fresh-context codex pass (gpt-5.6-sol xhigh)**: **reject** — zero
  Criticals; two Highs (uncancelled preflight amplification + contradictory budget semantics;
  `RestoreTornError` lacking an RPC/rehydration contract), 4 Mediums, 2 Lows — ALL folded in
  this revision (fetch-boundary-aborted probe + explicit deadline arithmetic + service
  `deadlineMs`; registered WalletError subclass + rehydration-returns-undefined; Phase-1
  negative control + checksum-doctoring protocol; stub method-sequence assertion + smoke
  remainder-deadline; shared pure normalizer with aggregate caps; marker corruption fail-closed
  + edge-case test list; Phase-5/6 docs delivery path; stale test comment). It explicitly
  verified every round-1 fold as correct ("Resolved correctly" list in
  [audit-codex.md](audit-codex.md)).
- **Round 3 — resumed re-verdict on the round-2 folds**: *(pending)*

## Seeds

*(drafted with the ELI5; finalized post-approval)*
