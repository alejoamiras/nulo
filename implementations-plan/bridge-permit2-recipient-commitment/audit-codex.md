# Codex audit transcript

Session 019f34a5 (single resumed session across: initial plan leg → contradiction-check → full adversarial audit).

## Round 1 — independent plan draft

**Dissents From Brief**
- `apps/faucet/scripts/verify-deployments.ts:14-37` does not verify `public/testnet-bridge.json`; it only rebuilds faucet contracts. Do not rely on `audit:faucet` for bridge manifest drift until this script is extended.
- `contracts/bridge/evm/README.md` and `foundry.toml` comments still say Aztec `4.2.0`; actual `Nargo.toml` and package pins are `5.0.0-rc.2`. Treat docs as stale, not code truth.
- Existing testnet smoke scripts still use direct portal deposits and some preflight leaf-index simulation; they must be updated before being trusted as canaries.

1. **Recipient Commitment + Legacy Claim Support**
Implement `claim_private(recipient: AztecAddress, amount: u128, salt: Field, message_leaf_index: Field)` in `contracts/bridge/aztec/token_bridge/src/main.nr`. Add `derive_private_claim_secret(salt, recipient) = poseidon2_hash_with_separator([salt, recipient.to_field()], 3189952094)`, where `3189952094 = poseidon2_hash_bytes("az_dom_sep__token_bridge_private_claim_secret") as u32`; this is distinct from FPC `3952304070`. L1 secret hash remains `computeSecretHash(derived_secret)`, so portal bytecode/content hashes stay unchanged.

Pin vectors in Noir and TS:
- salt `0`, recipient `0`: secret `0x0c264e23d2cb1dcfd14f68ea75db79735682dfd2380a83948b4761afdcbb45f4`, secretHash `0x01b9a8c1dd6ff28b4f4d9c72be16bd24ef9c42e0d896fada6aa506a00a17d29e`
- salt `1`, recipient `2`: secret `0x1b10fdeffce1e30dd2250549d4c2574aad09ff021199eaa3996ef1df5f8a1d7b`, secretHash `0x1390e0fcc75e9871cba1aa04a6e4264fdfaf1846329a0f2b3f998b47d82a0eed`
- salt `0x1234567890abcdef`, recipient `0xdeadbeef`: secret `0x2c72a25dc4895ea2fb4713a30bc016563f4dce02e903757e7858150d955e68f8`, secretHash `0x2463a54274d6c16384379e3ce084869089ee301adec39218a0c12858a7fa93e8`

Before regenerating artifacts, snapshot the old token-bridge artifact/config for exact old-stack claims. New stack must not expose any raw-secret private claim path; otherwise the property fails. Old stack may keep bearer claims only behind exact legacy address/config matching for in-flight records.

Validation gate: `cd contracts/bridge/aztec/token_bridge && nargo test`; `cd contracts/bridge/aztec/keystone && nargo test`; `bun run --cwd packages/bridge-core test`; `bun run --cwd packages/bridge-core typecheck`. Pass = vectors match, wrong-recipient private claim fails, relayer-from-different-account test passes, old-artifact compatibility tests pass. Layers: Noir, TS crypto, artifact compatibility.

2. **Router Periphery**
Extend `contracts/bridge/evm/src/SwapBridgeRouter.sol`, not a separate contract. Reason: the router is already the Permit2 periphery, is stateless, will be redeployed, and keeps one spender/config surface. Downside: owner sweep/swapTarget admin sit on the same contract; acceptable for testnet, but document as not mainnet-grade.

Use a new `FuelWitness`, not `BridgeWitness`:
`FuelWitness(address feeJuicePortal,address feeAsset,uint256 amount,bytes32 recipient,bytes32 secretHash)`.
Do not reuse the 12-field bridge witness; dummy swap fields invite type-string drift and poor signing UX. Add `fuel(FuelParams, PermitParams)` with `amount > 0`, `feeAsset == feeJuicePortal.UNDERLYING()`, Permit2 SignatureTransfer pull, forceApprove portal, `depositToAztecPublic`, forceApprove zero, and `Fuel(recipient,key,index,amount,secretHash)` event. Keep existing `bridge()` for bridge-only.

Fuzz targets: simple `bridge()` amount/privacy/residue invariants; `fuel()` amount/recipient/secretHash/no-residue invariants; malformed zero/short amount reverts; bridgeWithFuel amount bounds and malicious swap non-consumption; hash/type-string pins for `BridgeWitness` and `FuelWitness`; fork tests for real Permit2 replay/expiry/tamper on `bridge`, `bridgeWithFuel`, and `fuel`.

Validation gate: `cd contracts/bridge/evm && forge build && forge test`. With `SEPOLIA_RPC_URL`, fork legs must also pass. Pass = all unit/fuzz/fork tests green, no router residue, Permit2 tamper/replay rejected. Layers: Solidity, Permit2, V4 fork data.

3. **Bridge-Core Flows And Scripts**
Replace `packages/bridge-core/src/flows.ts:60-135` direct portal flow with Permit2 `router.bridge()`. Private token deposits generate `tokenClaimSalt`; public deposits keep random secret. Bridge+fuel private token leg also uses the token salt; private fuel keeps its distinct `bridgeSecretSalt`.

Update `packages/bridge-core/src/l1.ts` and `router-abi.ts` for `bridge`, `Bridge`, `fuel`, `Fuel`, `FuelWitness`, typed data, and hash pins. Update `l2.ts` `claimPrivate` to pass salt. Add `private-claim.ts` helper: `DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET`, `deriveTokenBridgePrivateClaimSecret`, `privateTokenSecretHash`.

Add minimal relayer script in `packages/bridge-core/scripts`: inputs `salt/recipient/amount/leaf/config`, sends `claim_private(recipient, amount, salt, leaf)` from a separate Aztec account. Add canary mode that performs private deposit then relayer claim.

Validation gate: `bun run --cwd packages/bridge-core test`; `bun run --cwd packages/bridge-core typecheck`. Pass = no direct portal deposit in core flow tests, ABI pins match artifact, relayer canary unit harness uses separate sender, old bearer helper is address-gated only. Layers: TS flow, ABI, scripts.

4. **Faucet UX, Journal, And Deployment Config**
Delete `apps/faucet/src/composables/useDeposit.ts:849-926` direct approve+portal branch. Non-fuel bridge becomes: seal if private, sign Permit2, call router `bridge`, parse `Bridge` event. `TokenPortalAbi`/`InboxAbi` imports disappear from deposit code. `useFuel.ts:151-169` becomes Permit2 `fuel()`: first-time `approve(FUEL_ASSET, PERMIT2, max)`, then sign witness and call router.

Stepper changes in `apps/faucet/src/lib/bridge-steps.ts`: token bridge paths use `SIGN`, not portal `APPROVE`; direct Fuel uses `APPROVE` only when Permit2 allowance is short, then `SIGN`. Update `useL1FeeAsset` allowance spender from FeeJuicePortal to Permit2 for fuel-only. Extend `bridge-deployments.ts` so router/permit2 are required bridge config, while swap pools remain optional fuel-swap config.

Journal: current records pin `chainId/portal/bridge` at `packages/bridge-core/src/journal.ts:53-56`, and stale-deployment guard is `apps/faucet/src/composables/useBridgeJournal.ts:282-300`. Add legacy deployment registry so old records remain claimable. Add v3 private envelope or explicit field for `tokenClaimSalt`; do not overload `secret` silently.

Validation gate: `bun run test:faucet`; `bun run audit:faucet`; `bun run lint`; `bun run typecheck:all`. Pass = no new direct portal deposits, old records do not get quarantined, deployment verifier checks bridge manifest, all UI rails and backup/restore tests pass. Layers: faucet, journal, backup, manifest.

5. **Deploy And Cutover**
Sequence:
1. Keep current `apps/faucet/public/testnet-bridge.json` as legacy config for old claims.
2. Deploy new L1 token if using current deploy script default, fresh `NuloTokenPortal`, new L2 proxy/token/bridge. `token_minter_proxy.set_bridge` and portal `initialize` are one-time, so reuse is not viable for the new bridge.
3. Deploy new router with `fuel()` and either reuse or redeploy `UniswapFuelSwap`; if L1 token changes, seed a new token/WETH pool.
4. Write only `testnet-bridge.candidate.json`.
5. Run candidate canaries: public bridge-only, private self-claim, private relayer claim, bridge+fuel, fuel-only Permit2.
6. Promote candidate to `testnet-bridge.json` only after canaries pass. Old stack stays live and address-gated for in-flight claims.

Validation gate: `cd contracts/bridge/evm && forge build && forge test`; `bun run --cwd packages/bridge-core test`; `bun run --cwd packages/bridge-core typecheck`; manual live canaries using the bridge-core scripts pattern from the brief. Pass = candidate manifest canaries all settle on live testnet, relayer claim mints to recipient, fuel-only works after one-time Permit2 approve. Layers: Sepolia fork, live L1/L2, manifest.

Rollback: revert faucet deployment/config to the prior manifest if promotion fails. Any deposits made into the candidate stack must be added to the legacy registry before rollback so they remain claimable. Do not destruct old portal/router/pools.

6. **Focused Re-Audit**
Run a narrow red-team pass over only changed surfaces: new secret derivation, old/new claim split, new FuelWitness, Permit2 allowance UX, router events, cutover scripts, and stale-record handling. Record F-003 as still open; do not add a contracts CI workflow in this plan.

Validation gate: `cd contracts/bridge/evm && forge build && forge test`; `cd contracts/bridge/aztec/token_bridge && nargo test`; `cd contracts/bridge/aztec/keystone && nargo test`; `bun run --cwd packages/bridge-core test`; `bun run audit:faucet`. Pass = no high/critical unresolved findings in changed surface, documented residual risks only. Layers: full local gate plus audit artifacts.

**Soundness**
Binding holds because L1 stores `computeSecretHash(poseidon2([salt, recipient], DOM_TOKEN_BRIDGE))`; L2 recomputes the same derived secret from the actual `recipient` argument before consuming. A wrong recipient gives a different secret, so the message is not consumed. This rests on Poseidon2 collision/preimage resistance, correct `AztecAddress.to_field()` parity, and complete removal of raw-secret private claims from the new artifact. The relayer learns salt, recipient, amount, leaf, and timing; it can withhold, waste its own fee with wrong args, or front-run a correct claim to the same recipient, but cannot redirect funds without a hash collision or address-encoding bug.

**Security Considerations**
Threats: malicious relayer, browser storage tamper, stale frontend, Permit2 signature replay/tamper, owner-replaced swap target, reorgs, fee spikes, manifest drift. Mitigations: Permit2 domain binds chain/verifying contract/spender/nonce/deadline; witnesses bind portal/token/amount/recipient/secretHash; router parses post-mine events, not simulated leaf guesses; old records are exact-address gated; fee asset approve is only to canonical Permit2; router force-approves to zero. Cross-protocol secret reuse is addressed by a new domain separator. Reorg risk remains operational: wait for receipts and canaries before config promotion.

**Facts / Inferences / Asks**
Facts: router `bridge()` exists at `contracts/bridge/evm/src/SwapBridgeRouter.sol:244`; current direct core path is `packages/bridge-core/src/flows.ts:60-135`; faucet direct path is `apps/faucet/src/composables/useDeposit.ts:849-926`; fuel-only direct portal path is `apps/faucet/src/composables/useFuel.ts:151-169`; bearer `claim_private` is `contracts/bridge/aztec/token_bridge/src/main.nr:104-121`; proxy bridge is immutable at `contracts/bridge/aztec/token_minter_proxy/src/main.nr:17-44`; portal private content hash omits recipient at `contracts/bridge/evm/upstream/NuloTokenPortal.sol:114-122`; records pin deployment at `packages/bridge-core/src/journal.ts:53-56`.

Inferences: current deploy flow likely redeploys the L1 MintableERC20 too, which means new pools; reusing the old L1 token is possible but would complicate backing/accounting. `fuel()` in the router is lower operational risk than a second periphery, but not the least-privilege architecture for mainnet.

Asks: decide whether old in-flight claims must be supported directly in the faucet UI or via recovery scripts only; decide whether to default to fresh L1 token/pools or intentionally reuse old L1 AZLO.

## Round 2 — contradiction-check (verdict: contradictions-found (8))

1. **HIGH** — Phase 7 canary ordering: the “wrong recipient” rerun after a successful relayer claim is non-diagnostic because the message may already be consumed.  
Fix: attempt wrong-recipient claim first on an unconsumed deposit, assert it fails without consuming, then prove the correct-recipient relayer claim succeeds.

2. **HIGH** — Phases 3/5 gates: `claim_private` keeps the same arity/types, so stale callsites passing `secret` instead of `claim_salt` will typecheck and fail only at runtime.  
Fix: add an explicit deny-list/AST or grep gate for old `claim_private(... secret ...)` semantics across bridge-core, faucet, and scripts, plus private-claim tests that pass only salt.

3. **MED** — L1/Design spec vs existing private fuel-only flow: plan says fuel-only asserts `isPrivate === false`, but existing `useFuel.ts` supports private fuel via FPC; this is ambiguous between router param privacy and record/claim privacy.  
Fix: rename this in the plan to `routerIsPrivate=false`, preserve record `isPrivate=true` for private fuel, and add private fuel-only sandbox/live canaries.

4. **MED** — L11/Phase 8 legacy support: rejected in-faucet legacy registry is acceptable, but the pinned legacy script needs a committed pre-cutover manifest; Phase 2 only snapshots the artifact.  
Fix: add `packages/bridge-core/legacy/testnet-bridge.v1.json` before Phase 7 promotion and gate the legacy script against it.

5. **MED** — Phase 3 gate completeness: “grep `depositToAztecPrivate`” does not catch direct public portal/FeeJuice writes, especially `depositToAztecPublic` fuel paths.  
Fix: expand the residue gate to reject direct `writeContract`/flow exports for both `depositToAztecPrivate` and `depositToAztecPublic`, except ABI/parser references.

6. **MED** — Phase 6 gate completeness: Phase 6 changes the TS deploy script for `EXISTING_L1_TOKEN`, but its gate only lists Forge preflight plus live deploy readbacks.  
Fix: add `bun run --cwd packages/bridge-core typecheck` and relevant bridge-core tests before any live deploy.

7. **MED** — Manifest dependency silently dropped: bridge-only now requires router/Permit2, but the current manifest shape keeps router under optional `l1.fuel`.  
Fix: either promote router/permit2 to required bridge config or make `verify:deployments` fail if `l1.fuel.router/permit2` is absent while bridge deposits are enabled.

8. **LOW** — Phase 2 gate completeness: plan says `token_minter_proxy` artifact drift is a STOP, but the gate omits `token_minter_proxy` testing/diff enforcement.  
Fix: add `cd contracts/bridge/aztec/token_minter_proxy && nargo test` plus an explicit artifact-diff check after compile.

9. **LOW** — Rejected `fuel()` alternative: no concrete security hole found in the `bridge(tokenPortal = FeeJuicePortal)` reuse design; witness aliasing is safe and `UNDERLYING()` can remain a client/deploy check.  
Fix: keep the rejection, but document event/indexing ambiguity and require fuel indexers to parse the FeeJuicePortal event, not router `Bridge` alone.

10. **LOW** — DS/vector dispute: none. I recomputed L4/L6; `3140354885` and all three secret/secretHash vectors are internally consistent.

Overall verdict: `contradictions-found (8)`

## Round 3 — full adversarial audit

## Adversarial / Security Findings

1. **HIGH — L1 / Permit2 signature surface:** `bridge()` is a generic router call with arbitrary `tokenPortal`; a hostile dApp can ask the user to sign typed data and submit a tx that approves a malicious portal, which can pull up to the signed amount. This is not prevented by Permit2 because the user is also the tx sender.  
Fix: document the worst case explicitly, add official-client tests that `tokenPortal`, `bridgeToken`, `router`, and `permit2` are hard-pinned from manifest, and add a future-router note that a hardwired/allowlisted portal is the only on-chain mitigation.

2. **HIGH — Phase 1 / L2:** current fork tests deploy a local router, so the Phase 1 gate can pass while the live router still lacks `bridge()`. The plan’s “Etherscan/cast recorded in PR” is not a gate.  
Fix: add a required live-bytecode selector check or a fork test that calls the deployed router address `0x4c3f…4068` for `bridge()`.

3. **HIGH — L9 / R7 cutover:** L9 is still mostly process, not a technical invariant. An accidental branch preview or static deploy of Phase 5 code against the old manifest can strand derived-secret deposits on the bearer bridge.  
Fix: add a runtime manifest/artifact version guard, e.g. `privateClaimMode: "salt-v2"` or bridge content hash, and make new deposit code refuse old manifests.

4. **HIGH — A2 soundness / Phase 2:** “no bearer entrypoint exists” is the critical property, but Phase 2 does not gate it structurally. A new or stale `consume_l1_to_l2_message` path could break recipient binding while tests still pass.  
Fix: add a static gate asserting exactly the expected consume callsites and that every private mint path derives via `derive_claim_secret`.

5. **MED — L1 / witness aliasing:** the fuel/bridge aliasing argument is sound only for the official manifest. It does not protect users from signing a valid `BridgeWitness` to a malicious portal, and the plan currently phrases this as if witness binding is sufficient.  
Fix: split “tamper resistance” from “intent phishing”; witness binding proves calldata integrity, not user intent safety.

6. **MED — Relayer trust story:** “cannot ransom” is only true if the user already has the salt. A relayer service that is the only holder can withhold liveness, and logs containing salts create permanent linkage.  
Fix: state relayer is never authoritative storage; script must avoid logging salts/secrets, and recovery docs must require user-held salt before relayer handoff.

7. **MED — Supply chain:** Noir dependencies are git-tag based and I found no `Nargo.lock`; tags are not a cryptographic supply-chain pin. Artifact-diff checks catch drift after compilation but not provenance.  
Fix: pin git deps by commit/revision or commit lockfiles/hash manifests for Noir dependencies and require compile provenance in Phase 2.

8. **MED — Fuzz strategy:** the fuzz plan does not explicitly include a malicious `tokenPortal` for `bridge()` that returns success without pulling, pulls to an attacker, or returns fake key/index. This is the main newly-hot arbitrary-call trust boundary.  
Fix: add a `bridge()` hostile-portal test target; official flow must reject non-pinned portals, and router residue must be zero for honest portals.

9. **MED — Funds stranding:** failed candidate canaries after an L1 deposit are not enumerated. Candidate is “additive,” but a bad L2 artifact can strand even dust.  
Fix: require dust amounts, persist candidate manifest + claim material before each canary tx, and define a failed-candidate recovery/abandon procedure.

10. **LOW — Domain separator:** the 32-bit separator is Aztec-conventional, but collision resistance is much weaker than the underlying field hash. This is acceptable only as a namespace tag, not a cryptographic boundary.  
Fix: document that the separator is a protocol convention, keep exact-string re-derivation tests, and maintain a local DS registry.

## Assumption Attack

### Facts

11. **MED — Facts / live router:** “router redeployed at rc.2 bump from source containing `bridge()`” is not a verified bytecode fact. It belongs under Inferences until Phase 1 proves the deployed selector/bytecode.  
Fix: move it to Inferences or add live bytecode proof to Phase 1 gate.

12. **LOW — Facts / ABI equivalence:** `ITokenPortal.depositToAztecPublic` and `IFeeJuicePortal.depositToAztecPublic` are ABI-identical, not semantically identical.  
Fix: reword the fact as ABI-only and keep semantic acceptance under I2 + fork/live canary gates.

### Inferences

13. **MED — I2:** “already true live for `bridgeWithFuel`” does not prove `bridge(tokenPortal = FeeJuicePortal)`: `bridgeWithFuel` uses the router’s immutable `feeJuicePortal`, not arbitrary `p.tokenPortal`.  
Fix: make I2 depend solely on the new Phase 1 `bridge()` fuel-only fork/live test.

14. **MED — I4:** note discovery may not be fixable by only documenting `registerSender`; if recipient wallets cannot discover third-party-submitted private mints, this can require wallet or protocol integration work.  
Fix: make Phase 4/7 relayer note discovery a hard promotion blocker until the real fix is known.

15. **HIGH — I6:** production deploy behavior is an unsafe inference for L9. CI/CD, preview deploys, or manual hosting can violate it.  
Fix: add the runtime manifest guard from finding 3 and require an explicit deploy-freeze checklist.

### Asks

16. **MED — A-1:** ratifying `bridge()` reuse hides the user-facing acceptance of the generic-router phishing surface.  
Fix: frame A-1 as “zero new Solidity plus generic-router phishing risk accepted for testnet.”

17. **MED — A-2:** legacy script UX hides operational ownership: who runs it, how sealed envelopes are opened, and whether non-technical users can recover.  
Fix: split into “script-only support owner” vs “versioned old faucet URL” vs “manual support by maintainer.”

18. **MED — A-5:** “drain window” does not say whether old deposits are disabled or merely announced. If old deposits remain open until promotion, in-flight legacy volume keeps growing.  
Fix: ask explicitly whether to freeze/disable old deposits during the drain window.

19. **LOW — A-6:** relayer account choice omits privacy/logging/funding policy.  
Fix: include “fresh key, no salt logging, bounded funding, no deploy key” as the recommended option.

## Gate Integrity

20. **HIGH — Phase 1 gate:** can pass against locally deployed router while live router is wrong.  
Fix: live deployed-router selector/call test must be part of the gate.

21. **HIGH — Phase 2 gate:** can pass without proving the sole-consumer invariant.  
Fix: static callsite invariant for `consume_l1_to_l2_message` and private mint path.

22. **MED — Phase 4 gate:** “fuel-only leg” is singular; it can go green while private fuel-only remains broken until live Phase 7.  
Fix: require public and private fuel-only legs locally.

23. **MED — Phase 5/6 gates:** required router/Permit2 manifest migration is still underspecified. It can either break Phase 5 against the old manifest or leave router under optional `l1.fuel`.  
Fix: define exact manifest schema and backward-compatible read behavior until Phase 7.

24. **MED — Phase 6 gate:** “manifest verifier green against candidate” lacks an exact invocation/flag; the script currently reads live `testnet-bridge.json`.  
Fix: add explicit candidate path input, e.g. `BRIDGE_MANIFEST=apps/faucet/public/testnet-bridge.candidate.json`.

25. **MED — Phase 7 promotion:** the legacy manifest copy must happen before `cp candidate -> testnet-bridge.json`; current wording allows accidentally pinning the candidate as v1.  
Fix: order it explicitly: copy live to `legacy/testnet-bridge.v1.json`, verify hash, then promote candidate.

26. **LOW — Phase 8 gate:** manual legacy claim proves one old record, not that restored user backups can drive the script.  
Fix: include a backup/sealed-envelope legacy recovery fixture.

conditional approve (with conditions: 1. add a live deployed-router `bridge()` gate; 2. add a runtime manifest/artifact guard enforcing L9; 3. add the Phase 2 sole-consumer static invariant; 4. explicitly document and test the generic-router phishing boundary; 5. define exact candidate/live/legacy manifest copy and verifier commands)