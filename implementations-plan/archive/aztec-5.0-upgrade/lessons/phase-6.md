# Phase 6 — network-e2e infra adaptation to Aztec 5.0

The TS/Noir migration (P1–P5) went green locally, but the **network-e2e sandbox harness** needed two separate 5.0 fixes before the node would boot in CI. Both failed as `exit 86` (the boot-failure sentinel) with every shard failing identically — systematic, not flaky.

## Blocker 1 — bundled bare binaries renamed `aztec-*` (FIXED)

5.0's installer renamed the bundled bare foundry binaries on PATH: `anvil` → `aztec-anvil` (etc.). `global-setup.ts` probed `~/.aztec/current/bin/anvil`, which no longer exists, so the anvil spawn failed at `ls: cannot access '~/.aztec/current/bin/anvil'`.

**Fix:** `ANVIL_BIN` → `~/.aztec/current/bin/aztec-anvil`; same rename in `setup-aztec/action.yml`, `global-setup.ts`, `docker-ci-like.sh`.

## Blocker 2 — node spawn bypasses the `bin/aztec` wrapper → wrong `forge` for L1 deploy (FIXED)

After Blocker 1, setup got past anvil but the **aztec node** died during boot:

```
[aztec-node] Error: Address already in use (os error 98)            ← NON-FATAL noise; node continues
[aztec-node] Setting up Aztec local network 5.0.0-rc.1...
[aztec-node] WARN: ethereum:deploy_aztec_l1_contracts error: the following required arguments were not provided:
[aztec-node] ERROR: cli Error: node exited with code 2              ← THE fatal error
```

The same `aztec start --local-network …` command **succeeded locally** but **failed in CI** — so the args were correct; the environment was the variable.

**Root cause:** the `~/.aztec/current/bin/aztec` wrapper is two lines that matter —
```bash
export PATH="$internal_bin:$PATH"            # internal-bin = bundled forge/cast/anvil, version-matched
exec "$self_dir/../node_modules/.bin/aztec" "$@"
```
`global-setup.ts` spawns the **inner** `node_modules/.bin/aztec` directly (so it can `fs.existsSync` + track the PID), **bypassing the wrapper** — so `internal-bin` was never on PATH. The node's L1-contract deploy shells out to plain `forge`, resolved from the *system* PATH:
- **Locally:** `~/.foundry/bin/forge` happened to be **1.4.1**, the exact version 5.0 bundles → deploy succeeded by coincidence.
- **CI:** `foundry-rs/foundry-toolchain@v1` installs **latest stable** forge → `forge script` CLI args differ from what 5.0's deploy passes → `deploy_aztec_l1_contracts: required arguments were not provided` → exit 2.

(The `Address already in use` line is unrelated noise printed by an internal probe — the node continues past it. It is NOT the cause; chasing it would have been a rabbit hole.)

**Fix** (`global-setup.ts`): replicate the wrapper's PATH prepend on the node spawn's `env`:
```ts
const AZTEC_INTERNAL_BIN = path.resolve(process.env.HOME || "~", ".aztec/current/internal-bin")
// …in the spawn env:
PATH: `${AZTEC_INTERNAL_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
```

### Reusable lesson — reproduce CI node-boot failures locally (no 25-min CI round-trip)

A wrong `forge` on PATH is enough to reproduce the whole failure. Stub it and diff with/without the prepend:

```bash
# stub a "wrong-version" forge that rejects args like CI's does
printf '#!/usr/bin/env bash\necho "error: the following required arguments were not provided:" >&2\nexit 2\n' > /tmp/badforge/forge && chmod +x /tmp/badforge/forge
aztec-anvil --port 18545 --chain-id 31337 --slots-in-an-epoch 1 --silent &   # L1

# A — reproduces CI: bad forge first, no internal-bin
PATH="/tmp/badforge:$PATH" ~/.aztec/current/node_modules/.bin/aztec start --local-network --l1-rpc-urls http://127.0.0.1:18545 …
#   → deploy_aztec_l1_contracts: required arguments were not provided; exit 2

# B — the fix: internal-bin prepended, bad forge still present later
PATH="$HOME/.aztec/current/internal-bin:/tmp/badforge:$PATH" ~/.aztec/current/node_modules/.bin/aztec start --local-network …
#   → [forge_broadcast] Broadcast succeeded; node boots healthy
```

Confirmed: A fails with the exact CI error, B succeeds. Definitive proof before pushing.

## Blocker 3 — 5.0 raised the L2 base fee ~4 orders of magnitude → hardcoded e2e fee ceiling too low (FIXED)

With Blockers 1+2 fixed, the node booted, deployed L1 contracts, and became healthy — then setup died one step later, deploying the **test fixture contracts**:

```
[e2e-setup] Failed to deploy test contracts: Error: maxFeesPerGas.feePerL2Gas must be greater
than or equal to gasFees.feePerL2Gas, but got maxFeesPerGas.feePerL2Gas=100000000000 and
gasFees.feePerL2Gas=924043800000
```

**Root cause:** `fixtures/aztec.ts` pins a flat `maxFeesPerGas` ceiling (`E2E_FEE_GAS`) for SponsoredFPC-paid setup txs — `new GasFees(1e11, 1e11)` (100 gwei). That was a *generous* cap in 4.2.0 (inclusion `feePerL2Gas` ≈ 1.1e8). 5.0 raised the sandbox L2 base fee to ≈ **9.24e11** (~924 gwei), so the cap fell BELOW the live fee and the protocol rejected every setup tx (`maxFeesPerGas` must be ≥ `gasFees`).

**Fix:** bump the ceiling to `1e13` (`new GasFees(10n ** 13n, 10n ** 13n)`). Bounded on both sides:
- **Floor:** must exceed the live ≈9.24e11 → 1e13 gives ~11× headroom for fee variation.
- **Ceiling:** the SponsoredFPC asserts `gasLimits × maxFeesPerGas ≤ budget`; the sandbox fee-juice balance is ~5e22, so `1e13 × (deploy gasLimit ~1e9) = 1e22` stays comfortably under. Going to 1e14+ would risk the balance assertion.

Note the wallet's **runtime** fee path was already 5.0-safe — it derives `maxFeesPerGas` from `node.getCurrentMinFees()` (× 1.5 padding generally; ×1.0 for embedded-FPC via `embedded-fpc-cap.ts`), so it auto-tracks the network. Only the e2e fixture's *flat hardcoded* ceiling needed bumping.

The `Address already in use (os error 98)` line still prints on boot but remains non-fatal noise — setup now proceeds well past it (L1 deploy → health → fixture deploy).

With Blockers 1–3 fixed the suite actually ran: **5/5 bulk shards + heavy/concurrent-confirm passed**. Two test-level failures remained — one deterministic 5.0 API rename, one accelerator-config regression from the Phase-0 pin bump.

## Blocker 4 — `node.isL1ToL2MessageSynced` removed in 5.0 (FIXED)

`heavy/fee-methods` (the Fee Juice claim flow) died: `TypeError: node.isL1ToL2MessageSynced is not a function`. The e2e helper `waitForL1ToL2Message` polled that method (gone in 5.0). The fixtures aren't in the `tsconfig` `include`, so this slipped past `typecheck:all` and only surfaced at runtime.

**Fix** (`fixtures/aztec.ts`): poll `getL1ToL2MessageMembershipWitness("latest", hash)` instead — the witness is present iff the message synced (returns `[index, path] | undefined`). Verified on the 5.0 `AztecNode` interface (`@aztec/stdlib/.../aztec-node.d.ts`); `BlockParameter` accepts `"latest"`.

## Blocker 5 — accelerator-server v1.0.6 deny-by-default origin gating denied the canary's /prove (FIXED)

`canary/real-proving` failed both tests (transfers timed out on the success toast; tx-sendTx-default got `'error'`). The build was correctly required-mode-stamped and `bb_available=true`, and the accelerator received 2 `/prove` requests — but its own log (artifact `/tmp/accelerator-server.log`) showed:

```
INFO accelerator_core::server::auth: Origin not approved (no popup available),
     denying origin=chrome-extension://<id>
```

**Root cause:** the Phase-0 pin bump (v1.0.1 → v1.0.6) crossed accelerator-server's **SEC-01c** change. v1.0.1 with `ALLOWED_ORIGINS` unset → `auth_manager=None` → approve-all (the headless contract our CI + SECURITY.md relied on). v1.0.6 flipped unset to **deny-by-default**: localhost auto-approved, every non-localhost origin denied. Our offscreen prover calls from `chrome-extension://<id>` (non-localhost) and headless CI has no popup to approve → `/prove` denied → no proof → required-mode tx errors/timeouts.

**Fix** (`_network-e2e.yml`): set `ACCEL_ALLOW_ALL: "1"` on the start step (per the v1.0.6 README — `--allow-all`/`ACCEL_ALLOW_ALL=1` opts back into approving every origin; mutually exclusive with `ALLOWED_ORIGINS`, which stays unset). We can't pre-list the origin because the unpacked-extension id isn't known until Chrome loads it. Safe per the unchanged SECURITY.md threat model (loopback-only, single-tenant runner, fork PRs get no secrets). SECURITY.md "Origin authorization" updated to match.

**Lesson:** when bumping an external binary pin, diff its release notes for default-behavior changes — a version bump silently changed an auth default that our "deliberately unset" config depended on. The `bb_available=true` preflight passed (proving was *capable*), masking that requests were being *denied* — the decisive signal was in the binary's own log, not the health endpoint.

## Iteration 2 — once boot + auth were fixed, the suite ran; two test-level refinements

With B1–B5 in, the run actually executed: **5/5 bulk shards + heavy/concurrent-confirm + canary/tx-sendTx-default ✓** — the last confirming native 5.0 proving works **end-to-end** (accelerator log: `Requested version=5.0.0-rc.1 → will download → Proving succeeded`; `tx-sendTx-default` green in 37.8s on its 300s budget). Two holdouts remained:

**B4 follow-up — `getL1ToL2MessageMembershipWitness` was the wrong replacement (hung).** `heavy/fee-methods` (proverless — so NOT a proving issue) hung 300s right after `[bridgeFeeJuice] Bridged …`, with neither "Message synced" nor "+2 L2 blocks confirmed" logged → stuck *inside* the `await` in `waitForL1ToL2Message`. `getL1ToL2MessageMembershipWitness(referenceBlock, hash)` computes a **claim Merkle-proof** and blocks when the message isn't in the tree yet — wrong tool for a presence *poll*. Switched to **`getL1ToL2MessageCheckpoint(hash)`** (hash-only, returns `CheckpointNumber | undefined`; a message is "synced" once checkpointed) — the true `isL1ToL2MessageSynced` analogue. Lesson: for a not-yet-present lookup, prefer the index/checkpoint query over the witness/proof query — the latter can block instead of returning `undefined`.

**Native-proving timeout (transfers canary).** `canary/transfers` failed at step 3 (public→private *shield*) on `sendTransfer`'s 60s "Transaction submitted" toast wait; step 2 (pub→pub) passed at ~25s. The toast only appears *after* client-side proving, and the shield's native proof exceeds 60s. Made that wait **prover-aware** (`process.env.NULO_E2E_PROVERLESS === "1" ? 60_000 : 300_000`) — proverless bulk shards stay tight (honest-fast failures); the prover-ON canary gets headroom matching `tx-sendTx-default`'s existing 300s.

## Iteration 3 — checkpoint poll worked; two deeper issues remain

After the checkpoint + prover-aware-timeout push: **`tx-sendTx-default` ✓**, **sponsored-FPC fee tests ✓**, **pub→pub transfer ✓** — but three holdouts:

**fee-methods (claim flow) — `getL1ToL2MessageCheckpoint` fix CONFIRMED working** (`Message synced after 2006ms`), but the hang moved to the **next** step: the "wait +2 L2 blocks" loop. 5.0 doesn't mint **empty** blocks, so with no pending L2 txs after the bridge the height stalls and the loop hung to the 300s test budget. The checkpoint already confirms claimability, so the +2-block wait is now **bounded** (30s cap, then proceed). Lesson: 4.2.0 test helpers that "wait N more blocks" assume auto-empty-block production — invalid on 5.0; gate such waits on a real signal (checkpoint) + a time cap.

**canary/transfers shield (public→private) — REAL 5.0 issue, NOT a timeout.** With the 300s wait it *still* timed out, and the accelerator logged only 2 proves (tx-sendTx + the pub→pub) — the shield **never reached a prove request**, so it fails in witness-gen / private execution *before* submission. **CI can't diagnose this**: the test process logs only its own output + the timeout, not the offscreen/PXE console where the real error lives. Needs **local reproduction** (run `transfers.test.ts` proverless locally to capture the wallet console — proverless still does witness-gen, so if the shield breaks there it'll reproduce without the Linux-only accelerator).

**shard 3 — `connectPlayground:awaitDiscoverPopup` 30s timeout.** Passed on prior runs → a pre-existing flake (the `network-e2e-required` plan's domain: the connectPlayground discovery/verify popup timing cliffs), not a 5.0 regression.

## Iteration 4 — shield root cause: missing `senderForTags` (CRITICAL real-user fix)

The public→private shield (and ALL private-note-emitting txs) failed on 5.0 in **private execution / witness-gen, before proving**, with PXE's `"Sender for tags is not set"` assertion. This was a **real wallet correctness bug**, not test-only — it would have broken shield + private transfers for every user on 5.0.

**Root cause.** 5.0 delivers private-note messages via `do_private_message_delivery` → `compute_discovery_tag(recipient, sender)`, which throws if the caller didn't supply a **`senderForTags`**. The SDK's `BaseWallet` derives `senderForTags` from `from` and injects it on every `pxe.simulateTx`/`proveTx`/`profileTx` call (`@aztec/wallet-sdk/.../base_wallet.ts`). **We bypass `EmbeddedWallet` and call `pxe.proveTx`/`pxe.simulateTx` directly** (`aztec-runtime/src/pxe/service.ts`), so we never inherited that injection. Public→public works because a public call emits no private note → no discovery tag → `senderForTags` irrelevant.

**Fix** (`packages/aztec-runtime/src/pxe/service.ts`): pass `senderForTags: scopes[0]` on both `proveTx` and `simulateTx`. Our callers build scopes as `[account.address, ...]`, so `scopes[0]` is the tx sender — mirroring `base_wallet`'s `scopesFrom(from)=[from,…]` + `senderForTagsFrom(from)=from`. Verified: native proverless `transfers.test.ts` scenario passes end-to-end (all 8 steps incl. shield + private→private).

**How it was found — 3 parallel codex agents (5.0 source / Wonderland token / our wallet), per user request to conserve Claude tokens.** The agents *disagreed*: the "our wallet" agent wrongly proposed rewriting to the two-step `initialize_transfer_commitment`→`transfer_public_to_commitment` commitment flow; the "token" agent (which actually read the Wonderland ABI+Noir) confirmed `transfer_public_to_private` is a valid **single-call** shield; the "5.0" agent nailed the real mechanism (`compute_discovery_tag` needs `senderForTags`). Reconciled by **verifying against source** — `base_wallet`'s exact `proveTx({scopes, senderForTags})` call + the fact that our code passes neither — rather than trusting any single agent. Lesson: codex agents are advisory and can confidently disagree; the decisive evidence was the SDK's own call shape + the `senderForTagsFrom` docstring naming the exact error.

**Broader lesson:** any wallet that calls PXE `simulateTx`/`proveTx` directly (instead of via `EmbeddedWallet.simulate/send`) MUST pass `senderForTags` (+ `scopes`) itself — the SDK wrappers are the only place that injects them. This applies to every private-execution path, not just the shield.

## Iteration 5 — fee-methods (Fee Juice): two cascading 5.0 issues, both fixed (suite now green)

With senderForTags in, `fee-methods` (the Fee Juice payment tests) still failed — two more 5.0 issues in the bridge→claim test fixture (`fixtures/aztec.ts`), found via a 4th codex agent + follow-on diagnosis:

**(a) L1→L2 message claimability — 5.0 mints no empty blocks.** The bridged FJ claim threw `No L1 to L2 message found`. 5.0 readiness is NOT "message in a checkpoint" — it's "the node/PXE anchor block sits in a checkpoint ≥ the message's." 5.0 only mints an L2 block when txs are pending (`SEQ_MIN_TX_PER_BLOCK=0` doesn't change that), so after the bridge the anchor stalls below the message's checkpoint forever and the claim's membership witness can't be built. `node.mineBlock()` exists on the AztecNodeAdmin *interface* but is NOT in the admin RPC *schema* (so the client can't call it). Fix: `waitForL1ToL2Message` now waits on the real predicate (`getBlockData("latest").checkpointNumber >= getL1ToL2MessageCheckpoint(hash)`) and drives blocks via a caller-supplied `forceBlock` — a cheap sponsored mint. (A pre-existing `produceL2Block` hook used `.simulate()`, which is read-only and mines nothing — a latent bug.)

**(b) PrivateFPC registration — 5.0 deploy options moved to construction time.** The private-FJ path's `PrivateFPCContract.deploy(wallet).register({ deployer: ZERO, … })` threw `Cannot resolve contract address: deployer is not yet locked`. 5.0 moved salt/deployer to construction-time `DeployInstantiationOptions` and rejects a ZERO deployer via the old `.register()` path. Fix: compute + register the instance the SAME way the wallet's auto-discovery does — `getContractInstanceFromInstantiationParams(artifact, { salt: Fr.ZERO, deployer: AztecAddress.ZERO })` + `wallet.registerContract(instance, artifact)` + `Contract.at(...)`. This both sidesteps the locked-deployer error and *guarantees* the address matches the wallet (`fpc/service.ts:91-94`), so the pre-funded PrivateFPC is discoverable.

Verified: all 5 `fee-methods` tests pass proverless locally. Lesson: a "wait N blocks" or "produce a block" helper that uses `.simulate()` is a no-op on 5.0 — only a real (state-changing) `.send()` mines a block.

## Post-impl codex audit (session 019ee0fa) — net diff `origin/dev...HEAD`

Verdict: no CRITICAL. 1 HIGH (fixed), 1 MEDIUM (documented + follow-up), 1 LOW (follow-up).

- **HIGH — FIXED.** `packages/faucet/src/composables/useWithdraw.ts:106` still **encoded the L1 portal `withdraw` with 6 args** — the bridge-core fix (flows.ts) + this file's *decode* path (L131) were updated to 5.0's 7-arg shape, but the *encode* here was missed (masked by `as never`). Would mis-encode/revert on real withdraw finalization. Fixed: inserted `BigInt(wit.numCheckpointsInEpoch)` at position 4 (`wit` already comes from `computeL2ToL1MembershipWitness`, which returns it). Lesson: when fixing an ABI-arity change, grep ALL call sites — `as never` hides the arity mismatch from tsc.
- **MEDIUM — documented, follow-up.** `senderForTags: scopes[0]` assumes scopes[0] is the tx sender. True for every account-backed path (codex re-confirmed), but NOT for the `NO_FROM` discovery path (`dapp-send-executor` `executeNoFromSendTx` simulates with dapp-only scopes, no account). Public-only today; a private-log-emitting `NO_FROM` flow would tag the wrong address. Documented the invariant + caveat at `pxe/service.ts` (proveTx); explicit-sender plumbing for `NO_FROM` is a tracked follow-up.
- **LOW — follow-up.** The 3 `nulo-schema-patch.ts` drift guards check arity + arg identity + string output for `grantPublicAuthwit` but not the full object-field schema; fine for rc.1, could let a future upstream shape-drift slip to runtime. Strengthen the guard to validate the object shape.

Confirmed fine by codex: `registerContractClass` neutralization is fail-closed (no dApp-reachable bypass); the bridge-core 7-arg withdraw is correct; production key/address derivation uses SDK helpers (no hand-rolled Schnorr/Poseidon2); fee/gas re-derivation shows no concrete estimation bug.

## Post-CI — V5 testnet retarget + EVM portal migration + bridge redeploy (operational)

Migration is CI-green; this is the live-testnet bring-up (faucet + bridge) the user asked for, which surfaced three V5-specific issues the proverless/sandbox e2e never exercised.

1. **V5 has its own testnet endpoint + rollup version.** The 5.0 testnet is `https://v5.testnet.rpc.aztec-labs.com` (the old `rpc.testnet.aztec-labs.com` is V4 and now returns a cert error). Rollup version `4239416255` → wallet chainId `(11155111 ^ 4239416255) >>> 0 = 4229590296`. Retargeted `network/service.ts` (testnet `rpcUrl` + `chainId`), `components/ui/utils.ts` (`CHAIN_IDS.TESTNET`), `faucet/src/lib/chain-info.ts` (`TESTNET_ROLLUP_VERSION`), bumped extension to `0.24.0-rc.0`.

2. **The EVM portal (`NuloTokenPortal.sol`) needed migration — 5.0's L1 `Outbox.consume` is 5-arg.** 5.0 inserts `numCheckpointsInEpoch` into the L1 outbox consume: `consume(message, epoch, numCheckpointsInEpoch, leafIndex, path)`, mirroring the L2 7-arg withdraw. `withdraw` threads the new param through. Regenerated the reviewed-bytes pins (`FORKED_PORTAL_KECCAK` + `PORTAL_PIN` init/runtime hashes via `build-portal-artifact.ts`) and the committed `NuloTokenPortal.build.json`. Solc stays 0.8.30. The TS side was already correct: `useWithdraw.ts`/`useDeposit.ts` import `TokenPortalAbi` from `@aztec/l1-artifacts` (now 5.0 → 7-arg), so the canonical ABI encodes calls to the matching fork. Commit `5fd77a57`.
   - **bridge-evm forge libs are gitignored + not submodules.** `forge install --no-git --shallow foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` (skip the heavy `v4-core` — only the swap router needs it) into `packages/bridge-evm/lib/`, then `forge build src/MintableERC20.sol` for the deploy's USDC artifact. `--no-git` keeps the outer repo index clean.

3. **The real deploy blocker: `salt` + `universalDeploy` are construction-time in 5.0, not send options.** `deployL2` computed the address with `getContractInstanceFromInstantiationParams(art, {deployer: ZERO, salt})` but deployed with `Contract.deploy(ewallet, art, args, ctor).send({contractAddressSalt: salt, universalDeploy: true})`. In 5.0 those two options moved to `Contract.deploy(...)`'s 5th construction-time arg (the deployer is locked at construction); passing them to `.send()` is **silently ignored**, so the deploy landed at the wallet-as-deployer / default-salt address while the script journaled + wired + read-back the deployer=ZERO universal address. The wiring (`set_token`) then failed with `Contract … is not deployed`. **Decisive diagnostic:** `node.getContract()` showed the PXE-registered address DEPLOYED but the script-computed one ABSENT — the contracts deploy fine; the script just looked in the wrong place. Fix: move `{salt, universalDeploy: true}` to `Contract.deploy`'s 5th arg, mirroring the working `faucet/scripts/deploy.ts` (lines 197-226).
   - **Misdiagnosis worth recording.** First attributed the failure to the wait stage — V5 inserts a new `CHECKPOINTED` between `PROPOSED` and `PROVEN`, and the deploy scripts wait only for `PROPOSED` — because I queried the *script-computed* (absent) address, not the *real* one and saw `deployed=false`. Querying BOTH the PXE-registered and script-computed addresses is what cracked it. The deploy keeps the `CHECKPOINTED` wait (commit `d7dda252`) as a conservative guard for the inter-contract wiring call: the faucet uses `PROPOSED` and lands fine, but it has no public call into a just-deployed sibling at deploy time, so it doesn't prove `PROPOSED` suffices for the bridge's `set_token`.
   - A partial-landing journal (`testnet-bridge.journal.jsonl`) can't be resumed: the L2 deployer is an ephemeral `Fr.random()` (it owns the proxy, so a fresh account can't wire it). Archive the journal + redeploy fresh. The deploy writes a CANDIDATE manifest (`testnet-bridge.candidate.json`); candidate→live promotion stays the deliberate, smoke-gated cutover step.

4. **Fuel arc (Uniswap V4 pools) is a SEPARATE deploy — and bit on an unpinned v4-core.** `deploy-bridge-testnet.ts` only deploys the bridge + carries the `fuel` block forward; the pools/router/swap are deployed by the Foundry script `bridge-evm/script/DeployFuelLive.s.sol`. The carried-forward `azloWeth` pool was created for the OLD AZLO, so the new token (`0xad6890e9…`) had no pool — the fuel-juice-via-bridge flow was dead until redeployed.
   - **v4-core pin (reusable).** `bridge-evm/README` said `forge install Uniswap/v4-core` with no version → pulled latest (1.0.2), which moved `SwapParams`/`ModifyLiquidityParams` out of `IPoolManager` into `types/PoolOperation.sol`. The fuel contracts use the pre-1.0 `IPoolManager.SwapParams`, so they don't compile against ≥1.0.0. Correct pin = **`Uniswap/v4-core@v4.0.0`** (commit `e50237c4…`, recovered from the holonym reference's `l1-contracts/lib/v4-core`). Pinned in `bridge-evm/README`. forge-std + OZ track latest (fine).
   - **Deploy + seed (V5 AZLO).** `forge script DeployFuelLive --tc DeployFuelLive --broadcast --slow` with `TOKEN_ADDRESS=0xad6890e9…`. Dry-run first (no `--broadcast`) to validate the V4 pool-init front-run guard + seeding. Seeds real liquidity: ~0.22 ETH→WETH for azloWeth (script wraps ETH itself) + ~0.12 ETH for ETH/FJ (AZLO + FJ free-minted); ~0.36 ETH total incl. gas. New `swapTarget=0x459ea79d…`, `router=0x697bdb88…` — written into both manifests' `l1.fuel`.
