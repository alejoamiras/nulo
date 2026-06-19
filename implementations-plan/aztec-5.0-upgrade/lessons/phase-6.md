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
