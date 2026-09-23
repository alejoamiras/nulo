# Arc 7 — restore-stage-2 (F-Q02) — plan draft (pre-homing)

[mid] tier. Quality arc: ZERO behavior change. Spec constraint (Q-02 verifier, verbatim): account-provenance filtering and token relinking share the deliberately-hoisted `importedChainAddress` Set — "they must stay together or be threaded explicitly… Stage it; do not attempt the whole closure."

## Recon verdict (full stage map in recon.md)

`restoreBackup` (`useFullBackupImport.ts:351-878`, 528 lines): stage 1 (`validateAndMigrateBackup`) already extracted (#396); stages A (profile) → B (networks+index-pairing) → C (accounts+provenance) → D (tokens+relink) → E (6-client services loop) → F (finalize) → G (account-state/chain-sync) → finish, plus a cross-cutting outer catch (rollback orchestration — materially EVOLVED since the finding: #400 added the RestoreStage markers at every boundary, #403 the liveness-gated rollback) and outer finally (client disconnects).

Cross-stage couplings (the extraction-blocker profile):
1. **`importedChainAddress`** — written ONLY in Stage C (:582, successful accounts), read in C (:611 tx filter) and D (:704 token-balance chain-equality). The named hard constraint.
2. **`createdNetworks`** — written in B (:504), read in G (:796) — a second, structurally identical long-range coupling the spec didn't name.
3. **`createdProfileId`/`finalizeStarted`** — written in A (:485) / F (:756), read only by the outer catch — spans the whole closure; NOT stage-local.
4. Threaded clients (`profileService`/`networkService`) read in nearly every stage AND the outer finally; `rollbackCreatedProfile` closure used by B/C failure paths; `restoreStage` marker writes at every boundary (pinned as an ordered sequence by the phase-observability suite).

Coverage: entirely black-box through the whole closure; the C→D Set cross-check IS covered end-to-end (the P3 chain-distinct tests); inter-stage CONTRACTS are unpinned (nothing asserts what a stage returns — they're closure locals).

## Chosen staging — extract C+D as ONE unit; the Set becomes structural

**Extract `restoreAccountsAndRelinkTokens(...)`** — stages C and D as a single module-level function (the `validateAndMigrateBackup` precedent): inputs `{data, accountClient, tokenClient, recordRestoreErrors}`; the `importedChainAddress` Set becomes an INTERNAL local of the function — the coupling the verifier feared losing becomes impossible to lose by construction (it never crosses a boundary). Control flow honored via a discriminated result: `{kind:"ok"} | {kind:"duplicate-account", error} | (throw → outer catch unchanged)` — Stage C's duplicate-rollback early-return maps to the caller acting on `"duplicate-account"` exactly where it does today; the rethrow path stays a throw. `restoreStage` marker writes stay in the CALLER at the same boundaries (the ordered-sequence pin must stay green unmodified). All in-place `data` mutations preserved verbatim (the function mutates the same object it is handed, as today).

**Explicitly NOT extracted in this arc** (staging discipline): A (ceremony + rollback bookkeeping writes), B and G (the `createdNetworks` long-range pair — the NEXT stage after this one, recorded as such), E (cheap but valueless alone), F (writes `finalizeStarted` read by the outer catch), the outer catch itself (just evolved twice today — let it settle).

**New contract pins (phase 1, before the move):** a direct-call describe for the extracted function mirroring `validateAndMigrateBackup`'s: provenance filter drops foreign tx/authwit/balances; chain-equality drops cross-chain grafts (the Set working end-to-end INSIDE the unit); duplicate-account → `"duplicate-account"` result; non-duplicate error → throw; `data` mutated in place. Existing black-box suites stay green unmodified (the real proof).

## Competing outline (for the audit)

Extract Stage E instead (the least-coupled leg) — cheaper, but it characterizes nothing the finding cares about; or pins-only + reject. The audit judges whether C+D-as-one-unit is the right "stage 2".

## Audit ledger — the dual audit REJECTED the combined unit; the SEPARATE-extraction redesign shipped

**Codex: `reject`** with three boundary impossibilities in the one-call design — the `restoring:tokens` marker writes BETWEEN C and D (no caller-side point to write it); `TokenServiceClient` is constructed only AFTER C succeeds (an eager two-client signature creates a connection that never existed on duplicate/rethrow paths); the C `finally accountService.disconnect()` cannot keep its rollback-relative ordering from inside a combined unit. Plus the decisive coverage catch: **the plan's "the C→D cross-check is covered end-to-end" claim was FALSE** — the existing "different chains" test imports the address on BOTH chains, so it stays green even with the chain-equality check deleted. Codex's required redesign: extract C and D SEPARATELY; C returns `{importedChainAddress}` (the Set as an explicit value); D requires it; clients, stage writes, catch/finally frames all stay in the caller at their exact current lines; the account catch covers ONLY C; error identity preserved.

**Fable: `conditional approve`** of the combined unit — but its three blocking findings were the SAME three boundary hazards, to be managed *inside* the unit (thread the stage ref, unit-owned client construction reproducing both try/finally spans, explicit B3 disposition). It argued threading the Set "re-exposes the mutable alias".

**Reconciliation (SIMPLER wins):** the designs disagree; the same three hazards either DISSOLVE (codex: caller skeleton untouched) or must be MANAGED (fable: ref-threading + internal lifecycle reproduction). The verifier's constraint explicitly permits "threaded explicitly", the threaded value crosses one immediately-consumed boundary in the same function, and the seam becomes directly testable. **Codex's separate-extraction design adopted**, incorporating fable's applicable demands (error identity on rethrow — pinned with `rejects.toBe(sameInstance)`; the dropped-balances append stays in the caller at its exact point, insertion order unchanged; no marker hoisting — trivially satisfied).

## Shipped

- `restoreAccountsAndFilterOwnedSlices(data, accountService, recordRestoreErrors): Promise<Set<string>>` — stage C's try-body verbatim (module-level, beside `validateAndMigrateBackup`); returns the allow-set. Caller keeps: client construction, try/catch (duplicate-account rollback at the same point, rethrow identity), finally disconnect, stage markers — all at their original lines; the hoist comment now names the return/require contract.
- `relinkRestoredTokenBalances(data, newTokens, importedChainAddress): dropped[]` — stage D's relink block verbatim; REQUIRES the Set as a parameter; mutates `data["token-balance"]` in place; returns dropped rows — the caller appends them to `restoreErrorLog` at the exact original point.
- **Pins**: codex's required black-box chain-equality pin (address imported ONLY on chain 1, token on chain 2 → dropped + diagnostic — the case the old suite could not distinguish from check-deletion); direct-call contracts for both units (allow-set from successful accounts only; in-place filtering of all three slices; rejection identity `toBe`; index re-link + failed-token + chain-mismatch drops). All 65 pre-existing black-box pins green UNMODIFIED.
- **NOT extracted** (recorded as the next stage): A, B+G (the `createdNetworks` pair), E, F, the outer catch (evolved twice on 2026-08-18).

## Process
Mid tier: dual audit done (above) → end-diff codex pass. Validation: repo gates + audit:vue + **armed smoke** (arc-7 requirement).

## End-of-arc codex diff pass: `conditional approve` → condition met → CONVERGED

No blocking code findings. Verified: moved bodies semantically equivalent (formatting + one type-only cast noted); the `ReadonlySet` hoist safe on every path (D reads an empty Set only after a successful C with no qualifying accounts — matching prior behavior); the bare-Set return endorsed over its own earlier discriminated shape ("since duplicate classification never left the caller, a discriminated result would require moving behavior merely to recreate it"); **the new black-box pin verified REAL** ("removing chain membership makes the balance reach `tokenBalanceClient.restore` and removes the diagnostic, failing both assertions"); caller skeleton (clients, markers, catch scope, rollback ordering, disconnects, error identity) intact; nothing smuggled. Condition: commit the build-regenerated auto-import artifacts — done (`chore(types)` commit).
