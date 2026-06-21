# Phase 5 — Noir recompile + bridge-core TS (code ✓; bridge smoke pending sandbox) — ba6c306a, 9c25d797

## Noir recompile (the toolchain IS installed locally at 5.0.0-rc.1)
- Nargo.toml (token_bridge, token_minter_proxy, keystone): `aztec` + `token_portal_content_hash_lib` → `v5.0.0-rc.1` (confirmed: the aztec-packages tag + what `aztec-standards@prerelease-334c38d` itself pins); standards `token` → `prerelease-334c38d`.
- `compile.sh`: 5.0 toolchain wiring — `~/.aztec/versions/5.0.0-rc.1`, `aztec-nargo` (5.0 renamed bundled bare binaries to `aztec-*` on PATH), `bb` in node_modules/.bin.
- **No Noir SOURCE changes needed** — `token_bridge`'s `consume_l1_to_l2_message`/`message_portal` context helpers were insulated from the 5.0 message-API churn (research/03 predicted this). Both deployable crates compiled + transpiled clean.
- `keystone` (type=bin Noir TEST harness, not deployed, not TS-imported): `aztec-nargo compile` timed out at 300s locally — NOT on the critical path; deferred (verify in CI / when convenient).

## bridge-core TS
- `computeL2ToL1MembershipWitness` gained a new 2nd arg `OutboxRootsReader | Fr[]` → wired `OutboxContract` (new `@aztec/ethereum` dep in bridge-core + faucet) from `node.getNodeInfo().l1ContractAddresses.outboxAddress` + `l1.pub`. `OutboxContract.getRoots` satisfies the reader.
- **SECURITY FIX (was masked by `as never`):** the L1 portal `withdraw` args changed to 7 — `(recipient, amount, withCaller, epoch, numCheckpointsInEpoch, leafIndex, path)`. The old 6-arg build had `leafIndex`+`path` in the wrong slots and omitted `numCheckpointsInEpoch` → withdrawals would have reverted on L1. Fixed in flows.ts + withdraw.test.ts.
- `PRIVATE_FPC_ADDRESS` re-pinned `0x1b17…` → `0x1fa8…5c4c` (fb6f196 tgz bytecode; tripwire-driven).
- `getTxEffect` (flows.ts:186) still compiles (deprecated-but-present in 5.0) — left as-is; migrate to `getTxReceipt({includeTxEffect})` as a deprecation-cleanup follow-up.
- Gate: 3 crates' deployable artifacts compile; `aztec-nargo` toolchain green; bridge-core typecheck 0 + 112 tests (incl. PrivateFPC tripwire + the 7-arg withdraw assertion).

## Remaining (sandbox-dependent)
- Bridge `--smoke` (deposit/claim/withdraw/consume) on a 5.0 sandbox — validates the withdraw-args fix end-to-end.
- keystone full compile/test.
- On-chain testnet redeploy of faucet/bridge contracts (operational, documented).

LESSONS_FILE=implementations-plan/aztec-5.0-upgrade/lessons/phase-5.md
