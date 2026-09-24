# Fable audit transcript

Two legs, both top-tier Claude (Fable role, run on Opus 4.8 while Fable is deactivated — capability matters, not the literal name).

## Leg A — independent plan draft (Phase 1 fable planner)

See draft consolidated into plan.md decision ledger; the planner also served the contradiction-check round (contradictions-found (8), F1-F8 folded).

## Leg B — FRESH hostile auditor (no prior context, double-audit round)

I have verified the plan's core claims against the code. Here is my hostile assessment.

---

# Hostile security audit: bridge-permit2-recipient-commitment

I verified the load-bearing claims against the actual repo. Most of the plan's factual assertions check out (the router `bridge()` entrypoint, the interface identity, the one-shot `set_bridge`, the config-constant claim path, the `bridge()` unit tests, the envelope `salt` field, the AZLO Permit2 override). The (c) recipient-binding argument is, to my analysis, **cryptographically sound**. But the plan oversells several safety claims, and there are real gaps its prior reviewers did not surface because they were reasoning from inside the plan's own framing. Findings below, ranked.

## What actually checks out (so I'm not accused of hand-waving)

- `bridge()` exists, is `SignatureTransfer`-only, hardcodes `fuelAmount: 0` (SwapBridgeRouter.sol:258) vs `bridgeWithFuel` requiring `fuelAmount > 0` (:155) — **witness spaces are genuinely disjoint**, cross-entrypoint replay is impossible as claimed.
- `ITokenPortal.depositToAztecPublic` and `IFeeJuicePortal.depositToAztecPublic` are byte-identical selectors+returns; the fuel leg of the live `bridgeWithFuel` already calls exactly this, so I2 is largely pre-proven. The ABI-identity basis for L1 is real.
- (c) binding is structurally enforced: in the proposed Noir the **same `recipient` variable** feeds both `derive_claim_secret(claim_salt, recipient)` and `mint_to_private(recipient, amount)` (main.nr claim_private today at :104-122). Redirecting to R'≠R requires a poseidon2 preimage — sound under A1. `claim_public` uses a different content hash so cross-consumption fails. The `amount` is bound by the content hash. This part is correct.
- The config-constant claim hazard (L11) is real: useDeposit.ts:309 builds `Contract.at(BRIDGE, …)` from config, not `rec.bridge` — a gate-lift would indeed claim old records against the new artifact and fail.

## HIGH-1 — "cannot ransom" is false: relayer + note-discovery (I4) is a griefing/withholding vector the threat model omits

The plan's §Design(c) states the relayer "cannot redirect, self-claim, or ransom," and the threat model (T1) treats a malicious relayer as fully neutralized. That is too strong.

A relayer holds `(salt, recipient, amount, leaf)` and therefore the derived secret. It can **consume the L1→L2 message at any time**, which nullifies it (double-consume is blocked — confirmed by red-team F-L2-05). The mint lands in a note owned by R. But per the plan's own inference **I4**, recipient-side discovery of a *third-party-submitted* `mint_to_private` may require the recipient to have registered the sender. If I4 is true, a malicious (user-chosen) relayer can:

1. Consume the message → the user's own self-claim path is now dead (message nullified).
2. Produce a note R cannot discover until R independently registers the relayer's address.

That is a withholding/ransom lever ("register me / pay me or your deposit sits in a note you can't find"), and it is *enabled precisely by the relayer capability* the plan advertises as safe. It is recoverable (R can see which L2 account nullified the leaf and register it), so this is degradation + a support landmine, not permanent loss — but it directly contradicts the "cannot ransom" claim.

The whole relayer feature's value proposition rests on I4 being **false**. The plan defers proof to Phase 4/7 and calls the fix "a documented `registerSender` step, not a redesign." If I4 is true, "relayer submits for an arbitrary user" is broken for any recipient who hasn't pre-registered the relayer — which is a redesign of the UX, not a doc note. This must be proven in Phase 4 (sandbox) as a **gating** result, and the malicious-relayer griefing case must be added to the threat model. Also note a privacy cost the plan doesn't mention: a shared relayer publicly links every depositor's L1 address ↔ leaf ↔ the relayer's claim tx, collapsing the anonymity set across all its users.

## HIGH-2 — the plan conflates witness *integrity* with intent *authenticity*; Permit2 + AZLO pre-approval = one blind signature drains a holder

T3 is framed as "a hostile dApp gets a Permit2 witness signed," and the plan's answer is "every executed field is witness-bound and re-derived… executes verbatim or not at all." That answers *tampering with a legitimate signature*. It does **not** answer the real worst case: a hostile dApp induces the user to sign a **valid** `BridgeWitness` whose `aztecRecipient`/`tokenSecretHash` is the *attacker's*. The router faithfully bridges the user's tokens to the attacker's L2 account. Witness binding provides zero protection here — it guarantees the router does what was signed, and what was signed is the theft.

This is materially worse than today's bridge-only path. Today bridge-only is `approve(portal) + portal.deposit`, and `depositToAztecPublic` pulls from `msg.sender` — a phished signature does not exist as a vector. Moving to Permit2 introduces a **bearer signature** vector, and because `MintableERC20.allowance()` returns `type(uint256).max` for Permit2 for **every holder** (MintableERC20.sol:47-50), there is no approve gate to interrupt the user: a single blind `signTypedData` drains AZLO. This is exactly red-team INFO-1 ("severe production footgun if copied to a value token") realized by item (a). It's testnet-valueless, so accept it — but the plan should *state* it plainly rather than imply Permit2 is strictly safe, and flag it as a hard blocker for any value-token port.

Corollary for (b): the plan's new one-time `approve(Permit2, max)` on the canonical fee asset (which lacks the override) **converts the fee asset into a standing Permit2-drainable balance** it wasn't before. The plan frames this as pure UX ("one-time, mainnet-standard") and never notes it widens the standing-approval attack surface.

## HIGH-3 — rollback asymmetry (R7): no claim path for new-stack deposits made before a post-promotion rollback

The plan is careful about *old-stack* stranding: L11 quarantines stale records, Phase 8 pins a `legacy/testnet-bridge.v1.json` + v1 artifact script, "old stack stays claim-live indefinitely." R7 post-promotion rollback = "redeploy the last pre-cutover RELEASE (code + config as one unit)."

But consider the window between **promotion** and a **post-promotion rollback**. Real users deposit through the new stack: derived-secret deposits against the *new* portal/bridge. Rollback redeploys the *old* release — faucet config now points at the old portal, faucet code claims with a *raw* secret. Those new-stack deposits:
- Are flagged `stale-deployment` (rec.portal = new ≠ config L1_PORTAL = old).
- Cannot be claimed by the legacy script (it's pinned to the **v1/old** artifact + manifest).
- Cannot be claimed by the rolled-back faucet (old config, old raw-secret claim path).

Nothing on-chain is destroyed (the new bridge is still claim-live), but the plan provides **no code path** to reach it after rollback — the symmetric "keep the new release build claim-reachable" is missing. R1–R8 enumerate old→new stranding exhaustively and miss new→old. Given Phase 7 does real-money canaries on the new stack, this is not hypothetical. Fix: R7 must keep the promoted release claim-reachable (versioned build or a `v2` legacy script), mirroring L11/A-2 in the forward direction.

## HIGH-4 — fueled-private needs to recover TWO salts; `envelope.salt` is one field (L14 is under-analyzed)

L14 rejects codex's "v3 envelope" on the grounds that `DepositEnvelopeV2.salt` already exists (verified: recovery-crypto.ts:115, documented "PRIVATE fuel only") and is additive. That reasoning only holds for the **single-salt** (non-fuel private token) case.

A **fueled-private** deposit (`bridgeWithFuel`, isPrivate) now has *two* derived secrets with *two* independent salts: the new token-claim salt (F2's `tokenClaimSalt`, derives the token secret) and the existing fuel salt (derives the FPC secret). The sealed envelope has exactly one `salt` slot. So the plan cannot seal both into the "SOLE recovery input" backup blob — one of them stays plaintext-journal-only (`fuel.bridgeSecretSalt`, useDeposit.ts:821), which is asymmetric durability, or the envelope actually needs a second field (→ a v3 schema, the very thing L14 used to reject the alternative). The plan's F2/F5 add `tokenClaimSalt` to the flow but never reconcile the sealing collision. Either accept "fuel salt is plaintext-only for fueled-private" explicitly, or bump the envelope — but L14's "additive, no v3" justification is wrong for the fueled path.

## MEDIUM-1 — the (c) "verified this session" DS/vectors are gate-dependent, and I3 has ZERO in-repo Noir precedent

I could not find a single `.nr` file in this repo that calls `poseidon2_hash_with_separator` (grep returned nothing across the whole tree), and there is no `derive_bridge_secret` Noir contract in-repo — the "precedent" cited (private-fuel) is a **TS ↔ Wonderland external contract** match, not this repo's Noir computing a separator hash. So I3 ("`poseidon2_hash_with_separator` is available to contract code and byte-matches TS") is genuinely unproven, and the claim that "the FPC precedent proves the pair matches" is about a different code path. If the aztec-nr import path is wrong, or Noir's `AztecAddress.to_field()` serialization diverges from what TS `poseidon2HashWithSeparator([salt, recipient])` feeds, **every private deposit strands**. The keystone vectors do catch a TS↔Noir divergence (they're hardcoded expected values asserted in Noir), so this is fail-closed at Phase 2 — but the plan's Assumptions list this under "Facts… verified against the repo" tone when it is squarely an Inference. Additionally, the DS value `3140354885` and the three pin vectors (L6) are **not independently checkable without running Barretenberg**; a reviewer must treat them as gate-enforced, not "verified three times." Present them as such.

Minor edge within (c): the plan blocks `recipient.is_zero()` but not the case where `derive(salt, recipient)` equals the empty-secret sentinel (`computeSecretHash(0)`), which some protocol versions treat specially. Not third-party-exploitable (depositor controls salt, uses CSPRNG), but worth an explicit "no reserved-secretHash interaction" check in Phase 9.

## MEDIUM-2 — the zero-Solidity decision (L1) trades away an *available* on-chain safety net

`bridge()` has no binding between `bridgeToken` and `tokenPortal`'s underlying — confirmed, it only checks `amount > 0` and `tokenPortal != 0` (:245-246). For fuel-only reuse, the router *already knows* the canonical FeeJuicePortal (its immutable `feeJuicePortal`, :60/:136) yet the generic `bridge()` path cannot assert `tokenPortal == feeJuicePortal` or `bridgeToken == feeJuicePortal.UNDERLYING()` without new Solidity — which L1 forbids. So the "zero new Solidity" win is bought by pushing a check the contract *could* cheaply enforce onto client-side asserts. A wrong `tokenPortal`/`bridgeToken` pairing reverts (no theft — the mismatched pull fails), so this is an accepted residual, but the plan frames L1 as strictly free. It isn't: it forfeits defense-in-depth that a `fuel()` entrypoint (or even a 2-line check in `bridge()`) would have. A-1's ratification should name this explicitly.

## MEDIUM-3 — I1 is load-bearing for the entire architecture and is committed-to before verification

Both L1 (b reuses `bridge()`) and L2 (a rides the live router, no redeploy) rest on the deployed bytecode at `0x4c3f…4068` actually containing `bridge()`. That is Inference I1, verified only at Phase 1.4 — *after* the plan has committed the whole "no router redeploy" architecture. If I1 is false, a redeploy is forced, and at that point the `fuel()` entrypoint the plan rejected becomes nearly free — undercutting L1's entire cost argument. This is fine to gate at Phase 1.4, but the plan should acknowledge the architecture is contingent, not settled.

## LOW-1 — fuzz `test_fuzz_bridgeAccounting` upper bound (2^128) coincides with the un-guarded strand boundary

The L2 claim takes `amount: u128`; the L1 content hash uses the full `uint256`. An amount ≥ 2^128 is depositable on L1 (router/portal don't cap it) but **unclaimable on L2** (u128 can't represent it → content-hash mismatch → strand). The fuzz target caps at exactly 2^128, so the boundary is never exercised and the plan advertises "amount ∈ [1, 2^128]" as if it were the full domain. Pre-existing, low-likelihood for a capped-mint testnet token, but the fuzz plan should test the boundary and the plan should document the ceiling.

## LOW-2 — the aliasing collapses observability: `Bridge` event can't distinguish fuel-only from token-only

After (b), fuel-only and bridge-only both go through `bridge()` and emit the same `Bridge(aztecRecipient, key, index, amount, secretHash, isPrivate)` event — which carries **no `tokenPortal`**. Any indexer/analytics/subgraph must inspect calldata to classify the deposit type. Not a security bug, but the plan's C9 ("fuel indexing parses the portal event") only addresses the client's own leaf extraction, not third-party observability, and the aliasing is sold as invisible.

## Nits worth a line in Phase 9

- Nonce is a 128-bit `crypto.randomUUID` (useDeposit.ts:729) and deadline is `now + 1800s` (:730) — both fine; no `type(uint256).max` deadline footgun in the current code. Confirm the new bridge-only/fuel-only paths inherit the same bounded deadline and don't regress to a max deadline.
- The plan's soundness paragraph should explicitly name **`computeSecretHash` second-preimage resistance** as an assumption (it's poseidon2-based, so A1 covers it, but it's the outer layer the message actually commits to and is currently unlisted).

---

## Bottom line

The cryptographic core of (c) is sound and the L1 witness-aliasing is genuinely replay-safe — the prior reviewers got those right. The gaps are at the **edges the plan's framing suppressed**: the relayer is sold as fully defanged but retains an I4-gated withholding lever (HIGH-1); "Permit2 is safe" conflates integrity with authenticity and, with AZLO's pre-approval, makes one blind signature a drain (HIGH-2); rollback stranding is analyzed exhaustively in one direction and not the other (HIGH-3); and the "no schema change" and "no new Solidity" wins are each under-analyzed for one real case (HIGH-4, MEDIUM-2). None of these are testnet-fatal given valueless tokens, but three of them (HIGH-1, HIGH-2, MEDIUM-2) are exactly the landmines that detonate on a value-token port, and the plan's tone treats them as closed.

### Critical files for implementation
- contracts/bridge/evm/src/SwapBridgeRouter.sol
- contracts/bridge/aztec/token_bridge/src/main.nr
- packages/bridge-core/src/private-fuel.ts
- packages/bridge-core/src/recovery-crypto.ts
- apps/faucet/src/composables/useDeposit.ts

## Leg C — SECOND fresh hostile auditor (independent duplicate spawn — cross-checks Leg B)

Verdict: conditional approve (5 conditions). Notably CORRECTED Leg B: no envelope-salt naming collision for fueled-private (token salt -> envelope.salt, fuel salt -> journal.bridgeSecretSalt) — the real issue is the fuel salt is plaintext-journal-only, not in the sealed backup. Also found the CF Pages preview-deploy L9 gap (mitigated by the salt-v2 interlock) and the fork-skip gate hole.

# Security Audit — bridge-permit2-recipient-commitment (fresh hostile review)

I verified every load-bearing claim against the tree. The cryptographic core of (c) is **sound** — I confirmed the derivation binding is preimage-resistant, not merely second-preimage-resistant (attacker controls both `salt'` and `R'` but must still hit a fixed 254-bit target, ~2^254), and that `token_bridge/src/main.nr` has exactly two `consume_l1_to_l2_message` sites (`:98` public / `:115` private) with disjoint content hashes, so no bearer path survives (A2 holds structurally). `ITokenPortal.depositToAztecPublic` ≡ `IFeeJuicePortal.depositToAztecPublic` is real (`:9-11` / `:12-14`), and `bridge()` zeroes `fuelAmount` (`:258`) vs `bridgeWithFuel` requiring `>0` (`:155`), so the witness-space disjointness for (b) is real. The plan is competent. My findings are about **operational strand vectors, gate integrity, and missed consumers** — the things a reviewer inside the framing stops seeing.

---

## HIGH

**H1 — The L9 "single-release" invariant is unenforceable against CF Pages preview deployments (I6 is asserted, never verified). [§ ledger L9, I6, Migration R7]**
This is the finding prior reviewers missed *because they trusted I6*. L9's entire strand-prevention rests on "derived-secret code never goes live against the old bearer bridge," and I6 claims "the faucet production site only changes at main promote." But the faucet reads the LIVE `testnet-bridge.json` at build (`bridge-deployments.ts`), and during Phases 3–7 that manifest still points at the **old bearer bridge**. There is no `wrangler.toml` in `apps/faucet/` — the site is CF Pages Git-integration, whose **default behavior is a public preview URL for every non-production branch/PR** (`<branch>.<project>.pages.dev`). A preview build of the Phase-3–5 branch = derived-secret deposit code + old-bridge manifest = the exact strand configuration L9 forbids, reachable by anyone with the URL. I6 addresses only the *production domain*, not previews.
*Fix:* Before pushing ANY derived-secret code to a branch CF builds, confirm preview deployments are disabled for this project (or the dev branch is access-gated), OR do all of Phases 3–5 on a branch CF is configured to ignore. Add this as an explicit pre-Phase-3 blocker, not an inference.

**H2 — The wrong-recipient canary is non-diagnostic if it dies at the client re-derivation guard instead of reaching the sequencer. [§ Phase 7.3, C1]**
C1 fixed the *ordering* (wrong-recipient before consumption) but not the *reachability*. The plan also adds a client-side fail-closed assert: "re-derive and check `computeSecretHash(derived) === rec.secretHashHex` before sending." If the wrong-recipient canary runs through any guarded path, it fails at that client assert and **never reaches the circuit** — proving the client guard works, not that the circuit rejects a wrong recipient. This is the single most important negative test for the whole (c) change and it is easy to make vacuous.
*Fix:* Mandate that `relay-claim-testnet.ts --wrong-recipient` bypasses the deposit-time client guard and submits `claim_private(recipient=WRONG, salt, amount, leaf)` **directly to the sequencer**, and asserts the tx reverts AND the message is still claimable afterward. Spell this out in the Phase 7 gate.

**H3 — Phase 1 fork legs (the only real-data proof of the plan's key bet I2) can silently skip and the gate still shows green. [§ Phase 1 gate, I2]**
`forge test` **exits 0 when fork tests are skipped** (they auto-skip without `SEPOLIA_RPC_URL`). The entire zero-Solidity bet for (b) rests on I2 — "the canonical FeeJuicePortal accepts router-originated `depositToAztecPublic` for arbitrary `to` on the `bridge()` path" — which is *only* proven by the new Phase 1.3 fork leg. "forge test green" is satisfiable with every fork leg skipped, so the gate can go green while I2 is unproven.
*Fix:* The Phase 1 gate must assert the specific fork tests **PASSED** (grep the forge output for the new fork-leg names), not merely exit 0. Same hardening for Phase 6's "fork rehearsals green."

---

## MEDIUM

**M1 — Multiple `claim_private` call sites; the C2 grep backstop must be scoped to catch the script sites too. [§ blast-radius table, C2]**
`grep` shows `claim_private` is called at `useDeposit.ts:381` (fueled-private path) AND `:476` (non-fuel private) — the blast-radius table enumerates only one — plus `l2.ts:56`, `deploy-sandbox.ts:292`, and `fuel-testnet.ts:271`. All still pass a raw `secret` (`useDeposit.ts:381`: `claim_private(recipientAddr, amount, secret, leaf)`). Any missed site typechecks and strands at runtime (same arity/type — C2's own hazard). The C2 grep is the only backstop; if it is scoped to `apps/faucet/src` it misses the two `packages/bridge-core/scripts` sites.
*Fix:* Make the C2 stale-semantics grep span `packages/bridge-core/{src,scripts}` + `apps/faucet/src`, and enumerate all five sites in the Phase 3/5 checklist.

**M2 — `envelope.salt` becomes a domain-overloaded field with no disambiguation test. [§ ledger L14]**
Verified: today `DepositEnvelopeV2.salt` carries the **FPC** bridge-secret salt for direct private-fuel records (`recovery-crypto.ts:112-115`, `useFuel.ts:138`, derivation DS=3952304070). Post-(c) the same field carries the **token-claim** salt for private bridge-token records (DS=3140354885). One field, two salts, two domain separators, disambiguated only by `assetKind`. Cross-wiring the derivations is fail-safe (wrong secret → claim reverts, funds recoverable) but silently confusing, and L14's "additive, no schema bump" framing hides it.
*Fix:* Add a test asserting each `assetKind` uses its own derivation/DS; document the overload at the field. (Note: the fueled-private token leg is fine — its token salt goes in `envelope.salt`, the fuel salt in the separate `fuel.bridgeSecretSalt` (`journal.ts:90`) — no collision. Verify this holds under the "TODO seal salt" gap at `useDeposit.ts:668`.)

**M3 — Phase 2 gate cannot detect broken `claim_private` consume-wiring. [§ Phase 2 gate, F6]**
`token_bridge` has zero `#[test]`s (F6), so Phase 2's proof is compile + keystone vectors + TS vectors. Vectors prove the *derivation* round-trips and DS byte-matches, but a transposed/incorrect `consume_l1_to_l2_message(content_hash, secret, ...)` wiring, wrong content-hash argument, or a mis-passed `recipient.to_field()` is **not** covered — first detection is Phase 4 sandbox. Phase 2 "green" overstates confidence.
*Fix:* Add a `token_bridge` TXE test for `claim_private` happy-path + wrong-recipient-reverts, or explicitly downgrade the Phase 2 gate's claim to "derivation + compile only; consumption correctness deferred to Phase 4."

**M4 — Note discovery for relayer-submitted mints (I4) gates the feature's headline capability, and self-claim doesn't exercise it. [§ I4, Phase 4/7]**
The self-claim path discovers notes trivially (own tx the PXE simulated). The relayer path is different: the recipient's PXE did NOT simulate the tx and must discover the `mint_to_private` note via tagging/logs, which may require `registerSender`. The plan is right that the canary exposes it, but a fresh reviewer should weight this: the *entire point* of (c) — relayer-submitted claims — depends on an unverified assumption, and the fix ("documented `registerSender` step") is a UX regression, not a no-op.
*Fix:* Keep the canary, but pre-verify note discovery for a third-party-submitted `mint_to_private` in the Phase 4 sandbox before the live cutover, and pre-write the `registerSender` fallback.

**M5 — bridge() grants a live allowance to the witness-chosen `tokenPortal`; (a)/(b) make this the load-bearing path (INFO-1 realized). [§ Threat model T3, blast-radius]**
Between `forceApprove(p.tokenPortal, p.amount)` (`SwapBridgeRouter.sol:271`) and the reset to zero (`:281`), a witness-chosen hostile `tokenPortal` can `transferFrom` the pulled amount during its `depositToAztec*` callback. Pre-existing (bridgeWithFuel `:220` too), but (a) deletes the direct-portal path so **100% of bridge-only volume** now flows through a signed 12-field witness a wallet can't meaningfully display, and AZLO's `MintableERC20` max-Permit2 pre-approval (INFO-1) removes even the per-tx approve friction. On testnet with a worthless permissionless token this is accepted — but the plan carries F-003/F-007 into the Phase 8 docs and omits INFO-1, which is now the load-bearing "never copy to a value token" caveat.
*Fix:* Client must pin `tokenPortal` to the known-good portal (fail-closed) and the Phase 8 docs must explicitly carry INFO-1 forward as a production blocker for the pattern.

---

## LOW

**L1 — F-007 is Low-2.6; the stated justification undersells the real driver. [§ summary, red-team report]** The whole irreversible cutover (fresh portal + fresh L2 trio + all users re-add the token + permanent dual-stack) is framed as "closes red-team F-007," which the report rates **Low 2.6, accepted-risk**. The actual justification is the **relayer capability (a new feature)**. State that as primary so the risk-acceptance decision is made on honest terms.

**L2 — Recipient-commitment reduces recoverability vs today. [§ (c) spec]** Today a private deposit's recipient is chosen at *claim* time (content hash omits it); after (c) it is fixed at *deposit* time inside the secretHash. A wrong/unspendable recipient now strands **permanently** with no claim-time correction. Inherent to the feature, but ensure the client binds `recipient` = the connected wallet and tests it; there is no longer a safety net.

**L3 — `swapTarget` binding couples bridge-only/fuel-only liveness to pool migrations. [§ Threat model T4]** `bridge()` binds `swapTarget: address(swapTarget)` (`:266`) even though it never swaps. The owner (hot EOA) calling `setSwapTarget` invalidates every in-flight bridge-only AND fuel-only signature. Deadline-bounded, pre-existing, but the plan moves all volume onto it. Note as accepted.

**L4 — I1 verification method is under-specified. [§ Phase 1.4]** "Etherscan / cast" doesn't cleanly prove a selector exists in deployed bytecode (a bad-param `cast call` reverts whether or not the function exists). Use a positive probe: `cast call <router> "bridge(...)" <zero-amount params>` must revert with `"SwapBridgeRouter: zero amount"` (selector present) vs an empty revert (absent).

**L5 — Relayer deanonymizes private claims. [§ soundness, T1]** A relayer-assisted private claim reveals `recipient↔amount↔leaf` to the relayer — the claim is not private *from the relayer*. The plan notes the linkage but should state plainly (Phase 8 docs) that relayer use trades relayer-privacy for liveness, especially if the relayer shares an operator with the indexer.

**L6 — capabilities.ts is NOT broken by the arg change (verified). [§ blast-radius]** `apps/faucet/src/lib/capabilities.ts:175` scopes `claim_private` by `{contract, function}` name only, not argument shape, and rebuilds from config addresses — so the secret→salt change and the new bridge address flow through automatically. Downgraded from a suspected missed-consumer to a one-line sanity check that the manifest rebuilds against the new `bridgeAddress`.

---

## What holds up (checked, not assumed)
- Derivation soundness (H(poseidon2_ds([salt,R])) binding; preimage-resistant; sole-consumer A2) — **verified against `main.nr`**.
- Witness-space disjointness for (a)/(b) cross-entrypoint replay — **verified** (`:258` vs `:155`).
- ABI-identity for the zero-Solidity (b) bet — **verified** (`ITokenPortal.sol` / `IFeeJuicePortal.sol`).
- L11 gate-lift hazard (claim builds from config `BRIDGE`, not `rec.bridge`) — **verified** (`useDeposit.ts:309`, `useBridgeJournal.ts:288-300`).
- `router-abi.ts` exposes only `bridgeWithFuel` today; candidate/journal/one-shot deploy machinery exists — **verified**.
- Fail-closed on `bridgeToken≠underlying` for (b) reverts atomically — **verified** by construction.

---

`conditional approve (with conditions: H1 — prove CF Pages has no live preview/branch deployment of derived-secret code against the old-bridge manifest before any push, or gate it, as a pre-Phase-3 blocker; H2 — the wrong-recipient canary must submit claim_private directly to the sequencer bypassing the client guard and assert revert + still-claimable; H3 — Phase 1/6 gates must assert the named fork legs PASSED, not merely forge exit 0; M1 — the C2 grep must span packages/bridge-core/{src,scripts} + apps/faucet/src and cover all five claim_private sites; M4 — pre-verify relayer-submitted note discovery in Phase 4 before live cutover)`

### Critical Files for Implementation
- contracts/bridge/aztec/token_bridge/src/main.nr
- packages/bridge-core/src/flows.ts
- apps/faucet/src/composables/useDeposit.ts
- packages/bridge-core/src/recovery-crypto.ts
- contracts/bridge/evm/src/SwapBridgeRouter.sol