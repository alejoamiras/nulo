# private-fuel — codex audit transcripts

Codex planner session `019ec2c2`. Round 1 = independent plan ([draft-codex.md](draft-codex.md)).

## Round 2 — contradiction-check of the consolidated plan (verdict: fail → fixed)
- [OK] L5: code-traced the verbatim payload merge (`contract_function_interaction.ts:100-112` merges `paymentMethod.getExecutionPayload()`; `mergeExecutionPayloads` keeps the unique feePayer `execution_payload.ts:37-60`; dispatcher forwards `exec` `dispatcher.ts:539-543`; planner iterates `exec.calls` then EXTERNAL `operation-planner.ts:198-239`). Dedicated `private_fjwc` NOT needed.
- [GATE-GAP] P2's L5 proof rested on manual smoke — `audit:vue` excludes network/e2e, the layer that exercises extension transport/sim.
- [CONTRADICTION] L7 sequencing drift — P3 dropped forced Sponsored before P4 proved cold-start safety.
- [GATE-GAP] P4 can't validate no-fuel — `fuel-testnet.ts` is a fueled harness, not the no-fuel extension popup path (where Sponsored auto-select lives, `FeeSettingsCard.vue:241`).
- [OK] L8 additive fields fine given P0 fixes the root-schema bug.

verdict: contradiction-check: fail (blocking: P2 doesn't auto-prove L5's EXTERNAL cold-start; P4 can't validate L7's no-fuel fallback).

### Resolution (this revision)
L12: P2 gains a `tests/e2e/network` cold-start private-fuel case (real extension) — L5 auto-proven, not manual. L13: P3 keeps a guarded Sponsored fallback + a no-fuel cold-start network-e2e gating the removal (not deferred to P4). L4/L8 unchanged. P4 reframed as the mechanism canary (it bypasses the extension).

## Round 3 — double audit (verdict: reject → fixed)
- [CRITICAL] private insufficient-fuel routes to the public sponsored-standalone ladder (`useDeposit.ts:126-180`, `fuel-claim-state.ts:79-82`) — incompatible with fuelRecipient=FPC + the "never Sponsored/public on the private path" invariant.
- [HIGH] FPC-address drift protection is a dev gate; the runtime fail-closed check is deferred to P5 — ship it with P3/P4.
- [HIGH] "wallet auto-selects Sponsored" is popup-UI behavior (`FeeSettingsCard.vue:249`), not a wallet/sdk invariant — overstated trust.
- [HIGH] P3's gate doesn't test the private insufficient-fuel branch.
- [MED] stale L7 text ("proven P4" after L13 moved it to P3); add a backup restore-roundtrip gate for the new salt fields.
verdict: reject (private insufficient-fuel recovery not safe; runtime/version-drift protection deferred too late).

### Resolution (revision 2) — see audit-opus.md (the two double-audits converge); folded as L11 rewrite (fail-closed + private recovery), L15 (runtime kill-switch in P3/P4), L13 rewrite (Sponsored mandatory for cold), L16 (playground-extension scoped), P3 insufficient-fuel e2e + backup roundtrip, stale-text fixes.

## Round 4 — FINAL fresh-context gate (NEW session 5tYfc5dl; verdict: conditional approve → conditions folded)
- [HIGH] L11 must bind sufficiency to `minFuelOutput`+`fuel.received` (not a soft quote) → require pre-deposit `minFuelOutput >= requiredBudget` + pre-claim `fuel.received >= requiredBudget`, requiredBudget from the explicit gas settings.
- [HIGH] private retry scoped to SETUP-insufficiency only; an INCLUDED app-revert consumes the FJ (`fuel-claim-state.ts:63`) — receipt-authoritative for everything else.
- [MED] L15 fail-STOP, no silent private→public downgrade.
- [MED] P2 harness: pick one (→ extend the playground).
- "No remaining public/Sponsored recovery leak is evident if L11 is narrowed as above." Facts/Inferences sound.
verdict: conditional approve (conditions: floor/received budget, setup-only retry, L15 fail-stop, P2 harness). ALL FOLDED in this revision.
