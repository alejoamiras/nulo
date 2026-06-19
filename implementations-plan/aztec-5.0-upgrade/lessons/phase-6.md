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
