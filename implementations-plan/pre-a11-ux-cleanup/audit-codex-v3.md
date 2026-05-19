# Codex v3 delta audit — Pre-A11 UX cleanup

Date: 2026-04-28
Model: gpt-5.4 with `reasoning_effort=high`

## v1 BLOCKING resolution check

- Track A mis-modeled the Send lifecycle — **addressed** (`plan-v3.md:12,180-193`).
- Execute window cannot observe `submitted`/`failed` after approve — **addressed**.
- Hold-open lifecycle holes — **addressed** (dropped).
- Multi-op approvals — **addressed** (single-op happy path; multi-op deferred).
- Track B-1 cache model — **partial**: gas cache key is `networkId:accountAddress` but private gas balance depends on profile-scoped FPCs (`execution/service.ts:910-915, 968-973`). Need to add profile id (or account+chainId) to the cache key.
- Track B-2 reuse — **partial**: base-fee snapshot is good, but missing endpoint identity (primary endpoint can change at runtime per `network/service.ts:404-419, 446-459`). Also: not all `aztec_sendTx` variants share the estimate path.
- Track C privacy — **addressed**.

## NEW BLOCKING

1. **Branch 4 reuse contract is too broad for current `aztec_sendTx` codepaths.**
   - `estimateOperationFee()` always runs authwit discovery for `aztec_sendTx` (`execution/service.ts:373-397`).
   - `executeAztecSendTx()` skips authwit discovery for embedded-fee sends (`execution/service.ts:1206-1218`).
   - `default_entrypoint` bypasses `buildAndEstimateTxRequest()` entirely (`execution/service.ts:1196-1198, 1258-1285`).
   - **Fix**: scope reuse to `send_transaction` plus non-embedded, non-`default_entrypoint` `aztec_sendTx` only. Document the carve-outs explicitly. (Or unify estimate/execute behind one shared builder before shipping reuse — bigger lift.)

2. **Branch 4 snapshot validation omits endpoint identity.**
   - **Fix**: capture primary endpoint id + url in the snapshot; reject reuse if either changed.

## NEW SHOULD-FIX

- **Branch 1 suspect ranking is off.** Helpers (`getColorFromAddress`, `trimAddress`) are null-safe; `parseNoteContent` failures hit the page-level catch and show the error banner. So a "silent blank" is NOT consistent with a helper exception. Need DOM inspection / component repro, not just helper try/catch logging.
- **Branch 1 "per-row try wrapper" is not concrete enough for Vue templates.** Better: precompute a safe display-model in `<script setup>` OR move the row into a child component with guarded props.
- **Branch 2 test description contradicts the contract.** Plan says `addSender` runs after `addContact`; tests say "addContact failure should not skip addSender." That would create a sender registration without a saved contact. Fix: addContact failure is hard stop; only addSender is non-fatal.
- **Branch 3 Pinia FPC cache won't help execute window** (separate document, separate Pinia instance). SW services should own warm state; popup stores can mirror, not own.
- **Branch 5 needs explicit field contract.** Current divergence:
  - In-flight (`RecentActivityView.vue:79-88, 291-304`): `title = app + method`, `subtitle = status`.
  - Submitted (`TransactionCard.vue:78-95, 127-131`; `tx-enrichment.ts:78-104`): `title = method`, second row = hash + dApp/call-count.
  - Use a single shared presentational layout, not per-renderer hand-alignment.
- **`RecentActivityView` filters journal entries by account only, not network.** Journal carries `networkId` (`operation-journal/spec.ts:41-57`), but view filters only by `accountAddress` / `tokenId` (`RecentActivityView.vue:113-119, 243-245`). Hidden coupling on multi-network profiles. Add network filter as part of Branch 5.

## NEW NITS

- Branch 1 log instrumentation should be temporary (remove before merge).
- Branch 5 phase text needs `aria-live="polite"` (current awaiting text is plain spans at `TransactionAwaitingCard.vue:27-30`).

## Branch verdict

- Branch 1: **minor tweaks** (suspect ranking, display-model approach).
- Branch 2: **minor tweaks** (test wording).
- Branch 3: **minor tweaks** (cache ownership, race expectation).
- Branch 4: **needs rework** (variant scoping, endpoint capture).
- Branch 5: **needs rework** (field contract, network filter).

## Test gaps

- Branch 1: component/e2e regression for raw-only notes from `NoteService.parseNote()` (the actual current shape).
- Branch 2: network-switch invalidation for sender status, not just add/delete.
- Branch 3: race test "unlock triggers warm + user opens fee card immediately"; profile-switch regression for gas cache key.
- Branch 4: endpoint change test, embedded-fee `aztec_sendTx`, `default_entrypoint` exclusion. Assert no double-run of planner/authwit on reuse.
- Branch 5: SW-restart / popup-close-reopen coverage proving `dapp_execute` journal records actually backfill the awaiting card.

## Suggested execution order

- Branch 4 does NOT depend on Branch 3 (reuse state can live in popup-local state).
- Move Branch 5 ahead of Branch 4 (Branch 5 is smaller; both touch `executeSendTransaction()` / `executeAztecSendTx()`, so landing 5 first reduces churn).

Recommended: 1 → 3 → 2 → 5 → 4.
