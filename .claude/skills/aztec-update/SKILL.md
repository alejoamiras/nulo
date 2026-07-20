---
name: aztec-update
description: Runbook for bumping the @aztec/* version line (rc bumps, protocol forks, testnet resets). Use when the user asks to update/bump Aztec, aztec.js, the @aztec packages, or to move to a new rc/release — or runs /aztec-update. Covers the full pin surface, the Noir toolchain, drift detection, and the coupled testnet-redeploy path when the network reset.
---

# Aztec version update

Operational runbook distilled from the shipped bumps (4.2→5.0 hard fork: `implementations-plan/aztec-5.0-upgrade/`; rc.1→rc.2 + testnet redeploy: `implementations-plan/aztec-5.0-rc2/`; rc.2→5.0.0 stable + reset under intent tooling: `implementations-plan/aztec-5.0.0-stable/` — read those plans + their `lessons/` for complete worked examples). Non-trivial bumps still go through `/blueprint` — this skill is the domain checklist the plan draws from, not a substitute for planning.

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
  - Note the third state: **rollupVersion unchanged but the Phase-1 drift detectors fire anyway** (a toolchain/bytecode change shifted class-ids without a reset). That is a DRIFT-TRIGGERED redeploy of the shifted contracts — it cannot be classified up front; when detectors go red on a "version-only" run, STOP and re-gate through `AskUserQuestion` (redeploy the shifted set vs abort the bump), because `verify:deployments` reds the faucet build either way. *(This second re-gate is load-bearing: Q1 is answered BEFORE the Phase-1 detectors run, so the Phase-0 gate is sufficient only in combination with it — do not remove it.)*
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
- The `Nargo.toml` git tags: aztec-nr + token_portal_content_hash_lib in all three, **plus the `token` dep in token_minter_proxy** (the standards Noir source — from 5.0.0 it lives in `alejoamiras/ecosystem-tooling` tag `v5.0.0`, dir `packages/aztec-standards/src/token_contract`; a version mismatch with aztec-nr produces cryptic `Could not determine the value of the generic argument N on 'call'` errors, ~20 at once).
- Recompile + commit the `target/*.json` (build input, not an on-chain act).
- **The portal-fork pins** (`packages/bridge-core/scripts/portal-artifact.ts`): ANY byte change to `contracts/bridge/evm/upstream/NuloTokenPortal.sol` (even a comment) or a new l1-contracts toolchain shifts `FORKED_PORTAL_KECCAK` / `PORTAL_PIN`. Review the diff, update the source keccak, run `scripts/build-portal-artifact.ts`, fold the new bytecode hashes, commit the regenerated build.json.

**Drift detectors** (run all three; on a bump-only they must be GREEN, on a reset they CONFIRM the shift):
1. `bun run --cwd apps/faucet verify:deployments` — re-derives the live dripper/tokens from pinned params.
2. The PrivateFPC tripwire (`packages/bridge-core/src/private-fuel.test.ts`) — fires on artifact/bytecode drift. Re-pinning `PRIVATE_FPC_ADDRESS` is a CONSCIOUS act that owes a live re-canary; never silence the test.
3. Re-derive the bridge/proxy instances from the manifest metas with the new artifacts (see the rc.2 lessons for the one-shot compare).

## Branch A — bump-only (no reset, detectors green)

Normal delivery: `test:all` + `lint` + 5 builds → PR labeled **`e2e:network` + `e2e:smoke`** (forces both suites — the dep diff warrants it) → all three required checks green → merge. Done.

## Branch B — network reset (the coupled redeploy)

**The whole live arc runs under the deployment-intent tooling** (from the 5.0.0 arc): `bun packages/bridge-core/scripts/live-intent.ts build <intent-path>` AFTER all source changes (chainId cascade, L1 constants) land and BEFORE any signing — it snapshots the commit, pins the signer against the PLAN-pinned address, records artifact digests + caps, and corroborates the node's identity claims against L1 via `cast`. Then `live-intent.ts verify <intent> [--candidate <path>]` **before EVERY broadcast group and at promotion**: it re-probes identity (a rollupVersion that moves MID-ARC is a hard stop — the double-reset probe), re-checks the signer, artifact digests, the candidate sha256 (first verify records it; any later change = never promote), privileged L1 readbacks (router owner/swapTarget, portal UNDERLYING, handler FEE_ASSET), and the working-tree allowlist (only operational files may be dirty; a mid-arc source fix must be committed — fix-forward — before the next group). Spend stays inside the intent's caps; reconcile the signer balance at the end.

Pre-flight: confirm the node runs the new version; deployer keys present (`packages/bridge-core/.env`: `PRIVATE_KEY`, `SEPOLIA_RPC_URL`; `apps/faucet/.env`: `DEPLOYER_SECRET_KEY`, `DEPLOYER_SALT`) — **surface if missing, never create credentials**. L1 (Sepolia) does NOT reset: existing pools/tokens persist; everything rollup-coupled does.

1. **ChainId cascade** — the wallet chainId is `(l1ChainId ^ rollupVersion) >>> 0`. Four sites: `apps/faucet/src/lib/chain-constants.ts` + `chain-info.test.ts`, `apps/extension/src/wallet/services/network/service.ts` (DEFAULT_SEEDS), `apps/extension/src/components/ui/utils.ts` (CHAIN_IDS).
2. **L1 constants** from the node's `l1ContractAddresses` (FeeJuicePortal WILL have moved): `DeployBridge.s.sol`, `DeployFuelLive.s.sol` (+ its AZLO default), `.env.example`, the two fork tests.
3. **L1 fuel**: `DeployFuelLive.s.sol` — **the initial run MUST set `SEED_AZLO_WETH=false SEED_ETH_FJ=false`** (both default TRUE, and `TOKEN_ADDRESS` defaults to the previous AZLO constant — an unflagged run seeds a stale token/pool before the new bridge token exists). Shape (from the worked examples; auth is `PRIVATE_KEY` via `vm.envUint`, no flag): `SEED_AZLO_WETH=false SEED_ETH_FJ=false forge script script/DeployFuelLive.s.sol --tc DeployFuelLive --rpc-url "$SEPOLIA_RPC_URL"` — **dry-run first (no `--broadcast`) and READ the planned actions**, then re-run with `--broadcast --slow`. Reuse flags `ROUTER_ADDRESS`/`FUEL_SWAP_ADDRESS` for partial recovery. The router binds the FeeJuicePortal at construction ⇒ always redeploys on a reset.
4. **L2 bridge — candidate-first**: `deploy-bridge-testnet.ts` with `FUEL_ROUTER`/`FUEL_SWAP` env. It writes `testnet-bridge.candidate.json` ONLY (incl. the node-sourced `l1.feeJuice` block and a node-refreshed `fuel.feeJuicePortal`); never hand-promote before the candidate smokes.
5. **Faucet**: `bun run --cwd apps/faucet deploy:testnet` (idempotent; regenerates `deployments.json`). Runs fine in parallel with 4 (independent accounts).
6. **PrivateFPC — version gate FIRST, then deploy**: run `AZTEC_NODE_URL=<node> bun packages/bridge-core/scripts/check-fpc-version.ts` (read-only, no keys) — hardened in the 5.0.0 arc: exact full-version match, artifact sha256 vs the committed descriptor (`private-fpc-canonical.json`), descriptor coherence, and a live `node_getContract` class check (an RPC error is NOT absence). **Canonical salt policy (5.0.0+): `PRIVATE_FPC_SALT = 0x…01`, exported from `private-fuel.ts` — every rebuild site must use it.** When the salt/artifact changes meaning, sweep for the CONSTRUCTION pattern (`new Fr(0)` near FPC artifacts), not just the constant's import sites — a stray salt-0 rebuild in `fuel-testnet.ts` survived the import-site sweep and was caught live by its own tripwire. The FPC address is bytecode + `@aztec`-version specific: **depositing Fee Juice to an address derived from the wrong version is an UNRECOVERABLE loss**, and a version bump is exactly the operation that opens that window. Red gate ⇒ the pin needs the conscious re-pin + re-canary flow (drift detector 2), not a deploy. Only on green → `packages/bridge-core/scripts/deploy-private-fpc-testnet.ts` (idempotent universal deploy; asserts the pinned address).
7. **Pool seed for the fresh AZLO**: the bridge deploy mints a NEW L1 token by design ⇒ re-run `DeployFuelLive` with `TOKEN_ADDRESS=<new>` + reuse flags + `SEED_AZLO_WETH=true SEED_ETH_FJ=false` (the ETH/FJ pool is token-independent and persists).
8. **Candidate smokes → promote**: `verify-l1.ts --config <candidate>` + `smoke-existing-testnet.ts --config <candidate>` + **`smoke-swap-existing-testnet.ts --config <candidate>` (the FUELED smoke — proves the swap/self-paying-fuel route on the candidate BEFORE it goes live; needs `PRIVATE_KEY` + `SEPOLIA_RPC_URL` in `packages/bridge-core/.env`, template in `.env.example`)**; all green ⇒ copy candidate → `testnet-bridge.json`. Skipping the fueled smoke promotes an unproven fuel route — the step-9 canary would catch it, but on the LIVE manifest.
9. **The live canaries** (all green = the redeploy gate): `verify-l1` · `verify:deployments` on the new pins · the candidate smoke (already done) · `fuel-testnet.ts` with `PRIVATE_RUNS=1` (the private self-paying claim MUST settle — re-confirm the step-6 `check-fpc-version.ts` gate is green first; this canary moves real Fee Juice) · **`fee-juice-canary-testnet.ts --config <candidate>` (the DIRECT `l1.feeJuice` lane — handler mint → `depositToAztecPublic(minFj)` → sponsored `FeeJuice.claim`; the lane `fuel-testnet` never exercises)** · a drip (`drip-canary-testnet.ts` — mirrors the UI's sponsored `drip_to_public` from a fresh account). **`PRIVATE_RUNS=1` is the settle-canary ONLY — its printed `minFuelFj` is a one-sample estimate; a one-sample number may only ever RAISE the floor, NEVER lower it.** To change `l1.fuel.minFuelFj`, run the default full calibration (`PRIVATE_RUNS` unset, ≥3 runs) — or leave the floor alone and note the full calibration as a follow-up.
10. **Client-side reset**: the old `migrate.ts` / `CURRENT_VERSION` bump is gone (replaced by the data-preserving migration framework). The storage baseline is now `BASELINE_VERSION` in `apps/extension/src/wallet/storage/migrations/index.ts` — pre-production, a fresh reinstall stamps it and runs nothing, and a shape change just redefines the baseline (no client migration UX). Chain-coupled rows (tokens, txs, balances, and other per-deployment state) are purged per-chain by `NetworkService.purgeChain` → each service's `clearChainState` (the `registerChainPurgeSubscriber` cascade + `PxeServiceClient.clearChainState`), fired when the stale network is removed — this replaces the old `KEY_PREFIXES_TO_WIPE_LOCAL` wipe-list. User-authored roots (contacts) are NOT chain-coupled and persist.
11. **CSP check**: the faucet page connects to whatever RPC host the wallet reports — confirm `apps/faucet/public/_headers` `connect-src` covers it (both `*.aztec.network` and `*.aztec-labs.com` today).

Then Branch A's delivery gates. Live-deploy discipline: fix forward carefully, never blind-retry a live step; a few failures on one step ⇒ stop and surface. **Recovery invariant for a partial landing:** a partial **L1 fuel** broadcast is recovered by re-running `DeployFuelLive` with the reuse flags (`ROUTER_ADDRESS`/`FUEL_SWAP_ADDRESS`) — never from scratch; a partial **L2 bridge** deploy hard-stops `deploy-bridge-testnet.ts` by design — fix forward and re-run (no flags to pass). Either way the LIVE `testnet-bridge.json` is untouched until step 8's smokes are green — **never promote a candidate built over a partial landing**.

## Gotchas (hard-won)

- `aztec compile`'s "thread 'main' has overflowed its stack" can MASK real type errors — run `aztec-nargo compile` raw (with `ulimit -s 65520`) to see them.
- rc.2+ `DeployMethod.send()` returns `Promise<DeployResultMined>` (no `.deployed()` chain), and codegen'd `Contract.deploy` needs the **EmbeddedWallet itself** as the `Wallet` (the account object lacks `getContractClassMetadata`) with the account as `from`.
- A CONFLICTING PR runs **zero CI silently** (GitHub can't build the merge ref) — check `mergeable` before wondering where the checks went.
- `FeeJuice.claim_and_end_setup` is ONLY valid as the fee payload (setup phase — where `FeeJuicePaymentMethodWithClaim` places it). An app-phase claim under a sponsored fee must use plain `claim`, or it asserts on EVERY attempt — which looks exactly like a slow L1→L2 message sync if the retry loop swallows errors. Print the caught error on the retry cadence, and when a claim "never syncs", independently check the message witness (`node_getL1ToL2MessageMembershipWitness` with the key from the portal's deposit event) before blaming the network.
- Blanket `biome check --write` on test trees converts `vi.fn(function () {…})` mocks to arrows and breaks `new`-constructed service-client mocks (~95 failures) — format only the files you touched.

- **Standards/token package swaps: noir struct paths are NOT stable across dep graphs.** The same
  `AztecAddress` param can arrive as `aztec::protocol_types::…::AztecAddress` from one compile and
  `authorization_contract::aztec::protocol_types::…::AztecAddress` (crate-prefixed by the artifact's
  import chain) from another. Any exact-path ABI matching silently zeroes out — in the wallet this
  made every balance/transfer descriptor resolve no candidates, so token imports returned
  `isComplete: false` and the popup dead-ended with "Couldn't auto-detect this token's interface"
  (the whole network suite red via `importToken` timeouts, mislabeled a "hang"). Match struct paths
  suffix-tolerantly (`matchesStructPath` in
  `apps/extension/src/wallet/services/token/functions/descriptors.ts`) and, after ANY standards bump,
  run `descriptors-real-artifact.test.ts` — it pins all nine token-fn kinds against the REAL installed
  artifact and is the first thing that must go red if upstream reshapes the ABI. Also remember 5.x
  `loadContractArtifact` splits public fns into `artifact.nonDispatchPublicFunctions` — a raw-JSON
  diff is NOT what the wallet's matcher sees; probe through the package's own `Token.js` export.
