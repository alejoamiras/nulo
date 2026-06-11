# Phase 0 — Characterization safety net

## Landed

- `packages/extension/src/wallet/services/execution/service.characterization.test.ts` — 21 tests:
  - Fingerprint BYTE-stability pins (`fingerprintBaseFee` → `"<da>:<l2>"`; `fingerprintFeeSettings` → exact `"<pmHash>|<priority>"` per variant). These lock the cache-compare contract Phase 4's extraction must preserve.
  - ALL observable exits of `tryConsumeTransferEstimate` (audit R1-M1 enumeration): unknown id, single-shot re-consume, TTL stale, input drift, fee-settings-hash drift, profile drift, no active profile, no primary endpoint, primary endpoint changed, base-fee drift, base-fee fetch failure, pending-set drift, happy path.
  - `cancelJob` journal-first ordering: FSM-accept → abort + deregister; FSM-reject → signal dropped, controller untouched.
  - `getGasBalances` cache contract: fresh-hit short-circuits before any dependency access (proven via null! collaborators), TTL-stale bypass, forceRefresh bypass, single-flight promise sharing.
- `packages/extension/src/wallet/services/execution/fee/fee-structural-parity.test.ts` — 11 tests (audit R1-H2 structural net): `suggestGasLimits` 4 branches + `finalizeGasLimits` all fee-resolution paths, using distinct sentinels in every same-typed slot (a da/l2 or gas/teardown transposition fails loudly; the computed-fee test documents WHY: a swap yields 1_332n where 1_110n is pinned).

## Parity contract for Phase 3 (the four tails)

Tail sites (verified `service.ts` at arc baseline, 2,302 lines):
| Path | Tail lines | scopes arg | Failure handling |
|---|---|---|---|
| executeTransfer | 550-567 | `[account.address]` | catch → `maybeRethrowAsRpcCancel(error, transferTask)` (:603) |
| executeSendTransaction | 1181-1190 | `[account.address]` | hand-rolled: `JobCancelledSentinel` rethrow + `markJournal(failed)` (:1205-1209); **acquires NO execution slot** (bug-pin target) |
| executeAztecSendTx | 1976-1986 | `[account.address, ...sendAdditionalScopes]` | sentinel rethrow + markJournal failed; slot held |
| executeNoFromSendTx | 2166-2176 | `scopesWithAccount` | sentinel rethrow + markJournal failed; NO_FROM also has 3 distinct scope sites pre-tail (:2107-2124) |

Confirmed divergences (helper must NOT absorb these — success-path-only ownership per plan):
- Failure shaping differs (`maybeRethrowAsRpcCancel` vs raw sentinel checks).
- Task-completion ownership differs per path.
- Receipt shaping exists on only 2 of 4 paths (:2000-2004, :2190-2194).
- Offchain-output extraction happens BETWEEN prove and `toTx()` on dApp paths (:1978-1980) → `wantOffchainOutput` hook.

## e2e coverage check

- Journal-stage e2e assertions (commit `989e4be`) cover the dApp sendTx family; transfers covered by `transfers.test.ts`.
- `executeSendTransaction`'s auth-registry callers (revoke, `setRegistryEnabled`) have NO e2e — known + accepted per resolved Ask A4 (unit pins + P8 manual QA are the gate).
- Baseline `e2e:agent` flake-profile run: recorded below.

## Deviations from plan text

- `getEstimatedFee` / `getGasDetails` / `pickActionMethod` are module-private (not exported); Phase 0 allows zero src changes, so direct characterization is deferred to the phase that moves them (P4 export makes them importable). Their projection math is partially pinned via the structural fixtures (maxFee/gasDetails read the same gasSettings slots).
- Full per-strategy fixtures (call ordering, authwit counts via faked TxRequestBuilder) land as Phase 2's FIRST commit — they are the tripwire for the tuple→object conversion itself; helper-level structural pins (above) precede any fee-touching phase either way. P1 (resolver) touches no fee shapes.

## Baseline

- Facade: 2,302 lines (`wc -l service.ts`).
- Suite before: 2,242 extension tests; after Phase 0: +32 (21 characterization + 11 structural parity).
- Baseline e2e:agent: PENDING_RESULT_PLACEHOLDER

LESSONS_FILE=implementations-plan/execution-decomposition/lessons/phase-0.md
