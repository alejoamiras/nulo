# Fable audit — account-artifact-freeze (mid tier, independent leg)

Independent top-tier Claude reviewer (Plan-agent session, Fable), hostile-audit brief, on draft
v1 with the competing Outline B, repo at `dev` @ `cff0ba2`. Claims below were re-verified in-tree
by the drafting agent before adoption (smoke-config include list, `@aztec/accounts` artifacts
dir, upstream dist ctor-args/immutables code — all confirmed).

## Verdict

`conditional approve (with conditions: add a per-bump execution-compatibility gate against the
vendored artifact; fix the Outline-B-inconsistent supply-chain claim; if A is chosen, Phase 2
must also swap the execution-side ctor-args source; correct the freeze-boundary table rows listed
below)`

## Findings (verbatim)

**1. [Critical] The vendored artifact is execution-load-bearing, and no gate proves execution
against it after a bump.** The plan treats the artifact as an address input, but
`nulo-account.ts:37` makes it `this.artifact`, which is registered into the PXE for
simulation/proving (`nulo-account.ts:101`) and mined for the ctor call on first-tx deploy
(`nulo-account.ts:199-221`). After vendoring, every future `@aztec/*` bump runs a NEW
simulator/ACVM/bb and NEW `@aztec/entrypoints` payload encoding against FROZEN 5.0.1 bytecode —
a combination upstream never tests. If `DefaultAccountEntrypoint`'s payload/authwit encoding or
the ACIR format moves within 5.x, the wallet passes every plan gate and then fails at tx time —
strictly worse than address drift. Phase 6's `test:e2e` cannot catch this: `vitest.e2e.config.ts:11`
includes only `tests/e2e/*.test.ts`; the proving/tx tests live in `tests/e2e/network/` (a
separate workflow). Required: the aztec-update skill (Phase 5) must mandate the network-e2e
send/prove suite (e.g. `tx-sendTx-multicall.test.ts`, `authwit-variants.test.ts`) on every bump
as the vendored-artifact compatibility gate, and Phase 6 should state smoke is NOT sufficient for
this risk.

**2. [High] The supply-chain claim is false under Outline B.** Security section: "after this plan
the npm package no longer feeds address derivation at all." Under B (and under A-as-drafted
before Phase 2 lands), `constructorArgs` and `immutablesHash` still come from the npm
`SchnorrAccountContract` (`nulo-account.ts:61-72`) and feed
`getContractInstanceFromInstantiationParams`. The section silently assumes A while the ledger
keeps A/B open. Reword, or close the ledger first.

**3. [High] Outline A as drafted creates an address/execution split-brain.** If Phase 2 freezes a
local copy of the instantiation inputs but `buildWithInitialization` keeps calling upstream
`getInitializationFunctionAndArgs()` (`nulo-account.ts:206-210`), an upstream change makes the
on-chain ctor args diverge from the frozen `initializationHash` — bricking first-tx deploy while
all KATs stay green (KAT never exercises `buildWithInitialization`). If A is chosen, both call
sites must use the frozen source.

**4. [Medium] Outline A's benefit is overstated; pick B.** I verified the "upstream class code"
at stake: ctor name literal + `constructorArgs = [pubkey.x, pubkey.y]` via
`Schnorr().computePublicKey` (`accounts/dest/schnorr/account_contract.js`), and
`getImmutablesHash()` returning `undefined` → `Fr.ZERO` default
(`defaults/account_contract.js:11`, `contract_instance.js` `opts.immutablesHash ?? Fr.ZERO`). The
only nontrivial input is a curve operation the plan forbids copying either way — so A's "~50
lines of frozen marshalling" removes near-zero real exposure while adding the finding-3 trap and
permanent dual-source maintenance. B + KAT tripwire + the finding-1 gate is the right production
posture. I2's framing ("A removes the exposure entirely") is wrong.

**5. [Medium] Freeze-boundary table gaps.** (a) `initializationHash` is absent as a row: it
hashes the ctor selector (from artifact ABI, `FunctionSelector.fromNameAndParameters`) + args via
upstream `computeInitializationHash` — partially artifact-frozen, partially protocol-level. (b)
The vendored JSON passes through `loadContractArtifact` + `getContractClassFromArtifact`
(upstream) before becoming a class id — the JSON digest freezes bytes, not the transformation;
the class-id pin is a tripwire, not a freeze, and the table's "frozen by: vendored JSON +
class-id pin" overstates. Phase 1 should specify vendoring the RAW `SchnorrAccount.json` (npm
ships it at `@aztec/accounts/artifacts/`) and pinning the post-load class id. (c) `deployer`
defaults to `AztecAddress.ZERO` inside upstream code, not ours — a row worth adding.

**6. [Medium] I1 conflates two claims.** "Node never re-derives our address" is true-ish, but the
account contract IS published/executed on first tx (`buildWithInitialization` multicall deploy).
The real assumption is "old bytecode remains simulatable/provable by newer client tooling against
an unchanged network" — exactly the finding-1 gap. I1 should be restated in those terms.

**7. [Low] ACK mechanism: load-bearing but improvable for ~3 lines.** The `IMPORT_BLOCKING_ACK`
precedent (`backup/footprint-coverage.test.ts`) is real; on a branch-protected repo the tuple
test does force intent into the reviewed diff. Cheap upgrades: CODEOWNERS entry for the artifact
dir + freeze module, and embed `FROZEN_ARTIFACT_SHA256` inside the `ROTATION_ACK` string so a
stale ack can't survive a rotation.

**8. [Low] Phase 4 call-site coverage unstated.** `getAccountContract` is reached from multiple
signing/balance paths (the backup-hardening audit relies on it throwing everywhere); the plan
should enumerate which surfaces render the new state vs. propagate the typed error.

**9. [Low] Naming.** `ADDRESS_REGIME "nulo-v5"` vs `AccountType.Nulo_v1` / `name = "nulo-v1"`
(`nulo-account.ts:35`) invites confusion; pick one scheme.

## What looks right (verbatim)

- Facts 1, 3, 5, 6, 7 all check out: throw at `service.ts:200` with no test hits; UPDATE.md line
  9 says 5.0.0 vs 5.0.1 pins; `vite.shared.ts:46-47` aliases; `IMPORT_BLOCKING_ACK` exists.
- KAT is genuinely reference-generated with regeneration forbidden
  (`derivation-vectors.test.ts:9-17`) — the "KAT unchanged = byte-equivalent vendoring" gate in
  Phase 1 is sound.
- No-delete-CTA reasoning, phase ordering, and riding `quality-status` instead of new CI surface
  are all correct calls.
- Rejecting the pin-only posture is right given the stated goal.

## Disposition (by the drafting agent)

All conditions adopted (see plan.md Decision ledger): finding 1 → Phase 4 (later hardened by the
final codex pass into a dedicated canary test); findings 2/5/6 → Security + freeze-table
rewrites; finding 3 → the dual-site descriptor (which also resolved finding 4's objection to A —
the adopted "revised A" is not a shadow class; the A-vs-B disagreement with codex is surfaced as
Ask A3); finding 7 → ack embeds the artifact sha + CODEOWNERS-as-intent-marker; finding 8 →
Phase 5 enumerates consumer paths; finding 9 → naming aligned in implementation (regime id
scheme follows the account-type family).
