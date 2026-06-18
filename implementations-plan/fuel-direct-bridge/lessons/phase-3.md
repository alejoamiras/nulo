# Phase 3 — Direct fee-asset deposit + public & private claims (IN PROGRESS)

Slices (committed as they land): useL1FeeAsset ✓ (`1955300`) · salt-seal ✓ (this commit). Remaining: `fuelClaim.ts` + claim-dispatch wiring · `useFuel` deposit + the record-shape fields · tests + smoke-e2e.

## Codex consult — claim-dispatch wiring (session 019ed9aa, xhigh)
**Decision: Option C.** The fuel claim must plug into the ONE journal `claim` dep (wired by `useDeposit`), without a `useDeposit ↔ useFuel` cycle.
- New non-composable `fuelClaim.ts` (`buildFuelClaimInteraction(rec, { aztec, sponsoredFpc, … })` → `{simulate, send}`); imports ONLY bridge-core/SDK + takes wallet/FPC/config as args (no faucet singletons).
- `useDeposit`'s `claim` dep dispatches by `assetKindOf(rec)`: `"fee-juice"` → `buildFuelClaimInteraction`, else the existing token claim. Keeps the seam at `deps.claim`; doesn't bloat useDeposit with a second protocol inline (rejected option A) and avoids a broad shared-module refactor (rejected option B).
- Rename + export `wireDepositDeps()` → `ensureDepositJournalDeps()`; `useFuel` calls IT (NOT `useDepositFlow()`, which also installs the `resumeSessionWork` `watch(immediate:true)` side effect, `useDeposit.ts:847`). Wired closures read wallet refs lazily ⇒ wiring early (before wallets connect) is safe.
- Acyclic: `useFuel → useDeposit → fuelClaim → bridge-core`; `useFuel → useBridgeJournal`; nothing points back to `useFuel`.
- **Test gotcha:** `__resetJournalForTests()` does NOT reset useDeposit's module-local `depsWired` — add a matching reset/export for `ensureDepositJournalDeps` in tests that need re-wiring.

## Record-shape decision (mine, logged — no codex spend; natural given Option C)
A **direct fuel record is a deposit whose asset is Fee Juice** — top-level claim fields, NO `fuel` sub-block (that block is swap-specific: `minOutput` etc.). Since the claim lives in the new `fuelClaim.ts` (not the reused token-claim logic), reusing the fuel block bought nothing and forced a meaningless `minOutput`.
- `direction:"deposit"`, `assetKind:"fee-juice"`, `portal=FUEL_PORTAL`, `bridge=feeJuiceAddress` (the Phase-2 binding), `amount`=FJ amount, `recipient`, `leafIndex`=portal `DepositToAztecPublic.index`.
- PUBLIC: `secret` plaintext top-level (recipient-bound), claimed via `FeeJuice.claim_and_end_setup` (sponsored).
- PRIVATE: `secret` undefined (re-derivable); add top-level `bridgeSecretSalt` + `fpc`; the claim rebuilds `secret = deriveBridgeSecret(bridgeSecretSalt, recipient)`; claimed via the carrier-less `BatchCall([])` + `privateMintAndPayFee` with explicit `maxFeesPerGas` + `teardownGas=0` + the fail-closed floor + the FPC-drift kill-switch.
- **Salt recovery:** unlike swap-fuel (plaintext salt + a TODO), the direct private-fuel salt is the SOLE recovery input, so it IS sealed into `DepositEnvelopeV2.salt` (this slice) in addition to the plaintext same-session copy.
- Next slice adds the top-level `bridgeSecretSalt?`/`fpc?` fields to `DepositJournalRecord` + their `validateBackupRecord` coverage.

## Salt-seal (this commit)
`DepositEnvelopeV2` gains an optional `salt`; `openDepositEnvelope` validates it (optional string, rejects non-string); a no-salt envelope still opens (back-compat). bridge-core 128 green.
