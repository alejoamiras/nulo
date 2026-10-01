# Draft plan — main leg

Planner: main agent. One of three independent drafts under `/blueprint deep`; see `brief.md` for locked decisions and ground truth. This draft is input to consolidation, not the final plan.

## Design decisions (this draft's positions)

**D-M1 — One new router version carries all three flows.** Task (b) requires a router change, so a router redeploy is unavoidable. Ship a single new `SwapBridgeRouter` with `bridgeWithFuel` (unchanged), `bridge` (unchanged, finally used), and a new `fuel()` entrypoint. Task (a) then rewires the frontend onto the NEW router — the dormant `bridge()` on the currently-deployed router never needs to be trusted or verified as-deployed.

**D-M2 — `fuel()` gets a dedicated `FuelWitness`, not a zero-padded `BridgeWitness`.** `FuelWitness(bytes32 to, uint256 amount, bytes32 secretHash)` — three fields. Rationale: (i) a distinct EIP-712 TYPEHASH makes cross-entrypoint witness confusion impossible by construction (a signature produced for `fuel` can never satisfy `bridge`/`bridgeWithFuel` or vice versa); (ii) a 12-field witness with 8 zeroed fields is a review hazard; (iii) the asset and amount are additionally bound by Permit2's `TokenPermissions`, and the FeeJuicePortal is `immutable` in the router, so three fields suffice. Cost: a new TYPEHASH + TYPE_STRING + TS mirror + pinned vectors — one keystone-shaped test pair.

**D-M3 — Secret derivation (c), concrete scheme.** Mirror the private-fuel mechanism with a new domain separator:

- Noir (`contracts/bridge/aztec/token_bridge/src/main.nr`):
  ```
  fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
      ...
      let secret = poseidon2_hash_with_separator([claim_salt, recipient.to_field()], DOM_SEP__TOKEN_BRIDGE_CLAIM_SECRET);
      self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, message_leaf_index);
      self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_private(recipient, amount));
  }
  ```
  The old bearer signature (`secret_for_L1_to_L2_message_consumption`) is REMOVED, not kept alongside — any surviving raw-secret entrypoint voids the binding.
- Domain separator: `DOM_SEP__TOKEN_BRIDGE_CLAIM_SECRET = poseidon2_hash_bytes("nulo_dom_sep__token_bridge_claim_secret") as u32`, pinned as a literal in Noir and TS (module-load poseidon crashes jsdom consumers — same reason as `private-fuel.ts:20-27`), with a node-side keystone test re-deriving and asserting equality. MUST differ from the FPC's `DOM_SEP__FPC_BRIDGE_SECRET = 3952304070` (cross-protocol secret-reuse hygiene).
- TS (`packages/bridge-core/src/claim-secret.ts`, new): `deriveClaimSecret(salt, recipient) = poseidon2HashWithSeparator([salt, recipient], DOM_SEP__TOKEN_BRIDGE_CLAIM_SECRET)`; deposit-side `secretHash = computeSecretHash(deriveClaimSecret(salt, recipient))`. Public-path secrets stay `Fr.random()` (claim_public's content hash already binds `to`).
- **Soundness argument**: the L1→L2 message's `secretHash` is fixed at deposit as `H(poseidon2_ds([salt, R]))`. `consume_l1_to_l2_message` only consumes with a `secret` whose hash matches. The new `claim_private` derives that secret from its `recipient` ARGUMENT — a claim naming `R' ≠ R` derives a different secret, whose hash cannot match without a poseidon2 (or secret-hash) collision. Message consumption is protocol-scoped to the message's L2 recipient contract (the new bridge), and the new bridge exposes no raw-secret consumption path, so the derivation is the only door. Binding therefore reduces to: collision resistance of poseidon2-with-separator and of `computeSecretHash`, plus "no alternate consumption entrypoint" (enforced by review + test).
- **Relayer semantics**: relayer receives `(salt, recipient, amount, leafIndex)`. It can compute the derived secret, but no contract accepts a raw secret, and messages are recipient-contract-scoped — worst case it claims *for* the user (altruism) or does nothing (user self-claims later). Griefing surface: none beyond fee-spend refusal. The relayer necessarily learns the recipient address — inherent to relaying, off-chain only.

**D-M4 — Cutover rides the existing `stale-deployment` machinery.** Journal records already pin `portal`+`bridge` addresses and get flagged `stale-deployment` when they don't match current config (`apps/faucet/src/composables/useBridgeJournal.ts:285-300`). Policy: land contracts + config + faucet code on dev in one release train; the LIVE faucet only changes at the next `main` promote, so the on-dev cutover window is invisible to users. Old stack stays on-chain forever; pre-cutover records show `stale-deployment` with honest copy. Drain policy for in-flight testnet deposits = **Ask A-1**.

**D-M5 — Direct-path deletion scope** (all in one phase, tests moved not dropped): `flows.ts` `runDeposit`'s approve+direct-deposit legs (`packages/bridge-core/src/flows.ts:79-111`), the faucet non-fuel approve branch (`apps/faucet/src/composables/useDeposit.ts:849-926`), approve stepper phases for bridge records (`apps/faucet/src/lib/bridge-steps.ts`), leaf-index extraction moves from Inbox `MessageSent` to the router `Bridge` event. `useFuel` keeps ONE conditional approve step (the canonical fee asset does not pre-approve Permit2): first-ever fuel = `approve(Permit2, max)` + sign; thereafter sign-only.

## Phases

### Phase 1 — L1: `fuel()` entrypoint + FuelWitness + the fuzz suite
Add `fuel(FuelParams, PermitParams)` to `SwapBridgeRouter` (pull via `permitWitnessTransferFrom` with FuelWitness → `forceApprove(feeJuicePortal)` → `depositToAztecPublic(to, amount, secretHash)` → approve-to-zero → `Fuel` event). Zero-amount / zero-recipient reverts. New `test/SwapBridgeRouterFuzz.t.sol`:
- `testFuzz_bridge_paramsFlowThrough` (amount/recipient/secretHash/isPrivate → portal receives exact params, router residue == 0)
- `testFuzz_bridgeWithFuel_conservation` (fuel ∈ [1, total-1], fuzzed swap rate → bridge+fuel slices conserve, residue 0, signed floor binds)
- `testFuzz_fuel_paramsFlowThrough` (same shape for `fuel()`)
- `testFuzz_witnessFieldTamper` (any single-field mutation changes the witness hash — differential, via the existing harness pattern)
- revert-bound fuzz (invalid fuelAmount, zero amounts)
Plus fixed-vector unit tests for `fuel()` mirroring the existing `bridge()` ones, and `WitnessHash.t.sol` gains the pinned FuelWitness vector.
**Validation gate**: `cd contracts/bridge/evm && forge build && forge test` — exit 0, fuzz tests visibly run (default 256 runs). Layers: unit + fuzz.

### Phase 2 — L2: claim_private secret derivation + keystone pins
`main.nr` change per D-M3; new DS constant; keystone package gains (i) DS re-derivation pin, (ii) derived-secret fixed-vector pins (salt, recipient → literal). TXE test for "wrong recipient fails to consume" if TXE supports L1→L2 message injection (verify `aztec-nr` test utils; if not, the property is covered by the vector pins + Phase 6 sandbox rehearsal + Phase 7 live canary).
**Validation gate**: `cd contracts/bridge/aztec/token_bridge && nargo test` and `cd contracts/bridge/aztec/keystone && nargo test` — exit 0. Layers: unit (Noir).

### Phase 3 — bridge-core rewire + relayer script
- `router-abi.ts`: expose `bridge` + `fuel` + events (regenerate; `router-abi.test.ts` pins updated).
- `l1.ts`: FuelWitness EIP-712 types + `fuelWitnessPermitTypedData` + `hashFuelWitness`; `l1.test.ts` pins byte-matched to Phase 1's `WitnessHash.t.sol` vectors.
- `claim-secret.ts` (new) per D-M3 with keystone test byte-matching the Noir vectors.
- `flows.ts`: deposit flow becomes router-based (witness sign → `bridge()` → leaf from `Bridge` event); private secrets derived (salt persisted via RecoveryHooks instead of a bearer secret — hook docs + README bearer warning rewritten to the new model); fuel-only Permit2 flow added; direct-path code deleted; testnet scripts (`deposit-testnet.ts`, `fuel-testnet.ts`) rewired.
- New `scripts/claim-relayer-testnet.ts`: takes `(salt, recipient, amount, leafIndex)` + a relayer Aztec account, submits `claim_private` from that account. Reference implementation + live canary #3.
**Validation gate**: `bun run --cwd packages/bridge-core test` + `bun run --cwd packages/bridge-core typecheck` + `cd contracts/bridge/evm && forge test` (cross-pins) + `bun run lint` — all exit 0. Layers: unit + cross-toolchain pins.

### Phase 4 — faucet rewire
- `useDeposit.ts`: delete the approve branch; both fuel-toggle states sign (BridgeWitness → `bridge()` / `bridgeWithFuel()`); private records persist the salt; journal envelope handles the new field (additive if the envelope schema allows, else version bump — decide against `DepositEnvelopeV2`'s actual shape).
- `useFuel.ts`: conditional one-time `approve(Permit2, max)` step + FuelWitness sign + `router.fuel()`; fail-closed allowance assert mirrors `useDeposit.ts:718-726`.
- `bridge-steps.ts`: bridge phases lose APPROVE, gain SIGN everywhere; fuel phases get conditional APPROVE-ONCE + SIGN; copy in plain language.
- Component/unit tests updated; all existing `data-testid`s preserved; new steps get new testids.
**Validation gate**: `bun run test:faucet` + `bun run typecheck:all` + `bun run lint` — exit 0. (`verify:deployments` untouched — config flips in Phase 6.) Layers: unit + component.

### Phase 5 — fork tests (pre-deploy)
Extend `SwapBridgeRouterPermit2Fork.t.sol`: `bridge()` happy/replay/expiry/tamper against REAL Permit2; `fuel()` happy + replay against REAL Permit2 and the real fee asset (fork-approve Permit2 once, proving the approve-once UX assumption). Update `DeployFuelLive.fork.t.sol` to rehearse the NEW router deployment (idempotent envs) against live topology.
**Validation gate**: `cd contracts/bridge/evm && SEPOLIA_RPC_URL=<rpc> forge test` — all fork suites green. Layers: integration (fork, real Permit2/V4).

### Phase 6 — deploy + repo cutover (sandbox rehearsal first)
1. Sandbox rehearsal: `bun run --cwd packages/bridge-core deploy:sandbox` + a scripted end-to-end (public deposit, private deposit self-claim, private deposit relayer-claim, fueled deposit, fuel-only) against the local sandbox.
2. Live deploy (needs `PRIVATE_KEY`, `SEPOLIA_RPC_URL` — surface to user if absent): new router via updated `DeployFuelLive.s.sol` (reuse existing `UniswapFuelSwap`); new L2 token+proxy+bridge + fresh `NuloTokenPortal` instance via the existing deploy scripts (`deploy-bridge-testnet.ts` + portal-artifact flow); initialize wiring; Etherscan-verify.
3. Repo cutover: `apps/faucet/public/testnet-bridge.json` updated (new portal/bridge/token/router/swapTarget), `verify:deployments` green, docs updated in the same PR (bridge-core README bearer section rewrite, evm README, `SECURITY.md` F-007 status note).
**Validation gate**: sandbox rehearsal script green; `bun run audit:faucet` (includes `verify:deployments` + faucet build) exit 0. Layers: integration (sandbox) + config verification.

### Phase 7 — live canaries (post-promote)
After the release train promotes to `main` and the live faucet serves the new config, run the five canaries against Sepolia + Aztec testnet via the bridge-core scripts:
1. public bridge via `bridge()`; 2. private bridge, self-claim; 3. private bridge, **relayer-claim from a separate account** (the F-007 closure proof); 4. bridge+fuel (private); 5. fuel-only Permit2 — first-time (approve-once + sign) AND repeat (sign-only).
**Validation gate**: all five settle with L2 balances verified; canary transcript recorded in `lessons/`. Layers: live-network e2e.

### Phase 8 — focused re-audit + fix loop
Redteam-style audit of ONLY the changed surface (new `fuel()` + FuelWitness, the secret-derivation scheme end-to-end, the deleted-path collateral, cutover config), same shape as `audit/security/2026-06-14-bridge-redteam/` but narrower; findings triaged and fixed; wrap-up + `implementations-plan/index.md` closure.
**Validation gate**: all High/Critical findings fixed or explicitly risk-accepted by the user; full repo gates green (`bun run audit:faucet`, `forge test`, `nargo test` ×2, `bun run --cwd packages/bridge-core test`).

## Security & Adversarial Considerations

- **Threat model**: attackers = malicious relayers (redirect/grief), front-runners watching L1 calldata + Aztec mempool, a malicious/compromised swapTarget owner (bounded by F-004 witness binding), phishing sites replaying Permit2 signatures, ourselves (deploy-key compromise → owner functions: `setSwapTarget`, `sweep`).
- **Witness integrity**: every user-signed intent field must be witness-bound; FuelWitness TYPEHASH distinct from BridgeWitness (cross-entrypoint confusion impossible); TYPE_STRING/TYPEHASH/`_hash*`/TS mirror updated atomically with pinned vectors (drift = unmatchable signature = funds never pulled — fail-safe, but UX-breaking).
- **Signature reuse/replay**: Permit2 SignatureTransfer nonces are single-use; deadline bounds exposure; chainId + verifyingContract in domain. Fork tests assert replay + expiry rejection for the new entrypoints.
- **Cross-protocol secret reuse**: new DS distinct from FPC's; keystone pins both; salt is per-deposit random.
- **Front-running**: private deposits' L1 calldata reveals amount + secretHash only; with recipient-bound secrets a stolen salt no longer redirects funds (F-007 closed) — theft downgrades to altruistic-claim griefing, matching the public path.
- **Reorg**: L1 deposit reorged after L2 claim attempt → message absent, claim retry loop tolerates; deposit re-included later remains claimable (same secretHash). No change from status quo; canary sequencing waits L1 finality as today.
- **Input validation**: router requires non-zero amounts/portal/recipient; fuel() validates `to != 0`; TS validates config addresses via `verify:deployments`; faucet fail-closed allowance asserts before signing.
- **Least privilege**: deploy key only holds testnet ETH; router owner functions unchanged (`Ownable2Step`); no new privileged roles introduced; relayer script needs only its own funded Aztec account — never the user's keys.
- **Supply chain**: no new npm deps; Permit2 is the canonical deployed instance (no vendored source in prod path); OZ + forge-std already installed.

## Assumptions

**Facts** (verified):
- `bridge()` exists, witness-bound, unit-tested, dormant — `contracts/bridge/evm/src/SwapBridgeRouter.sol:244-284`; `router-abi.ts` exposes only `bridgeWithFuel`.
- Private content hash omits recipient on both sides — `contracts/bridge/evm/upstream/NuloTokenPortal.sol:116`, `contracts/bridge/aztec/token_bridge/src/main.nr:114`.
- `token_minter_proxy` wiring is one-time immutable — `set_bridge` initialize-once (`contracts/bridge/aztec/token_minter_proxy/src/main.nr:39-44`) ⇒ (c) forces full L2 stack redeploy + fresh portal instance.
- Derivation precedent: `packages/bridge-core/src/private-fuel.ts:52-53` (`poseidon2HashWithSeparator`, DS pinned literal + keystone re-derivation test).
- Journal records pin `portal`+`bridge` and flag `stale-deployment` on mismatch — `apps/faucet/src/composables/useBridgeJournal.ts:285-300`.
- Fee asset lacks a Permit2 pre-approval; AZLO has one — `contracts/bridge/evm/src/MintableERC20.sol:47-50` (AZLO-only override).
- `token_portal_content_hash_lib` resolves to the upstream aztec-packages git tag (`contracts/bridge/aztec/token_bridge/Nargo.toml`) — untouched by this design.
- Foundry suite: 32 tests, zero fuzz, no CI invocation anywhere.

**Inferences** (unverified — attack these):
- I-1: TXE can(not) inject L1→L2 messages for a Noir-level binding test — needs verification; plan has fallbacks.
- I-2: The `Bridge` event carries everything the TS flow needs for leaf-index extraction (key, index) — read of the event fields says yes, not yet exercised.
- I-3: `DepositEnvelopeV2` can carry the salt additively without a version bump — schema not yet read end-to-end.
- I-4: The currently-deployed router matches current source (irrelevant under D-M1's redeploy, but stated for honesty).
- I-5: Faucet production deploy only changes at `main` promote (CF Git-integration on main) — so the dev-side cutover window is user-invisible.
- I-6: `deploy-bridge-testnet.ts` + `build-portal-artifact.ts` handle the portal-instance + L2-stack wiring order (portal deploy → L2 deploy → portal.initialize) without changes beyond addresses.

**Asks**:
- A-1: Drain policy for in-flight old-stack deposits at cutover (proposal: none — testnet, `stale-deployment` copy + old stack stays on-chain; anyone with sealed secrets claims via script).
- A-2: Confirm the release-train coupling: contracts deploy + config flip + faucet code land on dev together; live cutover happens at the next promote (no interim faucet deploy).
- A-3: Extension-side UX after cutover: users must re-add the NEW token (old balances orphaned, as in a network reset). Acceptable?
- A-4: The relayer script's account funding: dedicated testnet account (recommended) or reuse the deploy key's Aztec counterpart?

## Migration / rollback

- Rollback before cutover: nothing deployed, revert commits.
- Rollback after L1/L2 deploy but before config flip: abandon new stack (testnet cost only).
- Rollback after promote: revert `testnet-bridge.json` + faucet to old stack (old contracts still live); new-stack deposits then show `stale-deployment` — symmetric, honest.
- Funds-stranding review at every step: a deposit is strandable only by (i) secretHash/salt loss (RecoveryHooks persist BEFORE the L1 tx — preserved), (ii) content-hash drift (keystones — untouched), (iii) witness drift (pins — extended to FuelWitness), (iv) derivation drift Noir↔TS (NEW keystone pins added in Phases 2–3).
