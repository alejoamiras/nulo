# Codex audit — fuel-l1-mint (`/blueprint light`, single audit, xhigh)

**Verdict: conditional approve** (conditions: narrow the handler-security claim; isolate mint UI state
from the shared fee-asset error; fix the "mint then fuel" happy-path default). No HIGH/Critical.

## MED
1. **[Inference] `FEE_ASSET() == FUEL_ASSET` is not an authenticity check.** A stale/malicious pinned
   handler can return the expected asset and still run arbitrary `mint(address)` logic — pinning the
   handler IS the trust boundary; the guard only proves config coherence. The plan's prose overclaimed.
   → **Adopted**: §4 narrowed (pinned address must be reviewed against the node value; guard is a
   consistency layer, not a substitute).
2. **[Ask] Default 12 < floor 16 dead-ends "mint then fuel".** `FuelForm` defaults the amount to 12
   while the configured floor is 16, so the happy path errors until the user edits it. → **Adopted**:
   §1 + Phase 2 bump the default to 20 (in scope).
3. **[Inference] Shared `error` ref.** `useL1FeeAsset` is shared with the deposit flow + has one `error`
   ref; a failed `approve()` or balance poll could read as a mint failure. → **Adopted**: Phase 1 uses
   dedicated `minting` + `mintError` refs.

## LOW
4. **[Fact] testids would collide** (BridgeView + FuelView both mounted under `v-show`). → **Adopted**:
   NEW testids (`fuelMintCard`/`fuelMintBtn`); §1 wording fixed (mirror shape/states, not testids).
5. **[Fact] "error toast" misstated** — the mint pattern is inline status text; Fuel-view journal
   toasts are disabled. → **Adopted**: §4 says inline error text.
6. **[Inference] "No cooldown getter" is weak evidence.** → **Adopted**: §5 reworded — graceful revert
   handling is the real safety, not ABI absence.
7. **[Ask] `mintAmount()` CTA + wrong-chain gate.** → **Adopted**: generic CTA copy (no live read);
   gate the button on connected AND Sepolia (don't copy MintTestUsdc's weak connect-only gate).

## Looks fine (affirmed)
- Pinning the handler in the same config as portal/asset is coherent (vs mixing node + config sources).
- The fail-closed cross-check is worth keeping as a consistency guard.
- Unit + component + smoke is the right validation depth for this testnet-only, light-scope feature.

Session: `019eee16-…` (transcript in this run's codex dir).
