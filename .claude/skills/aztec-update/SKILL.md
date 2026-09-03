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
   rg -n 'TESTNET_ROLLUP_VERSION' apps/tools/src/lib/chain-constants.ts
   ```
   Different rollupVersion ⇒ **NETWORK RESET** ⇒ Branch B below is mandatory and COUPLED to the bump: `verify:deployments` runs inside the tools app build CI gate, so a class-id/identity shift reds the build — you cannot land the bump and defer the redeploy.
2. **What changed upstream?** `gh api repos/AztecProtocol/aztec-packages/compare/v<old>...v<new>` — scan `!:` commits, then grep OUR surface for the broken symbols before assuming they bite. Expect class-id shifts from ANY toolchain/bytecode change even when no API we call moved.

**Then gate on the user via the `AskUserQuestion` tool** — present what the probes FOUND (rollupVersions, `!:` commit count, our-surface hits), never ask blind. **No implementation starts while ANY clarifying question is open**: Q1/Q2 below are the mandatory minimum, and anything else the probes left ambiguous — the exact target version, validation depth (network-e2e? full calibration?), deployer-key availability, whether the extension/tools release timing matters — gets batched into the same `AskUserQuestion` call(s) up front. Silent assumptions on a runbook with live broadcasts are how funds strand. The two fixed questions:

- **Q1 "Bump class"** (single-select) — options grounded in the probe result, e.g.:
  - `Version-only bump` — rollupVersion unchanged; pins + toolchain + detectors, no on-chain work (Branch A).
  - `Network reset — coupled redeploy` — rollupVersion moved; the bump CANNOT land without the live redeploy (Branch B). Recommend whichever the probe supports and mark it "(Recommended)".
  - Note the third state: **rollupVersion unchanged but the Phase-1 drift detectors fire anyway** (a toolchain/bytecode change shifted class-ids without a reset). That is a DRIFT-TRIGGERED redeploy of the shifted contracts — it cannot be classified up front; when detectors go red on a "version-only" run, STOP and re-gate through `AskUserQuestion` (redeploy the shifted set vs abort the bump), because `verify:deployments` reds the tools app build either way. *(This second re-gate is load-bearing: Q1 is answered BEFORE the Phase-1 detectors run, so the Phase-0 gate is sufficient only in combination with it — do not remove it.)*
- **Q2 "Live authorization"** (only meaningful on a reset; single-select) — explicit authorization for the scripted TESTNET deploys (L1 forge broadcasts + L2 deploys + promotion), noting the deployer env files it will use and that credentials are never created. Options: `Authorize the full scripted redeploy` / `Prepare everything, hold before broadcasts`.

Do not start Phase 1 before the answers; on a reset, do not run any `--broadcast`/deploy step without Q2's explicit authorization. Mid-run surprises that change the shape of what was authorized (an unexpected pool re-seed, a forced storage migration, a redeploy of something the user didn't sanction) go back through `AskUserQuestion` — authorization for one scope doesn't extend to the next.

## Phase 1 — the bump (always)

**The pin surface** — miss one and you get a mixed old/new set:
- `@aztec/*` exact pins across the workspace package.json files (`rg '"@aztec/' apps/*/package.json packages/*/package.json`). `@aztec/viem` is versioned independently — leave it.
- **`@alejoamiras/aztec-accelerator`** (extension + aztec-runtime) — it exact-depends on `@aztec` transitives; skipping it silently reintroduces the old line.
- **`@alejoamiras/aztec-standards` + `@alejoamiras/aztec-fee-payment`** (our npm takeover of the Wonderland packages; ~8 pins across 5 packages).
- The two noir patches: rename `patches/@aztec%2Fnoir-{acvm_js,noirc_abi}@<v>.patch` + the `patchedDependencies` keys in the root package.json.
- `bunfig.toml` `minimumReleaseAgeExcludes`: fresh publishes are min-age-blocked, and the gate bites TRANSITIVES too — enumerate every `@aztec/*` name from `bun.lock` (~30), plus the three `@alejoamiras/*`. Date the comment; a follow-up PR removes the excludes after they age past 7 days.

**The lockfile ritual** — `bun install` after editing the pins. Bun #25305 is CLOSED on Bun 1.4:
targeted re-resolution now holds transitives to the min-age gate, so `rm bun.lock` is NO LONGER
the default (a full regen re-gates every already-locked version and invites unrelated churn).
Keep it as the last resort for unresolvable conflicts only.
- ⚠️ `bunfig.toml` pins `linker = "isolated"` (since the 2026-08 isolated-linker arc) — do NOT
  change it. The old hoisting assumptions were made layout-agnostic via `@nulo/resolve-asset` +
  generated remappings; `apps/extension/scripts/layout-identity.test.ts` is the executable
  guarantee (and carries `expectVersion` literals that MUST move with the line).
- Diff the lock with `bun scripts/lockfile-exception-diff.ts <base-lock> bun.lock` and
  disposition every `exceptions/added/removed` entry (no blanket acceptance).
- **Residue is an ALLOWLIST check, not a zero check.** When any package is deliberately held,
  old-line entries legitimately remain. `bun scripts/aztec-hold-residue-check.ts` encodes it:
  graph-reachability from the held roots (bun.lock v2 shortens a single-dependent nested key to
  the bare position, so key-prefix matching gives false failures) plus `realpath` resolution
  from every consumer workspace. Anything else on the old line is a missed pin.
- Fresh publishes are min-age-blocked. Prefer waiting; when a first-party release must land
  immediately, add ONE dated `minimumReleaseAgeExcludes` entry with the removal date and the
  provenance you verified (registry signature + npm/SLSA attestation binding the tarball to a
  repo+commit), and file the removal PR.
- Provenance actually runs like this: build a scratch npm project from the exception-diff's
  resolved `name@version` set, `npm install --ignore-scripts`, THEN `npm audit signatures`.
  `--package-lock-only` makes audit a no-op ("found no dependencies to audit") — which is why
  earlier bumps never transcribed a passing run.

**API churn**: `bun run typecheck:all` is the fast-fail — **but typecheck is NOT sufficient on a fork-class bump.** Surfaces typecheck can't see (5.0-fork precedent): copied/adapted upstream logic (fee options, gas math) that must be re-diffed against the new upstream; the three `nulo-schema-patch.ts` copies (extension/tools/playground — they throw at RUNTIME if the wallet-sdk schema shape moved; `test:all` exercises them, typecheck doesn't); and native-proving required-mode (`VITE_NULO_ACCELERATOR_REQUIRED`) surviving the proving-stack change. Port mechanically and behavior-preserving; wrap renamed upstream APIs inside our service layer so OUR RPC surfaces don't ripple (precedent: PXE senders → tagging-secret sources, wrapped in `PxeService`). Non-mechanical churn (a removed API we depend on) → stop, `/codex` triage, re-plan.

**The Noir surface** (skipping this makes the drift check a false negative):
- `contracts/bridge/aztec/scripts/compile.sh` pins the toolchain (`AZTEC_HOME`, default `~/.aztec/versions/5.0.1` — `aztec-up install <v>` first) and lists the crates to compile (`token_bridge_hub`, `keystone`; `claim_secret` + `register_hash` are libraries the hub pulls in).
- The `Nargo.toml` git tags: `aztec`, `compressed_string` + `token_portal_content_hash_lib` (aztec-packages) and **the `token` dep in `token_bridge_hub`** (`AztecProtocol/aztec-standards` tag, dir `src/token_contract`) must sit on ONE tag — a mismatch with aztec-nr produces cryptic `Could not determine the value of the generic argument N on 'call'` errors, ~20 at once.
- **The hub's `token` tag and the JS `@aztec-foundation/aztec-standards` pin are ONE class.** The hub's `token_class_id` is a constructor immutable the conductor computes from the installed JS `Token` artifact (`scripts/generation.ts`), every L2 token derives from it (`src/hub-token.ts`, pinned by `noir-artifact-classids.test.ts`), and the hub's Noir `token` dep fixes the selectors it calls on that class. A standards bump that moves the Token class id cannot be absorbed by a deployed hub — that is a new generation (Branch B); moving the JS pin alone makes every derived L2 token address disagree with the live hub.
- Recompile + commit the `target/*.json` (build input, not an on-chain act), then `compile.sh --check` — the hub's committed class id must survive the rebuild. A hub class-id shift is likewise a NEW GENERATION, never a re-pin: the deployed hub is immutable and its factory binds it.
- The TXE server's deps are the committed mini-project `contracts/bridge/aztec/txe-server` (frozen lockfile) — `run-txe-tests.sh` never `bun add`s; bump that lockfile with the line.

**The frozen account surface (never bumped with the line)**: the account artifact is VENDORED
(`packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json`) and, with the instantiation
descriptor + regime record (`frozen-artifact.ts`, `instantiation-descriptor.ts`,
`address-freeze.ts`), fixes every derived account address. A bump must leave the KAT
(`derivation-vectors.test.ts`) and all freeze tests green with ZERO vector regeneration and zero
pin edits — if a bump reds any of them, upstream moved a protocol-level input; STOP, that is
new-extension-major territory, not a re-pin (mirror the PrivateFPC conscious-re-pin spirit; see
CLAUDE.md "Account-address freeze").

**Drift detectors** (run all four; on a bump-only they must be GREEN, on a reset they CONFIRM the shift):
1. `bun run --cwd apps/tools verify:deployments` — re-derives the live dripper/tokens from pinned params; with `BRIDGE_MANIFEST=apps/tools/public/testnet-bridge.json` it ALSO re-derives the live bridge manifest with the new artifacts (the hub instance from its recorded `salt` + `[tokenClassId, factory, guardian]`, every token's L2 token from the hub + its attested words). Run it both ways.
2. The PrivateFPC tripwire (`packages/bridge-core/src/private-fuel.test.ts`) — fires on artifact/bytecode drift. Re-pinning `PRIVATE_FPC_ADDRESS` is a CONSCIOUS act that owes a live re-canary; never silence the test.
3. `packages/bridge-core/src/noir-artifact-classids.test.ts` + `hub-token.test.ts` — the committed hub class id and the standards Token class id the hub derives from. Either moving ⇒ the live hub cannot be re-pinned (immutable `token_class_id`; the factory binds the hub) ⇒ a NEW GENERATION.
4. **The sandbox smoke on the JS line** — `bun run --cwd packages/bridge-core deploy:sandbox --smoke` boots `aztec start --local-network` from `~/.aztec/versions/<@aztec/aztec.js pin>` (the version `package.json` declares — the same JS line the live networks run, NOT the 5.0.1 Noir toolchain) and drives real `register_*` publications. That is the only pre-live check that the 5.0.1-compiled hub's `publish_contract_instance_for_public_execution` still resolves on the protocol's `ContractInstanceRegistry` at the new line (the TXE cannot run that path). A red first-time flow here = the split line broke; hold the bump.

**The frozen-account execution canary (MANDATORY, every `@aztec/*` bump PR)**: run
`bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts` **prover-ON** before merge.
LOCALLY, `e2e:agent` has NO accelerator enforcement — it silently falls back to in-browser WASM if
no prover is up, which would pass the canary WITHOUT proving anything about native proving. To
actually run it prover-ON locally: start `accelerator-server` on `127.0.0.1:59833` (the SHA-pinned
binary from `_network-e2e.yml`), build the wallet with `VITE_NULO_ACCELERATOR_REQUIRED=1`, and
confirm at least one `Received /prove request` in the accelerator log during the run. In CI this is
automatic: the canary is a named file in the prover-ON `network-e2e-canary` job (`pr-network-e2e.yml`),
so the required `network-e2e-status` check enforces it — that is the authoritative gate; the local
run is a pre-flight. It proves the frozen 5.0.1 account bytecode still simulates, proves natively,
and is accepted by the bumped node/toolchain across the full arc (frozen-ctor multicall deploy →
init-nullifier flip → authwit consume → SW-restart re-derive + tx). The address KAT cannot see
execution breakage — this canary is the only gate that does. **A red canary BLOCKS the bump**:
default response is HOLD the `@aztec` line; shipping a new extension major (address-regime rotation)
is the deliberate alternative — never a casual fix.

## Branch A — bump-only (no reset, detectors green)

Normal delivery: `test:all` + `lint` + 5 builds + **the prover-ON frozen-account canary (above)** → PR labeled **`e2e:network` + `e2e:smoke`** (forces both suites — the dep diff warrants it) → all three required checks green → merge. Done.

## Branch B — network reset (the coupled redeploy)

A reset means a **new bridge generation**: one L1 `PortalFactory` + `SwapBridgeRouter` + `UniswapFuelSwap`, one L2 `TokenBridgeHub`, and every manifest token pre-created against them. Nothing from the old generation carries over except Sepolia itself (the mintable test tokens, the ETH/FJ pool) — the hub's address is salted with the factory's, the factory's constructor takes the hub, and the router binds the factory and the (moved) `FeeJuicePortal` as immutables, so all four contracts redeploy together, always.

**The whole live arc runs under the deployment-intent tooling**: `bun packages/bridge-core/scripts/live-intent.ts build <intent-path>` AFTER all source changes (chainId cascade, L1 constants) land and BEFORE any signing — it snapshots the commit, pins the signer against the PLAN-pinned address (`PLAN_PINNED_L1_SIGNERS`), records artifact digests + caps, and corroborates the node's identity claims against L1 via `cast`. Then `live-intent.ts verify <intent> [--candidate <path>]` **before EVERY broadcast group and at promotion**: it re-probes identity (a rollupVersion that moves MID-ARC is a hard stop — the double-reset probe), re-checks the signer, artifact digests, the candidate sha256 (first verify records it; any later change = never promote), and the working-tree allowlist (`OPERATIONAL_ALLOWLIST` in `live-intent.ts`: the candidate + live manifests, the conductor's `deploy-journal/`, and the named `lessons/` dirs — a new arc ADDS its lessons dir there first; anything else dirty, including a mid-arc source fix, must be committed — fix-forward — before the next group). With `--candidate` it also strict-validates the candidate through the FULL `verify-l1` verifier (code at every address, factory ↔ router ↔ hub cross-bindings, each token's portal derivation + frozen registration + live metadata re-derivation, immutables-masked runtime code hashes against the forge build) and reads the hub's initialization hash off the node to prove it was initialized with the candidate's `[token_class_id, l1_factory, guardian]`. The caps are RECORDED in the intent and reconciled against the signer balance at `verify` (`maxTotalEthSpend` = balance delta — incoming ETH can mask a spend, so keep your own tally per broadcast group); they are not enforced per transaction. **Commit the intent right after `build` and again after the digest-recording verify** — the tool refuses a dirty intent only once it carries `candidateSha256` (`assertIntentCommitted`), so before that point an uncommitted edit to the caps/signer is caught by nothing but the commit discipline. **`build` refuses a reset by design**: `assertNoResetPins` byte-pins the node's identity and five L1 addresses against the COMMITTED baseline named by `NO_RESET_BASELINE` (the previous arc's `lessons/intent.json`) — and `build` is the only writer of such a file, so a reset arc BOOTSTRAPS the baseline by hand, exactly as the first intent was: probe `node_getNodeInfo`, corroborate `rollupAddress`/`feeJuicePortalAddress` against L1 with `cast code`, write `{ identity: { l1ChainId, rollupVersion }, l1: { rollup, feeJuicePortal, feeJuice, feeAssetHandler, registry } }` into the new arc's `lessons/`, re-point the constant, commit — then `build` runs against it. Never loosen the check.

Pre-flight: confirm the node runs the new version; deployer keys present (`packages/bridge-core/.env`: `PRIVATE_KEY` = the pinned testnet signer, `SEPOLIA_RPC_URL`, and `BRIDGE_DEPLOYER_SECRET_TESTNET` — the STABLE secret the L2 deployer account derives from, ≥ 16 chars, pre-fundable, the same value on every re-run; `apps/tools/.env`: `DEPLOYER_SECRET_KEY`, `DEPLOYER_SALT`) — **surface if missing, never create credentials**; the recorded testnet guardian (the conductor records the L1 signer as `guardianL1` and the L2 deployer as `guardianL2`); ~15 min of real proofs per conductor run; `~/.aztec/versions/<new JS pin>` installed complete (the sandbox rehearsal refuses a partial toolchain). L1 (Sepolia) does NOT reset: the test tokens and the token-independent ETH/FJ pool persist; everything rollup-coupled does.

1. **ChainId cascade** — the wallet chainId is `walletChainIdOf(l1ChainId, rollupVersion) = (l1 ^ rollupVersion) >>> 0` (`packages/bridge-core/src/wallet-chain-id.ts`). The literals: `apps/tools/src/lib/chain-constants.ts` (+ `chain-info.test.ts`), `apps/extension/src/utils/chain-ids.ts` (`TESTNET_ROLLUP_VERSION` — `CHAIN_IDS`/`DEFAULT_SEEDS` derive from it), `packages/bridge-core/src/wallet-chain-id.test.ts`, `private-fuel.test.ts` and the `private-fpc-canonical.json` identity pins. `rg` the old rollupVersion repo-wide and classify every hit. The manifest's `walletChainId` is written by the conductor from the node; the tools app's build-integrity check refuses a manifest whose chain disagrees with the build target, so the constants and the manifest must move together.
2. **L1 constants** — the conductor reads `registry`/`feeJuice`/`feeJuicePortal`/`feeAssetHandler` from `node_getNodeInfo` at run time (nothing to edit for the generation itself); the fork fixtures (`DeployFuelLive.s.sol`, `DeployFuelLive.fork.t.sol`, `MainnetFuel.fork.t.sol`) still carry literals — update them so the fork suites keep testing the live topology.
3. **Rehearse on the sandbox FIRST** — `bun run --cwd packages/bridge-core deploy:sandbox --smoke` on the new JS line (drift detector 4): fourteen flows (+ one optional private-FPC flow) through the production modules, real `register_*` publications, the calibration line at the end. Green here is the precondition for spending on Sepolia.
4. **Deploy the generation — candidate-first, journalled:**
   ```bash
   # from the repo root, like every other command in this runbook
   SEED_TOKENS=<fakeUSDC>,<fakeUSDT> bun run --cwd packages/bridge-core deploy:generation deploy --dry-run   # signer + identity + token list; no broadcast, no L2 account deploy
   SEED_TOKENS=<fakeUSDC>,<fakeUSDT> bun run --cwd packages/bridge-core deploy:generation deploy
   ```
   Order inside one run: `UniswapFuelSwap` (the one piece with no cross-binding) → publish the hub + Token classes → **predict the factory from the signer's pending nonce** → derive the hub (`salt = Fr(factory)`) → deploy the factory (**refuses to broadcast if the nonce moved** — a factory landing anywhere else would be bound to a hub nothing can reach; the race aborts BEFORE the hub exists) → router → hub → readbacks (`factory.L2_HUB` ↔ hub, router `FACTORY`/`FEE_ASSET`/`permit2`/`feeJuicePortal`/`swapTarget`, `hub.token_for(0) == 0`) → per token: `createPortal` (skipped when the clone exists), `register_token` on the hub only if `token_for == 0`, then `SeedTokenPool.s.sol` for its TOKEN/WETH leg (`SKIP_POOL_SEED=1` defers it) → `apps/tools/public/testnet-bridge.candidate.json`, written atomically, with the prior LIVE manifest's `fjPerTx`/`fjRegister` carried as placeholders. **Every step is journalled** (`packages/bridge-core/deploy-journal/testnet-generation.jsonl`, stamped with chain + rollup + deployer + registry + portal — a journal from another identity is refused): a crashed run re-runs the SAME command and resumes with the recorded identities, adopting an already-landed factory/hub instead of deriving fresh ones. Never delete the journal to "start clean" while anything of that generation is on chain.
   - **Serialize with anything else that signs from the deployer.** The nonce pin is the whole safety of this step; a forge broadcast from the same key between the prediction and the deploy is exactly what the abort exists to catch.
   - Adding a token to a landed generation later: `bun run --cwd packages/bridge-core deploy:generation pre-create --config <candidate> --token <erc20> [--no-register] [--seed-pool]`.
   - `SEED_TOKENS` are the COMMITTED test-token addresses recorded in the arc's lessons (`MintableERC20` deployments on Sepolia), never chosen ad hoc: `--dry-run` validates only their shape. Before the live run confirm each has code, answers `decimals()`/`maxMintPerTx()`, and **sorts below WETH** (`SeedTokenPool` requires `token < WETH` as `currency0` — a token that sorts above needs a redeploy at a different nonce). Only these get pools seeded (`SeedTokenPool` mints its own liquidity). A real ERC-20 needs no `pre-create`: the router creates its portal inline on the first send, and the hub registers it on the first claim.
5. **Faucet**: `bun run --cwd apps/tools deploy:testnet` (idempotent; writes `src/contracts/deployments.candidate.json` — `promote` moves it into the live `deployments.json`). Independent accounts — runs in parallel with 4.
6. **PrivateFPC — version gate FIRST, then deploy**: `AZTEC_NODE_URL=<node> bun packages/bridge-core/scripts/check-fpc-version.ts --mode predeploy` (read-only, no keys; `--mode` is REQUIRED — `require-deployed` is the form to re-run before any funding, canary or promotion): the node's version must be in the descriptor's compat list for the artifact's sha256 (`private-fpc-canonical.json`), the descriptor must cohere, its `l1ChainId`/`rollupVersion` pins must match the live node (a reset reds this for identity reasons, not artifact drift — the descriptor is re-pinned WITH the redeploy), and a live `node_getContract` class check (an RPC error is NOT absence). **Canonical salt policy (5.0.0+): `PRIVATE_FPC_SALT = 0x…01`, exported from `private-fuel.ts` — every rebuild site must use it**; sweep for the CONSTRUCTION pattern (`new Fr(0)` near FPC artifacts), not just the constant's import sites. The FPC address is bytecode + `@aztec`-version specific: **depositing Fee Juice to an address derived from the wrong version is an UNRECOVERABLE loss**, and a version bump is exactly the operation that opens that window. Red gate ⇒ the conscious re-pin + re-canary flow (drift detector 2), not a deploy. Only on green → `packages/bridge-core/scripts/deploy-private-fpc-testnet.ts` (idempotent universal deploy; asserts the pinned address).
7. **ETH/FJ pool** — token-independent; it persists across resets **unless the L1 Fee Juice asset itself moved** (compare `node_getNodeInfo.l1ContractAddresses.feeJuiceAddress` with the old manifest's `feeJuice.asset`). If it moved: re-seed with `DeployFuelLive.s.sol` in seed-only mode (`ROUTER_ADDRESS`/`FUEL_SWAP_ADDRESS` = the conductor's addresses, `SEED_AZLO_WETH=false SEED_ETH_FJ=true`, its `FEE_JUICE` literal updated in step 2) — **dry-run first (no `--broadcast`) and READ the planned actions**, then `--broadcast --slow`. Its price guard aborts on a pre-initialized mispriced pool rather than seeding into it.
8. **Candidate smokes → calibrate → promote.** The candidate's digest is recorded at the FIRST `verify --candidate` and any later change means "never promote" — so the candidate must be FINAL (calibrated) before that verify. Order:
   - `live-intent.ts verify <intent>` (no `--candidate`: identity, signer, digests, tree) before each smoke group; every smoke takes `--config apps/tools/public/testnet-bridge.candidate.json` and needs `PRIVATE_KEY` + `SEPOLIA_RPC_URL`.
   - `smoke-existing-testnet.ts` — registers the hub + the first two tokens (NO deploy) and bridges each publicly and privately through `runSend`/`claimViaHub`: the manifest is self-consistent AND the generation bridges more than one token.
   - `smoke-swap-existing-testnet.ts` — the FUELED smoke: one public send with a swapped gas slice → a self-paying hub claim. Skipping it promotes an unproven fuel route.
   - `fuel-testnet.ts` — the heavy validator (public + private-FPC fuel lanes); its landed claim fees are the calibration input.
   - **Calibrate** (a local file transform, no keys): collect the paid claims' `transactionFee`s by shape (`claim_public` / `claim_private` / `transfer` / `register_and_claim_public` / `register_token`) into a `fees.json` array of `{shape, feeMode, transactionFee}` **written OUTSIDE the repo** (a stray file inside it is a dirty tree the next verify refuses) and run `bun run --cwd packages/bridge-core deploy:generation calibrate --config <candidate> --samples <path>/fees.json`. The testnet validators print each landed CLAIM's fee; the pre-created tokens are already registered, so a registering sample needs one first-time claim on a fresh test token: `pre-create --no-register --seed-pool --token <third mintable>` (the pool is what `fuel-testnet` routes through), then `fuel-testnet.ts --config <candidate> --token <third>` — its claim lands as `register_and_claim_public`, which also registers the token, so it stays in the candidate as an ordinary third token — or, failing that, carry the sandbox's measured register EXCESS (the same circuits; only the fee schedule differs) scaled by the ratio of the two networks' `claim_public` samples. It writes `fjPerTx` (the worst paid plain claim) and `fjRegister` (the worst registering shape's excess over it), both + 20 %; sponsored samples are excluded rather than allowed to drag the maximum to zero. A candidate promoted with the carried placeholders under-quotes the gas slice on the new line.
   - `live-intent.ts verify <intent> --candidate <candidate>` — records the digest (the intent file changes: **commit it now**, `promote` refuses an uncommitted intent), strict `verify-l1` + the hub initialization-hash readback inside it. Then `live-intent.ts promote <intent>` (`--bridge-only` when the faucet candidate is not part of this arc) — the ONLY thing that touches `testnet-bridge.json`. Never hand-copy; a candidate edited after this verify is refused.
9. **The live canaries** (all green = the redeploy gate): `bun run --cwd packages/bridge-core verify:l1 --config apps/tools/public/testnet-bridge.json --strict` · `BRIDGE_MANIFEST=apps/tools/public/testnet-bridge.json bun run --cwd apps/tools verify:deployments` · `fuel-testnet.ts` with `PRIVATE_RUNS=1` (the private self-paying claim MUST settle — re-confirm the step-6 gate first; this canary moves real Fee Juice) · **`fee-juice-canary-testnet.ts` (the DIRECT `feeJuice` lane — handler mint → `depositToAztecPublic(minFj)` → sponsored `FeeJuice.claim`; the lane the fueled smokes never exercise)** · a drip (`drip-canary-testnet.ts`) · the token list against its real origin (`TOKEN_LIST_LIVE=1` on `packages/bridge-core/src/token-list.test.ts` — origin, schema, chain filter, cache; never membership). **`PRIVATE_RUNS=1` is the settle-canary ONLY — its printed `minFuelFj` is a one-sample estimate; a one-sample number may only ever RAISE the floor, NEVER lower it.** To change `l1.swap.minFuelFj`, run the default full calibration (`PRIVATE_RUNS` unset, ≥3 runs) — or leave the floor alone and note it as a follow-up.
10. **Client-side reset**: the storage baseline is `BASELINE_VERSION` in `apps/extension/src/wallet/storage/migrations/index.ts` — pre-production, a fresh reinstall stamps it and runs nothing, and a shape change just redefines the baseline (no client migration UX). Chain-coupled rows (tokens, txs, balances, and other per-deployment state) are purged per-chain by `NetworkService.purgeChain` → each service's `clearChainState` (the `registerChainPurgeSubscriber` cascade + `PxeServiceClient.clearChainState`), fired when the stale network is removed. User-authored roots (contacts) are NOT chain-coupled and persist. The tools app's journal re-validates every record's token block against the live factory registration at boot, so a record from the old generation is withheld, never claimed against the new hub.
11. **CSP check**: the tools page connects to the node host the wallet reports AND to the token-list origin — `cspConnectSrc` per target lives in `apps/tools/src/lib/network-targets.ts` (the `_headers` file is GENERATED into `dist/` at build time). Confirm it covers the new node host (both `*.aztec.network` and `*.aztec-labs.com` today) and exactly one list host (`tokens.uniswap.org`).

Then Branch A's delivery gates. Live-deploy discipline: fix forward carefully, never blind-retry a live step; a few failures on one step ⇒ stop and surface. **Recovery invariant for a partial landing:** the conductor's journal IS the recovery — re-run the same `deploy` command and it skips every journalled step and adopts the two cross-bound contracts even when their line is missing (the factory by its recorded prediction + on-chain code, the hub by readback); each token resumes by `registrationOf`/`token_for`. The swap target, the router and each pool seed are journalled only AFTER their receipt, so a crash in the window between landing and the append re-sends that ONE step on re-run: a harmless orphan for the swap target/router (nothing binds the orphan), a second liquidity add for a pool seed. **After a crash, read the journal's last line against the chain before re-running** (`cast code` for a contract, the token's pool state for a seed); never pass addresses by hand, never edit the journal. Either way the LIVE `testnet-bridge.json` is untouched until step 8's smokes are green — **never promote a candidate built over a partial landing**, and `live-intent verify` refuses a candidate whose digest changed after it was recorded.

## Gotchas (hard-won)

- **Sweep version literals across the WHOLE workspace, not just the app.** Test fixtures pin the
  expected `@aztec` version in places a per-app grep misses — `apps/extension/scripts/
  layout-identity.test.ts` AND `packages/resolve-asset/src/index.test.ts` both hardcode it, and
  the second one only surfaced in CI. Run `rg -l '<old-version>' --glob '!node_modules'
  --glob '!bun.lock'` from the repo root and classify every hit.
- **`test:all` passes only when its EXIT CODE is 0.** Counting `Exited with code 0` lines is not
  a pass signal — failing packages hide behind passing ones. Check `rc=$?` and grep for
  `Exited with code [1-9]`/`FAIL ` explicitly.

- **One `@aztec` generation in the bundle, always.** Upstream's `getVKIndex`
  (`noir-protocol-circuits-types/artifacts/vks/tree.ts`) discriminates with `instanceof`, so two
  copies of that module make it treat the VK object as its own hash and abort with
  `VK index for [object Object] not found in VK tree` — thrown in-wallet BEFORE any `/prove`
  request, so the accelerator log is silent and it looks like a proving failure that never
  reached the prover. Any package that exact-pins its own `@aztec` deps (the accelerator SDK)
  must move WITH the line; holding it is not an option. Packages that declare exact-version
  PEERS (private-fee-juice) or nothing at all (standards) re-bind to the workspace line and are
  safe to hold. Gate: `scripts/aztec-hold-residue-check.ts`.
- **Upstream recompiles `@aztec/accounts` artifacts on toolchain changes** (5.2.0 moved
  SchnorrAccount's class id, −3,892 bytes). Production is immune — addresses come from the
  vendored frozen artifact — but any E2E fixture that builds accounts through
  `EmbeddedWallet.createSchnorrAccount` will fund one address and deploy another. Fix at the
  wallet-construction seam: `EmbeddedWallet`'s constructor takes an `AccountContractsProvider`,
  so subclass it and serve the frozen artifact for schnorr (see `FrozenArtifactWallet` in
  `apps/extension/tests/e2e/fixtures/aztec.ts`). Symptom order if you patch it piecemeal:
  address-parity mismatch → `Public keys not registered for account` → `Account "0x…" does not
  exist on this wallet` — those are three different upstream steps you'd be re-implementing;
  don't, use the provider.
- **`tests/e2e` is outside the tsconfig graph** — fixture breakage never shows in
  `typecheck:all`. The network suite is the only detector.
- **Clear `<app>/node_modules/.vite` after a dependency-line swap**, before the first e2e run.
  Stale dep-optimizer caches make dev-served apps fail with `.vite/deps/*.js does not exist`,
  which surfaces as a page that never loads and a test that times out far from the cause.
- **Don't edit fixtures while a suite is running.** Vitest workers load them per-worker, so a
  mid-run edit yields a mix of old and new code and results you must throw away.
- **Match the local run to CI's topology.** CI runs the network pool proverless in shards and
  only a 3-file canary lane prover-ON. Running all ~70 files prover-ON locally is ~2.5h for no
  extra signal; run prover-ON for the canaries + fee/tx-send paths and proverless for the rest.
  Two files carry `@requires-proverless` and the runner hard-fails if they're in a prover-ON set.
  And SHARD the proverless pass locally — `agent.sh` allocates its own ports per run, so 3-4
  concurrent shards are safe (CI runs 5) and cut it from ~25min to under 10. Prover-ON is the
  exception: every shard would queue on the single accelerator at the hardcoded port 59833.
- **`BB_BINARY_PATH` is a footgun**: `find_bb` returns the seed unconditionally
  (alejoamiras/aztec-accelerator#352), so a version-mismatched seed proves everything with the
  wrong bb while the log shows a download of the right one. Run the server unseeded.

- `aztec compile`'s "thread 'main' has overflowed its stack" can MASK real type errors — run `aztec-nargo compile` raw (with `ulimit -s 65520`) to see them.
- rc.2+ `DeployMethod.send()` returns `Promise<DeployResultMined>` (no `.deployed()` chain), and codegen'd `Contract.deploy` needs the **EmbeddedWallet itself** as the `Wallet` (the account object lacks `getContractClassMetadata`) with the account as `from`.
- A CONFLICTING PR runs **zero CI silently** (GitHub can't build the merge ref) — check `mergeable` before wondering where the checks went.
- `FeeJuice.claim_and_end_setup` is ONLY valid as the fee payload (setup phase — where `FeeJuicePaymentMethodWithClaim` places it). An app-phase claim under a sponsored fee must use plain `claim`, or it asserts on EVERY attempt — which looks exactly like a slow L1→L2 message sync if the retry loop swallows errors. Print the caught error on the retry cadence, and when a claim "never syncs", independently check the message witness (`node_getL1ToL2MessageMembershipWitness` with the key from the portal's deposit event) before blaming the network.
- Blanket `biome check --write` on test trees converts `vi.fn(function () {…})` mocks to arrows and breaks `new`-constructed service-client mocks (~95 failures) — format only the files you touched.

- **CI's aztec toolchain install has NO min-age gate — un-pinned transitives walk in on publish
  day.** The repo's `bunfig.toml` 7-day gate covers OUR deps only; `.github/actions/setup-aztec`
  runs the upstream installer, whose npm resolve is live. 2026-08-12: `snappy@7.4.0` (broken Node
  entry chain — unconditionally reaches the never-installed-on-linux `@napi-rs/snappy-wasm32-wasi`
  fallback) killed every fresh CI sandbox boot the day it published, while local runs stayed green
  on pre-publish `~/.aztec` trees. The action now carries a load-check-gated pin step (replaces
  snappy with 7.3.3 by direct tarball extraction, no-op when the installed one loads, fail-loud
  re-check) — **remove that step when bumping to an @aztec line whose install resolves a fixed
  snappy** (check: fresh-install in a scratch HOME, then `node -e "require('snappy')"` against the
  version dir). Same class can recur through any un-pinned transitive: diagnose via publish-time
  correlation + bare local `npm install` repro before rerunning CI.

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
