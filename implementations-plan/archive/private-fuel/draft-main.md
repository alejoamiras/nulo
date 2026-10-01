# private-fuel — draft A (main agent)

Private Fee Juice across the bridge: a PRIVATE token bridge arrives with gas via the Wonderland PrivateFPC, no L1 address leak. Gas privacy follows token privacy (public→public FJ, private→private FJ). Ships with the B-presets UI (private default) and removes the "fuel withheld on private" guard. Branch `feat/private-fuel`. Aztec 4.2.0. Testnet only.

## What already exists (don't rebuild)
- Public fuel end-to-end (PR #84 on dev): `SwapBridgeRouter.bridgeWithFuel` with `fuelRecipient`/`fuelSecretHash` (witness-bound, fork-tested), bridge-core route/quote/journal(schema-2)/fee-juice, faucet fueled branch + the L14-v3 settlement ladder, live verified contracts + pools.
- `@wonderland/aztec-fee-payment` installed (prerelease-215fd08): `registerPrivateContract`, `PrivateMintAndPayFeePaymentMethod`, `PrivateFPCContract(Artifact)`, gas utils.
- Extension embedded-fee path: `detectEmbeddedFeePayment(feePayer, from)` → fjwc/fpc/default; `operation-planner` maps to `AccountFeePaymentMethodOptions`.

## The mechanism (the crux, verified)
- **Private fuel L1 deposit**: `fuelRecipient = PrivateFPC L2 address`, `fuelSecretHash = computeSecretHash(derive_bridge_secret(salt, user))` where `derive_bridge_secret(salt, claimer) = poseidon2_hash_with_separator([salt, claimer], DOM_SEP__FPC_BRIDGE_SECRET)`, `DOM_SEP = poseidon2_hash_bytes("az_dom_sep__fpc_bridge_secret") as u32`. **No Solidity change** — bridge-core just computes these two fields differently for private fuel.
- **Private fuel L2 claim**: `PrivateMintAndPayFeePaymentMethod(fpc, amount, secret, salt, leafIndex)` → `FeeJuice.claim(fpc,…)` then `PrivateFPC.mint_and_pay_fee(amount, salt, leafIndex)`; the FPC re-derives from `msg_sender`, credits `(amount − maxGasCost)` to the user, pays the sequencer. The user-binding lives entirely in the secret/salt derivation.
- **FPC address is deterministic + bytecode-version-specific** (no deploy tx; `registerPrivateContract(wallet, salt)`). Wrong version ⇒ wrong address ⇒ **unrecoverable FJ loss**.

## Phases

### P0 — FPC address determinism + dust canary (the irreversible-loss gate; FIRST)
- Compute the PrivateFPC address from the INSTALLED `@wonderland/aztec-fee-payment` artifact (215fd08) at a chosen `PRIVATE_FPC_SALT`. Reconcile vs the local rc.2 clone (different bytecode ⇒ different address) — **pin the artifact whose bytecode matches the testnet's running Aztec version** (probe `getNodeInfo`/protocol version).
- **Dust canary** (headless): mint a tiny FJ, bridge it to the computed FPC address with `derive_bridge_secret(salt, user)`, claim via `PrivateMintAndPayFeePaymentMethod`, assert the user's FJ/balance moved AND nothing reverted. Nothing downstream may deposit real FJ to the FPC until this round-trips.
- Decision (Ask): version-pin policy (keep 215fd08 vs re-pin to match testnet). Record the address + salt + the matching version in `deployments.md`.
**Gate:** the canary round-trips on live testnet (real proofs); FPC address recorded with its bytecode version. `forge`/unit untouched.

### P1 — `derive_bridge_secret` TS↔Noir keystone (bridge-core)
- `bridge-core/src/private-fuel.ts`: `deriveBridgeSecret(salt: Fr, user: AztecAddress): Fr` via `poseidon2HashWithSeparator` + the computed `DOM_SEP` constant; `privateFuelSecretHash(salt, user)`.
- **Keystone test**: TS output vs a pinned Noir fixture (and, if the package exposes it, vs the Wonderland helper). Also pin `DOM_SEP` against `poseidon2_hash_bytes("az_dom_sep__fpc_bridge_secret") as u32`.
**Gate:** `bun run --cwd packages/bridge-core test` green; the keystone asserts an exact byte match against the Noir fixture. (Layers: unit.)

### P2 — bridge-core private-fuel plumbing
- `fee-juice.ts`: `privateFeeJuicePayment(fpc, { amount, secret, salt, leafIndex })` = `PrivateMintAndPayFeePaymentMethod`; `registerPrivateFpc(wallet, salt)` re-export/wrap.
- Route the deposit: a `private` flag on the fuel intent → `fuelRecipient = fpc`, `fuelSecretHash = privateFuelSecretHash(salt, user)`. Journal schema: the fuel block gains `salt` + `private: boolean` (the claim rebuilds the Wonderland method from them; schema bump + backup validation + old-record load).
**Gate:** `bun run --cwd packages/bridge-core test` (witness/route pins still green; new private-secret + schema pins). (Layers: unit.)

### P3 — wallet private-fjwc embedded mode (wallet-bridge + extension)
- `operation.ts` `FeeOptions`: add the private-bridged-FJ mode + carry `{ fpc, amount, secret, salt, leafIndex }`. (Mirror how fjwc carries its claim args today — research the channel.)
- extension: `detectEmbeddedFeePayment` distinguishes feePayer=FPC + private-bridged marker → the new mode (NOT generic EXTERNAL); the executor `registerPrivateContract` in the wallet PXE + builds `PrivateMintAndPayFeePaymentMethod`; gas-cap handling for the private method (Wonderland `DEFAULT_FEE_MULTIPLIER`/`maxGasCostFor`, vs fjwc's 1.0× cap).
- Manifest: scope `FeeJuice.claim` + `PrivateFPC.mint_and_pay_fee` (tx + sim). Re-consent via the field-diff (built last arc).
- The **no-fuel "wallet chooses"** change: stop forcing Sponsored — when no fuel, send no embedded fee method; verify the wallet default pays (cold-start risk: a zero-FJ no-fuel claim).
**Gate:** `bun run --cwd packages/wallet-bridge test` + `bun run audit:vue` (extension typecheck+tests); dispatcher pins for the new mode + scope. Manual dev-build smoke: a private-fuel claim simulates with the FPC registered + the private method, no scope violation. (Layers: unit + typecheck + a manual extension smoke.)

### P4 — faucet: private claim path, no-fuel default, B-presets UI
- `useDeposit.ts`: private-fuel deposit branch (compute salt + private secret, deposit to FPC) + the claim path selecting `privateFeeJuicePayment`; no-fuel claims drop the forced Sponsored. The settlement ladder (L14) extends to the private path (consumed/recovery semantics identical — the FPC claim is the consumption signal).
- `BridgeForm.vue`: B-presets cards (PUBLIC / PRIVATE, **private default**), gas follows the card, REMOVE the "fuel withheld on private" guard, fuller copy (per `fuel-privacy-ux.html`).
- Journal/backup carry salt + private flag (schema continuity).
**Gate:** `bun run audit:vue` green; component pins (B-presets default+selection, private+fuel produces the private claim path, no-fuel sends no forced sponsored, guard gone). (Layers: unit + component + build.)

### P5 — headless live validation (the arc gate)
- Extend `bridge-core/scripts/fuel-testnet.ts` with a PRIVATE-FJ variant: register FPC, mint AZLO, `bridgeWithFuel` to the FPC with the private secret, claim via `PrivateMintAndPayFeePaymentMethod`, assert L2 token (private) + the user's FJ credited + the FPC paid + **no user Aztec address in the L1 deposit calldata** (the leak check). Both token privacies.
**Gate:** both variants pass live (~30-60 min real proofs each); the no-leak assertion holds. (Layers: live-network e2e.)

### P6 — /harden security (close-out)
- `/harden security` over the bridge + fee surface (the FPC integration, the secret derivation, the fee-method matrix, the manifest scope). Triage + fix high/critical.
**Gate:** `/harden security` report filed; high/critical addressed.

## Security & Adversarial Considerations
- **Wrong FPC address ⇒ unrecoverable FJ loss** (the headline risk): mitigated by P0's version-matched computation + dust canary + a runtime assertion that the configured FPC address equals `registerPrivateContract`'s output for the pinned salt+version. Never deposit real FJ to an unverified address.
- **`derive_bridge_secret` TS↔Noir mismatch ⇒ FJ stranded** (claimable by no one): the P1 keystone is the gate; a drift fails the build.
- **Privacy leaks (the whole point)**: a private-fuel claim paid by Sponsored or public-FJ would link the user — the fee-method matrix is a SECURITY invariant, not UX. Pin: private bridge ⇒ private fee method, asserted in the claim builder + a wallet-side check. The L1 deposit for private fuel must set `fuelRecipient = FPC` (not user) — a bug here either leaks (user addr on L1) or loses (FJ to a non-FPC).
- **No-fuel cold-start**: dropping forced Sponsored must not strand a zero-FJ account — verify the wallet default (it may itself fall back to sponsored; if so, a no-fuel *private* bridge's sponsored claim is acceptable since no FJ is involved, but confirm it's not a privacy regression vs the token claim).
- **Manifest least-privilege**: scope exactly `FeeJuice.claim` + `PrivateFPC.mint_and_pay_fee`, no wildcards; re-consent honestly via the field-diff.
- **FPC version drift**: an Aztec bump changes the FPC bytecode ⇒ address ⇒ a silent fund-loss trap; pin the version + assert at runtime; document the re-derive procedure.
- Supply chain: the Wonderland tarball is a GitHub-release pin in bun.lock (not npm) — frozen-lockfile CI covers drift; note it's outside the 7-day npm gate.

## Assumptions
**Facts** (verified): the mechanism above (Wonderland API, the Noir derivation, the router's existing fuelRecipient/fuelSecretHash, the extension's detectEmbeddedFeePayment, the faucet's hardwired Sponsored claim) — file:line in the final plan.
**Inferences** (attack): the testnet's Aztec version matches one of the two installed/clone artifacts (P0 verifies); the wallet can `registerPrivateContract` in its PXE mid-claim and build the method (P3 smoke); fjwc's arg-carriage extends to 5 args; the no-fuel wallet-default can pay a cold-start claim.
**Asks**: version-pin policy (215fd08 vs rc.2 — resolved in P0); whether a no-fuel zero-FJ claim needs an explicit sponsored fallback (vs trusting the wallet default).

## Out of scope
Mainnet; private FJ on a non-swap "plain bridge" (fuel == swap path); the Playwright e2e arc (still separate).
