---
name: aztec-update
description: Runbook for bumping the @aztec/* version line (rc bumps, protocol forks, testnet resets). Use when the user asks to update/bump Aztec, aztec.js, the @aztec packages, or to move to a new rc/release — or runs /aztec-update. Covers the full pin surface, the Noir toolchain, drift detection, and the coupled testnet-redeploy path when the network reset.
---

# Aztec version update

Operational runbook distilled from the shipped bumps (4.2→5.0 hard fork: `implementations-plan/aztec-5.0-upgrade/`; rc.1→rc.2 + testnet redeploy: `implementations-plan/aztec-5.0-rc2/` — read that plan + its `lessons/` for a complete worked example). Non-trivial bumps still go through `/blueprint` — this skill is the domain checklist the plan draws from, not a substitute for planning.

> **This skill is the source of truth for the Aztec-bump process. Update it when the process changes** — a new pin surface, a new failure mode, a toolchain/proving shift. A durable lesson from a bump belongs HERE (not only in the plan's `lessons/`). CLAUDE.md's skill-routing table points here for that reason.

## Phase 0 — classify the bump (do this FIRST, it forks everything)

Two independent questions:

1. **Did the target network reset?** Probe the live node and compare against our pin:
   ```bash
   curl -s -X POST https://v5.testnet.rpc.aztec-labs.com -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"node_getNodeInfo","params":[]}' | jq '.result.rollupVersion'
   rg -n 'TESTNET_ROLLUP_VERSION' apps/faucet/src/lib/chain-constants.ts
   ```
   Different rollupVersion ⇒ **NETWORK RESET** ⇒ Branch B below is mandatory and COUPLED to the bump: `verify:deployments` runs inside the faucet build CI gate, so a class-id/identity shift reds the build — you cannot land the bump and defer the redeploy.
2. **What changed upstream?** `gh api repos/AztecProtocol/aztec-packages/compare/v<old>...v<new>` — scan `!:` commits, then grep OUR surface for the broken symbols before assuming they bite. Expect class-id shifts from ANY toolchain/bytecode change even when no API we call moved.

**Then gate on the user via the `AskUserQuestion` tool** — present what the probes FOUND (rollupVersions, `!:` commit count, our-surface hits), never ask blind. **No implementation starts while ANY clarifying question is open**: Q1/Q2 below are the mandatory minimum, and anything else the probes left ambiguous — the exact target version, validation depth (network-e2e? full calibration?), deployer-key availability, whether the extension/faucet release timing matters — gets batched into the same `AskUserQuestion` call(s) up front. Silent assumptions on a runbook with live broadcasts are how funds strand. The two fixed questions:

- **Q1 "Bump class"** (single-select) — options grounded in the probe result, e.g.:
  - `Version-only bump` — rollupVersion unchanged; pins + toolchain + detectors, no on-chain work (Branch A).
  - `Network reset — coupled redeploy` — rollupVersion moved; the bump CANNOT land without the live redeploy (Branch B). Recommend whichever the probe supports and mark it "(Recommended)".
  - Note the third state: **rollupVersion unchanged but the Phase-1 drift detectors fire anyway** (a toolchain/bytecode change shifted class-ids without a reset). That is a DRIFT-TRIGGERED redeploy of the shifted contracts — it cannot be classified up front; when detectors go red on a "version-only" run, STOP and re-gate through `AskUserQuestion` (redeploy the shifted set vs abort the bump), because `verify:deployments` reds the faucet build either way.
- **Q2 "Live authorization"** (only meaningful on a reset; single-select) — explicit authorization for the scripted TESTNET deploys (L1 forge broadcasts + L2 deploys + promotion), noting the deployer env files it will use and that credentials are never created. Options: `Authorize the full scripted redeploy` / `Prepare everything, hold before broadcasts`.

Do not start Phase 1 before the answers; on a reset, do not run any `--broadcast`/deploy step without Q2's explicit authorization. Mid-run surprises that change the shape of what was authorized (an unexpected pool re-seed, a forced storage migration, a redeploy of something the user didn't sanction) go back through `AskUserQuestion` — authorization for one scope doesn't extend to the next.

## Phase 1 — the bump (always)

**The pin surface** — miss one and you get a mixed old/new set:
- `@aztec/*` exact pins across the workspace package.json files (`rg '"@aztec/' apps/*/package.json packages/*/package.json`). `@aztec/viem` is versioned independently — leave it.
- **`@alejoamiras/aztec-accelerator`** (extension + aztec-runtime) — it exact-depends on `@aztec` transitives; skipping it silently reintroduces the old line.
- **`@alejoamiras/aztec-standards` + `@alejoamiras/aztec-fee-payment`** (our npm takeover of the Wonderland packages; ~8 pins across 5 packages).
- The two noir patches: rename `patches/@aztec%2Fnoir-{acvm_js,noirc_abi}@<v>.patch` + the `patchedDependencies` keys in the root package.json.
- `bunfig.toml` `minimumReleaseAgeExcludes`: fresh publishes are min-age-blocked, and the gate bites TRANSITIVES too — enumerate every `@aztec/*` name from `bun.lock` (~30), plus the three `@alejoamiras/*`. Date the comment; a follow-up PR removes the excludes after they age past 7 days.

**The lockfile ritual** (Bun #25305 — per-package update won't re-resolve transitives):
```bash
rm bun.lock && bun install
```
- ⚠️ `bunfig.toml` pins `linker = "hoisted"` — do NOT remove it. A fresh lockfile otherwise defaults to the isolated linker and breaks the foundry `@aztec/` remap, `resolvePackageFile` walkers, and the deploy-script `node_modules/...` paths.
- Allowlist-diff the lock: only the intended scopes move (in-range `^` refreshes of everything else are the accepted cost — investigate anything suspicious, trace odd new transitives to their parent).
- Assert zero old-version entries remain: `rg -c '<old-version>' bun.lock` → 0.

**API churn**: `bun run typecheck:all` is the fast-fail — **but typecheck is NOT sufficient on a fork-class bump.** Surfaces typecheck can't see (5.0-fork precedent): copied/adapted upstream logic (fee options, gas math) that must be re-diffed against the new upstream; the three `nulo-schema-patch.ts` copies (extension/faucet/playground — they throw at RUNTIME if the wallet-sdk schema shape moved; `test:all` exercises them, typecheck doesn't); and native-proving required-mode (`VITE_NULO_ACCELERATOR_REQUIRED`) surviving the proving-stack change. Port mechanically and behavior-preserving; wrap renamed upstream APIs inside our service layer so OUR RPC surfaces don't ripple (precedent: PXE senders → tagging-secret sources, wrapped in `PxeService`). Non-mechanical churn (a removed API we depend on) → stop, `/codex` triage, re-plan.

**The Noir surface** (skipping this makes the drift check a false negative):
- `contracts/bridge/aztec/scripts/compile.sh` pins the toolchain (`~/.aztec/versions/<v>` — `aztec-up install <v>` first) and lists the contracts to compile (all three: token_minter_proxy, token_bridge, keystone).
- The `Nargo.toml` git tags: aztec-nr + token_portal_content_hash_lib in all three, **plus the `token` dep in token_minter_proxy** (the standards Noir source — a version mismatch with aztec-nr produces cryptic `Could not determine the value of the generic argument N on 'call'` errors, ~20 at once).
- Recompile + commit the `target/*.json` (build input, not an on-chain act).
- **The portal-fork pins** (`packages/bridge-core/scripts/portal-artifact.ts`): ANY byte change to `contracts/bridge/evm/upstream/NuloTokenPortal.sol` (even a comment) or a new l1-contracts toolchain shifts `FORKED_PORTAL_KECCAK` / `PORTAL_PIN`. Review the diff, update the source keccak, run `scripts/build-portal-artifact.ts`, fold the new bytecode hashes, commit the regenerated build.json.

**Drift detectors** (run all three; on a bump-only they must be GREEN, on a reset they CONFIRM the shift):
1. `bun run --cwd apps/faucet verify:deployments` — re-derives the live dripper/tokens from pinned params.
2. The PrivateFPC tripwire (`packages/bridge-core/src/private-fuel.test.ts`) — fires on artifact/bytecode drift. Re-pinning `PRIVATE_FPC_ADDRESS` is a CONSCIOUS act that owes a live re-canary; never silence the test.
3. Re-derive the bridge/proxy instances from the manifest metas with the new artifacts (see the rc.2 lessons for the one-shot compare).

## Branch A — bump-only (no reset, detectors green)

Normal delivery: `test:all` + `lint` + 5 builds → PR labeled **`e2e:network` + `e2e:smoke`** (forces both suites — the dep diff warrants it) → all three required checks green → merge. Done.

## Branch B — network reset (the coupled redeploy)

Pre-flight: confirm the node runs the new version; deployer keys present (`packages/bridge-core/.env`: `PRIVATE_KEY`, `SEPOLIA_RPC_URL`; `apps/faucet/.env`: `DEPLOYER_SECRET_KEY`, `DEPLOYER_SALT`) — **surface if missing, never create credentials**. L1 (Sepolia) does NOT reset: existing pools/tokens persist; everything rollup-coupled does.

1. **ChainId cascade** — the wallet chainId is `(l1ChainId ^ rollupVersion) >>> 0`. Four sites: `apps/faucet/src/lib/chain-constants.ts` + `chain-info.test.ts`, `apps/extension/src/wallet/services/network/service.ts` (DEFAULT_SEEDS), `apps/extension/src/components/ui/utils.ts` (CHAIN_IDS).
2. **L1 constants** from the node's `l1ContractAddresses` (FeeJuicePortal WILL have moved): `DeployBridge.s.sol`, `DeployFuelLive.s.sol` (+ its AZLO default), `.env.example`, the two fork tests.
3. **L1 fuel**: `DeployFuelLive.s.sol` — **the initial run MUST set `SEED_AZLO_WETH=false SEED_ETH_FJ=false`** (both default TRUE, and `TOKEN_ADDRESS` defaults to the previous AZLO constant — an unflagged run seeds a stale token/pool before the new bridge token exists). Dry-run first, then `--broadcast`; reuse flags `ROUTER_ADDRESS`/`FUEL_SWAP_ADDRESS` for partial recovery. The router binds the FeeJuicePortal at construction ⇒ always redeploys on a reset.
4. **L2 bridge — candidate-first**: `deploy-bridge-testnet.ts` with `FUEL_ROUTER`/`FUEL_SWAP` env. It writes `testnet-bridge.candidate.json` ONLY (incl. the node-sourced `l1.feeJuice` block and a node-refreshed `fuel.feeJuicePortal`); never hand-promote before the candidate smokes.
5. **Faucet**: `bun run --cwd apps/faucet deploy:testnet` (idempotent; regenerates `deployments.json`). Runs fine in parallel with 4 (independent accounts).
6. **PrivateFPC**: `packages/bridge-core/scripts/deploy-private-fpc-testnet.ts` (idempotent universal deploy; asserts the pinned address).
7. **Pool seed for the fresh AZLO**: the bridge deploy mints a NEW L1 token by design ⇒ re-run `DeployFuelLive` with `TOKEN_ADDRESS=<new>` + reuse flags + `SEED_AZLO_WETH=true SEED_ETH_FJ=false` (the ETH/FJ pool is token-independent and persists).
8. **Candidate smokes → promote**: `verify-l1.ts --config <candidate>` + `smoke-existing-testnet.ts --config <candidate>`; green ⇒ copy candidate → `testnet-bridge.json`.
9. **The five live canaries** (all green = the redeploy gate): `verify-l1` · `verify:deployments` on the new pins · the candidate smoke (already done) · `fuel-testnet.ts` with `PRIVATE_RUNS=1` (the private self-paying claim MUST settle) · a drip. **`PRIVATE_RUNS=1` is the settle-canary ONLY — its printed `minFuelFj` is a one-sample estimate; the script itself requires ≥3 runs for calibration stability.** To change `l1.fuel.minFuelFj`, run the default full calibration (`PRIVATE_RUNS` unset, ≥3) — or leave the floor alone; only apply a one-sample number if it RAISES the floor (conservative direction), and note the full calibration as a follow-up.
10. **Client-side reset**: bump `CURRENT_VERSION` in `apps/extension/src/wallet/storage/migrate.ts` (document-the-reset, no migration UX). ⚠️ EntityStorage persists rows as `<root>@<id>` — chain-coupled roots need `@`-prefix entries in `KEY_PREFIXES_TO_WIPE_LOCAL`, not just bare keys (`contacts@` stays: user-authored).
11. **CSP check**: the faucet page connects to whatever RPC host the wallet reports — confirm `apps/faucet/public/_headers` `connect-src` covers it (both `*.aztec.network` and `*.aztec-labs.com` today).

Then Branch A's delivery gates. Live-deploy discipline: fix forward carefully, never blind-retry a live step; a few failures on one step ⇒ stop and surface.

## Gotchas (hard-won)

- `aztec compile`'s "thread 'main' has overflowed its stack" can MASK real type errors — run `aztec-nargo compile` raw (with `ulimit -s 65520`) to see them.
- rc.2+ `DeployMethod.send()` returns `Promise<DeployResultMined>` (no `.deployed()` chain), and codegen'd `Contract.deploy` needs the **EmbeddedWallet itself** as the `Wallet` (the account object lacks `getContractClassMetadata`) with the account as `from`.
- A CONFLICTING PR runs **zero CI silently** (GitHub can't build the merge ref) — check `mergeable` before wondering where the checks went.
- Blanket `biome check --write` on test trees converts `vi.fn(function () {…})` mocks to arrows and breaks `new`-constructed service-client mocks (~95 failures) — format only the files you touched.
