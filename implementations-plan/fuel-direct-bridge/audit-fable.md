# Opus audits (the "fable" slot — Fable deactivated, run on Opus 4.8 per [[fable-deactivated-use-opus]])

Two Opus passes: an independent planning plan (Round 0, consolidated into plan.md) and a fresh hostile audit of the consolidated plan (Round 1). Both via the `Plan` subagent, `model: opus`, read-only repo access.

---

## Round 1 — Fresh hostile audit of the consolidated plan

**Verdict: CONDITIONAL APPROVE** — well-grounded and unusually honest, but three blockers must change before approval.

### BLOCKING

**B1 — schema-bump-to-3 rationale is factually wrong + a data-loss path.**
- The per-record `schema` field is **never read by the loader**: `parseRecords` (`journal.ts:145-152`) discriminates only on the storage-envelope `schema === 1` (hard-coded by `write()` at `journal.ts:176`) and on `direction`. Bumping the record field to 3 does nothing to prevent an old client misreading a record.
- The cross-deployment misread is already prevented by `deploymentMatches` (chainId+portal+bridge) — a Fuel record's `portal` = canonical FeeJuicePortal ≠ `L1_PORTAL`.
- Bumping the **envelope** schema to 3 would make `parseRecords`'s `parsed?.schema !== 1` hard check **silently drop every existing persisted record** (in-flight Bridge deposits/withdraws), including an in-flight private deposit's sole sealed recovery blob (`journal.ts:13-14`) → fund stranding.
- **Required:** keep the envelope at 1 and add `assetKind` as an additive optional record field (the loader already ignores unknown record fields) — i.e. the genuinely-additive change; OR specify a real read-both-versions migration + a regression test loading a v1 journal. As written the plan picks the higher-surface option on a false premise and omits the migration its own choice demands.

**B2 — DQ1 carrierless claim: I2 mislabeled "LOW", cited evidence misapplied.**
- The carrierless `privateMintAndPayFee().getExecutionPayload()` tx (2 fee-setup calls, zero app calls, feePayer=FPC) is not exercised anywhere in the repo.
- `useFaucetDrip.ts:63-67` documents the failure mode: a feePayer with no accompanying setup call is "rejected by the sequencer as 'Setup function not on allow list'." (Main's refinement: that warning is about an *empty setup* phase; the carrierless private case has a *populated, allowlisted* setup but an *empty app* phase — adjacent, not identical, but the empty-app shape is equally uncharted.)
- The fixture (`aztec-private-fpc-bridge.ts`) stops at the L1 message (~line 126); it never runs the L2 claim.
- `operation-planner.test.ts:213` tests `{calls:[], feePayer:undefined}` → `PREEXISTING_FEE_JUICE`, the *opposite* fee branch (Fuel = `{2 calls, feePayer:FPC}` → `"fpc"`). It is a counter-example, not support.
- `wallet.ts:277`/`base_wallet.ts:413` prove only that the *type* accepts a raw payload.
- The extension's `appCallOffset` model (`fast-path.ts:50-62`) assumes app calls follow the fee prefix.
- **Required:** relabel I2 to dominant; strike `operation-planner.test.ts:213` from Facts; Phase 1 must state it can prove construction + planner-routing only, NOT sequencer acceptance (no sequencer in jsdom) — so it cannot retire I2.

**B3 — re-homing `minFuelFj` must fix a latent fail-OPEN.**
- The only source of `minFuelFj` is `BRIDGE_FUEL` (`bridge-deployments.ts:34,49`); the floor guard is `if (BRIDGE_FUEL && received < BRIDGE_FUEL.minFuelFj)` (`useDeposit.ts:267`). Decoupling from `BRIDGE_FUEL` means that `&&`-shortcircuit **silently skips the floor** → a sub-cost claim proceeds → `mint_and_pay_fee` reverts (`amount >= max_gas_cost`) possibly after the FJ is minted at the FPC → stranding.
- **Required:** Fuel floor must be a mandatory, non-optional config value with a hard guard (no `&&` escape) + a unit test that a missing/zero floor fails CLOSED.

### NON-BLOCKING
- **N1** — Phase 4 shell refactor is correctly diagnosed but under-scoped: the foreground *state machine* moves (`formStage`, receipt snapshot, `releaseForeground` CAS), touching `BridgeView/Form/Journal/Stepper/Receipt`. The gate must include the withdraw provisional→exit **rekey** path (`useBridgeJournal.ts:248-253`) — the single most fragile interaction with a lifted owner.
- **N2** — backup validator is loose for the *existing* private-fuel extras (`bridgeSecretSalt`, `fpc`, `setupInsufficiency` not validated, `backup.ts:111-127`). Fold strict validation into Phase 2 (where backup is generalized), not Phase 5 — don't ship a generalized-but-loose validator.
- **N3** — Ask 3 (FPC re-canary) should *gate* the private live sign-off, not be independent (the 4.3.1-vs-4.2.0 pin mismatch, `private-fuel.ts:41`).
- **N4** — sealing the salt is a 4-file change (envelope type/seal/open/validate + `envelopeMatchesRecord`), not single-touch; `DepositEnvelopeV2` has no salt field.
- **N5** — validation-gate honesty: Phase 1 can't de-risk I2; Phase 3's "private happy" smoke-e2e (mocked wallet) proves flow-orchestration, not prover acceptance. Re-word both to name what they prove vs defer.

### Facts misstated (corrections)
- `operation-planner.test.ts:213` is a counter-example, not support (B2).
- "bump schema 2→3 … old client must not misread" — mechanism is wrong; loader ignores per-record schema (B1).
- "Evidence the SDK path accepts it" overstates `wallet.ts:277`/`base_wallet.ts:413` (type-accept ≠ prover-accept) and the fixture (L1 half only).

### Inferences
- I2 → reclassify HIGH/dominant (no repo artifact exercises a carrierless claim; `useFaucetDrip.ts:63-67` documents the adjacent failure mode).
- I1 → agree with the N1 caveat (the foreground-owner lift is the real regression risk; rekey path must be gated).
- I3 → confirmed plausible; runtime `UNDERLYING()` cross-check is the right belt-and-suspenders.
- I4 → confirmed correct (portal event).
- I5 → a 4-file change, not single-touch.
- New: decoupling the floor removes a guard that currently fails OPEN (B3).

### Asks
- Ask 1 → tie deferred sign-off to the fact that Phase 1 cannot retire I2.
- Ask 3 → elevate to a gate on the private live sign-off.
- Missing Ask → migration policy for existing persisted records if the envelope schema is touched (B1).

---

## Reconciliation note (main)

Round 1 (fresh Opus) and the codex combined review (audit-codex.md Round 1) **converge** on B1 (additive `assetKind`, no envelope bump), I2 (dominant risk), and the salt-sealing scope. Codex adds three blockers Opus did not: the locked-decision re-opening (drop Ask 1's scope fallback), the Phase 4 gate not testing the bug (need App-level multi-tab smoke), and the Phase 5 `audit:vue` gate being extension-scoped. All folded into the plan.md revision below the audit verdicts (§9–§10).
