# Research: bridge Noir crates + bridge TS — aztec-nr 4.2.0 → 5.0.0-rc.1

Paths repo-relative.

## Noir crate inventory + Nargo.toml dep tags
- `packages/bridge-aztec/token_bridge/` (src/main.nr, src/config.nr) — aztec-nr `v4.2.0-aztecnr-rc.2`, `token_portal_content_hash_lib` same tag, depends local `token_minter_proxy`.
- `packages/bridge-aztec/token_minter_proxy/` (src/main.nr) — aztec-nr `v4.2.0-aztecnr-rc.2`, `token` from `@defi-wonderland/aztec-standards` (`prerelease-1ad0e28`).
- `packages/bridge-aztec/keystone/` (src/main.nr) — test bin, aztec-nr `v4.2.0-aztecnr-rc.2`.
- Compile: `packages/bridge-aztec/scripts/compile.sh` runs `aztec compile` (nargo + AVM transpile) + path-scrub for reproducible artifacts. Toolchain pinned via `~/.aztec/versions/<tag>`.

## Noir breaking-site assessment (per changelog item)
The bridge contracts are **pure logic contracts** (NOT account contracts): no `get_public_keys`, no schnorr verify, no nullifier-membership-witness, no custom `sync_state`, no `for_each`/capsule mutation, no `emit_*_log_unsafe`, no protocol-address constants, no `attempt_note_discovery`. → **most aztec-nr breaking items do NOT bite.**

The ONE real audit zone: **message API** in `token_bridge/src/main.nr`:
- :98 `self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, leaf_index)` (public claim)
- :115 same (private claim)
- :132,:144 `self.context.message_portal(config.portal, content)` (public/private exit)

5.0 renamed `messages::message_delivery` → `messages::delivery`, changed `MessageDelivery.X` → `MessageDelivery::x()`, removed `set_sender_for_tags` oracle (→ `.with_sender()`). Need to confirm whether `consume_l1_to_l2_message` / `message_portal` context helpers changed signature/module path at 5.0. LIKELY churn — message handling is a known 5.0 vector. MUST read 5.0 aztec-nr `context/` source.

Also recheck for `get_contract_instance(...).contract_class_id` (→ `original_contract_class_id`) — none found in current crates, but re-grep after any refactor.

## Bridge TS breaking sites (bridge-core)
- `packages/bridge-core/src/flows.ts:186` `node.getTxEffect(txHash)` → migrate to `getTxReceipt(h,{includeTxEffect:true})`; `:188` reads `eff.data.l2ToL1Msgs[0]`.
- `flows.ts:190,198` `computeL2ToL1MembershipWitness(...)` → `wit.leafIndex`/`wit.siblingPath`; the underlying Noir oracle return split (index→leaf_index, path→sibling_path) — verify the TS `MembershipWitness` field names at 5.0.
- Deploy flow: `deploy-bridge-testnet.ts`, `deploy-sandbox.ts` use `getContractInstanceFromInstantiationParams`, `Contract.deploy(...).send({contractAddressSalt, universalDeploy, wait})`. 5.0 **DeployMethod construction-time params**: salt/deployer/publicKeys move to constructor; `deployWithPublicKeys` gone; sync `address`/`partialAddress` getters → async `getAddress()/getPartialAddress()`; `.send()` always returns `{contract,receipt,instance}` (no `returnReceipt`). Migrate all deploy call sites.
- `deploy-sandbox.ts:110-111` `getInitialTestAccountsData()` + `createSchnorrAccount(acct.secret, acct.salt, acct.signingKey)` → **prefunded accounts are initializerless in 5.0** → `createSchnorrInitializerlessAccount`. THE concrete initializerless site.
- Other `createSchnorrAccount` (fuel-testnet, smoke-*, deposit-testnet, faucet deploy.ts:299) derive from OWN secrets → stay `createSchnorrAccount` (still exists).
- `SponsoredFeePaymentMethod(fpc.address)` — verify ctor at 5.0.

## Schnorr exposure
Noir: none. TS: account creation via wallet-sdk `createSchnorrAccount` — the Poseidon2 signature-scheme change is absorbed by `@aztec/accounts`/`wallet-sdk` 5.0; fresh accounts each deploy run, so no migration beyond the bump. Existing testnet accounts die (accepted: "document reset").

## Standards / fee-payment deps inside Noir
`token_minter_proxy` imports `token` from `@defi-wonderland/aztec-standards` git tag `prerelease-1ad0e28` in its Nargo.toml — must bump to the **Noir tag matching `prerelease-334c38d`** (the TS tarball). Confirm the standards repo's Noir-consumable tag for 5.0.

## Precedent
- `bridge-security-remediation`: deployment write-ahead journal (`testnet-bridge.journal.jsonl`) — if TxReceipt shape changes, journal parsing must follow.
- `verify:l1` checks keccak(deployed bytecode) == artifact hash; recompile if portal Solidity / `@aztec/l1-artifacts` changed.
- `--smoke` end-to-end (deposit/claim/withdraw/consume) is the bridge gold gate.

## Open questions / risks
1. Message-context API at 5.0 (HIGH) — `consume_l1_to_l2_message`/`message_portal` module + signature.
2. Standards Noir tag for 5.0 (HIGH) — `token_minter_proxy` Nargo dep + the TS `prerelease-334c38d` must be a matched pair.
3. MembershipWitness TS field rename (MEDIUM) — `flows.ts:198`.
4. DeployMethod construction-time migration across all bridge deploy scripts (MEDIUM).
