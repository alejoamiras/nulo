# Codex post-implementation audit — `deprecate-simulate-views`

Model: GPT-5.x via `codex exec` (xhigh). Date: 2026-05-24.
Session ID: `019e5aff-661a-7491-b10f-7497a32aa1d4`
CODEX_DIR: `/var/folders/p9/.../codex-8qN7PGMx`

## Verdict

> Merge-ready. I did not find a behavioral regression in the implementation itself.

Zero MUST-FIX. Two DEFERRED items applied as polish before merge.

## Findings

### MEDIUM

**FI1** — `encoded_call` sender-hiding parity is implemented but the unit test never reaches the branch. The "hideMsgSender propagates for 'encoded_call'-kind tx-typed" test at `batched-view-simulation.test.ts:303` intentionally dies with `Method not found` at lines 332-334. The tx-typed `encoded_call` branch in the helper (`batched-view-simulation.ts:272`) is unpinned at the unit level, and the integration file that claims to cover the wire contract is still all `test.todo`.

**Fix applied**: replace the fake failing test with a real selector-matching one (the mock selector factory returns `selector-${name}` — pass that as the input selector). Also add the missing `encoded_call` utility `hideMsgSender=false` case.

### NIT

**FI2** — Unused `_index` parameter on `enqueueCall` at `batched-view-simulation.ts:193`. Harmless but dead weight.

**Fix applied**: drop the param.

## READY

- Parallel-launch + serial-await preserved at helper:122; concurrency test is meaningful (not a tautology).
- Origin-quirk and all four implementation branches present (helper:157, :211, :254, :272). Both origin tests exercise both layouts.
- `previewedInterface` stays out of wallet-bridge; lives only in extension-local `MaterializedRegisterTokenOperation` at `models/index.ts:64`. Popup attaches in approve mapper at `execute/index.vue:340`.
- Cleanup landed: no `simulate_views` branch in `OperationCard.vue`, `SimulateViewsRequest` gone from `dapp-interaction/spec.ts:11`, stale comments updated in `balance-projector.ts:1` and `dispatcher.ts:171`.
- `materialize.ts` leaves `register_token` alone aside from retired-case removal at line 90.
- FC6 correct: getter at `execution/service.ts:260`, `BalanceProjector` uses `this.execution.contractResolver` at `balance-projector.ts:136`.
- Line-by-line vs old `executeSimulateViews`: no missed quirks around contract registration order, `account.ensureRegistered`, return extraction, or decode-failure isolation.
