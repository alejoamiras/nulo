# Phase 3 — faucet: B-presets UI + private claim/recovery

Status: **in progress.** P3-A (UI) implementing; P3-B (claim/recovery) spec locked via codex.

## Codex P3-B decision (session 019ec69a, xhigh) — recovery/fee routing
**Verdict: Option A** — branch on `rec.isPrivate` at the TOP of `useDeposit.ts`'s `claim` dep: an entirely
separate private path that builds `privateMintAndPayFee(...)` + explicit gas, with its OWN minimal
recovery, NEVER touching `decideFuelClaim` / `sendStandaloneFjClaim`. The public L14 ladder stays
byte-stable. (Option B — extending `decideFuelClaim` with `isPrivate` — rejected: it is public-biased
[`sponsored-plus-standalone-fj`, fee-spike heuristic] and mixing private in is the bigger regression risk.)

Folded into the plan as the P3-B implementation rules:
- **L1 deposit leg (CRITICAL, do first):** for private, `fuelRecipient = PRIVATE_FPC_ADDRESS` (not user — `:481/:509`),
  `fuelSecret = deriveBridgeSecret(salt, claimer)` (not `Fr.random()` — `:375`), and WRITE the journal's
  `bridgeSecretSalt`/`fpc` (currently unwritten). Privacy/recovery is broken before the ladder if this is skipped.
- **Consumption signal:** the overall claim tx receipt becoming INCLUDED — NOT a sim/send failure. If the
  bundled tx lands and `claim_private` app-reverts, setup already ran ⇒ FJ consumed at the FPC. Persist
  `claimAttempt`/`claimTxHash`, wait for receipt, mark consumed on inclusion, NEVER route to public.
- **Retry allow-list (narrow):** retry the private FPC claim ONLY if there is NO tx hash/receipt AND the
  error matches the exact `mint_and_pay_fee` insufficiency form. Otherwise fail closed to wait/user-retry —
  never auto-fallback to public/Sponsored. (No typed selector exists; treat the string-match as a narrow allow-list.)
- **No-fuel (L7):** make `fee` OPTIONAL and OMIT it entirely (`:214` currently defaults to sponsored). Omitting
  resolves wallet-side to `PREEXISTING_FEE_JUICE` = self-pay from existing public FJ (NOT sponsorship —
  `operation-planner.ts:234`, `materialize.test.ts:114`). Detect "cold" via a `balance_of_public(recipient)`
  read; zero ⇒ BLOCK with guidance.
- **Journal retry path (`useBridgeJournal.ts:662`):** must not re-embed private fuel after any INCLUDED prior attempt.
- Gas-settings pass-through + PROPOSED-not-inclusion + receipt-normalization reuse: confirmed fine.

## P3-A — BridgeForm.vue B-presets (this iteration)
Design from the approved mockup (`../swap-fuel/fuel-privacy-ux.html`): two preset cards "How it arrives" —
PRIVATE (default) + PUBLIC — with fuel as a shared add-on below (now enabled for BOTH; gas-follows-token).
- `isPrivate = ref(true)` (private default); delete `watch(isPrivate → fuelOn=false)`; drop the `!isPrivate`
  fuel gates (toggle `v-if`, fuel-config `v-if`, onSubmit fuelSlice); remove the "private gas is coming" note;
  add the "+ private gas — claimed with your tokens, fully private" note; submit label "BRIDGE PRIVATELY TO AZTEC".
- testids: + `bridgePresetPrivate` / `bridgePresetPublic` (cards replace the single privacy toggle).
- Test migration (~9 cases across `BridgeForm.test.ts` + `BridgeForm.fuel.test.ts`): public→private default
  inverts; `bridgePrivacyToggle` clicks → card clicks; the two guard tests (private→fuel-off, private→no-fuel-note)
  invert to "private CAN carry private fuel".

## P3-B progress (loop fire 2)
- **Deposit leg DONE** (74baa9b): private fuel routes `fuelRecipient=PRIVATE_FPC_ADDRESS`, the secret is
  `deriveBridgeSecret(salt, claimer)` (not random), and `bridgeSecretSalt`/`fpc` are written to the journal
  fuel block. Public path byte-identical. faucet typecheck + biome green.
- **Claim branch NEXT** (the Option-A private path in `useDeposit.ts`'s `claim` dep). Two research items to
  resolve FIRST (don't guess — L14-critical per codex):
  1. **gasSettings passing:** how does the faucet supply explicit `maxFeesPerGas` (current-min) + `teardownGas=0`
     through `bridge.methods.claim_private(...).send({ from, fee })`? Wonderland's method `getGasSettings()` is
     undefined; the extension's `applyEmbeddedFpcGasCap` fills `maxFeesPerGas` from node min-fees when omitted but
     does NOT zero teardown. Verify the SendOptions/fee gasSettings shape (check the extension's send path +
     aztec.js). A non-zero teardown can break `mint_and_pay_fee`'s `gasLimits*maxFeesPerGas <= amount` assert.
  2. **insufficiency classifier:** the narrow retry allow-list needs the exact error shape of a pre-inclusion
     `mint_and_pay_fee` insufficiency (no typed selector exists — string-match). Find the failure form; default
     fail-closed to `wait` otherwise. NEVER public/Sponsored.
- Budget gate: use `fuel.received >= BRIDGE_FUEL.minFuelFj` (calibrated 2x-fee floor) as the conservative
  pre-claim fail-closed proxy; refine to `requiredBudget = maxGasCostFor(explicit gas)` once (1) is known.
- WIP note: until the claim branch lands, a private+fuel deposit writes to the FPC but the claim still hits the
  public ladder (would fail, not leak — the FJ is FPC-bound). Branch-only intermediate; not shippable yet.
