# Codex audit — aztec-5.0-rc2 (mid)

## Round 1 — plan-audit (session `019f1d5e`, xhigh, read-only)

**Verdict: `reject`** (blocking: drift treated as follow-up when it can block merge; rc.1 artifact/toolchain pins omitted; Phase 2 gates not concrete).

### Findings (paths repo-relative) + disposition

- **CRITICAL — drift is a merge-blocker, not a follow-up.** network-e2e fresh-deploys (`apps/extension/tests/e2e/global-setup.ts:348,522`) so it survives a shift — BUT `verify:deployments` rebuilds the LIVE instances from pinned JSON (`apps/faucet/src/contracts/bridge-deployments.ts:76`, `deployments.ts:68`) and drift fails it (`apps/faucet/scripts/verify-deployments.ts:47`), and it runs in the faucet build gate (`.github/workflows/_build-faucet.yml:36`). → **ADOPTED:** Phase 2 is now a hard drift decision gate (no drift → land; drift → STOP + escalate to `deep`). Verified: `_build-faucet.yml:36` runs `verify:deployments`; it derives via `getContractInstanceFromInstantiationParams`.
- **CRITICAL — Noir assessment can't run as stated.** `contracts/bridge/aztec/scripts/compile.sh:4-9` pins the rc.1 CLI toolchain; `Nargo.toml` tags rc.1. → **ADOPTED:** Scope now bumps `compile.sh` + the 5 Nargo tags; recompile all 3 (incl. keystone) + commit re-derived `target/*.json`.
- **CRITICAL — non-`@aztec` rc.1 artifact + PrivateFPC omitted.** `packages/bridge-core` PrivateFPC is bytecode/version-specific (`src/private-fuel.ts:30`) with a tripwire (`src/private-fuel.test.ts:24-25`, "re-pinning is a CONSCIOUS act"). → **ADOPTED:** the PrivateFPC tripwire is a Phase-2 drift detector; a fire → escalate.
- **HIGH — accelerator "auto-fetch" is wrong.** bb is injected via `BB_BINARY_PATH` from `setup-aztec` (SDK-version-detected, `_network-e2e.yml:193-198`, `.github/actions/setup-aztec/action.yml`). → **ADOPTED:** Fact #6 corrected; Phase 3 states the extension bump drives the proving bb; no accelerator bump expected.
- **HIGH — "5 builds" is not a root command set.** Root has `build:{chrome,firefox,faucet}` (`package.json:14-16`); landing/playground need `--cwd`. → **ADOPTED:** Phase 2 build gate lists the exact commands.
- **MED — supply chain.** A full lock delete can re-resolve non-Aztec `^` ranges; require an allowlist diff. Extracted-binary SHA has no first-download provenance. → **ADOPTED:** Phase-1 lockfile allowlist diff added; the SHA limitation accepted per `SECURITY.md`.

**Looks fine:** patches package.json-only; breaking-symbol grep clean; network-e2e fresh-deploy confirmed; cheap-first defensible once drift is a hard blocker.

**All findings verified true against the repo before folding** (`verify-deployments`/`_build-faucet.yml:36`, `compile.sh:4-9`, `private-fuel.test.ts`, `_network-e2e.yml:193-198`, `package.json:14-16`).

## Round 2 — final fresh-context pass on the revised plan (session `019f1d67`)

**Verdict: `conditional approve`** (conditions: fix accelerator SDK/version mixing; make the class-id/address drift check concrete + scoped; explicitly decide Wonderland rc.1 artifact pins). All folded.

- **HIGH — accelerator is still an rc.1 SDK.** Runtime imports `AcceleratorProver` (`packages/aztec-runtime/src/pxe/chain-runtime.ts:5`) from `@alejoamiras/aztec-accelerator@5.0.0-rc.1` (`apps/extension/package.json:32`, `packages/aztec-runtime/package.json:20`), which exact-drags rc.1 `@aztec/{bb-prover,foundation,stdlib,noir-*}` (`bun.lock:309`). → **ADOPTED:** bump the npm package to rc.2 (exists) + Phase-1 assert no rc.1 `@aztec/*` remains. Verified.
- **HIGH — "class-ids match" not a concrete gate.** `verify:deployments` checks only dripper/NULO/OLUN (`verify-deployments.ts:17`); SponsoredFPC is dynamically derived (`sponsored-fpc.ts:20`). → **ADOPTED:** Phase 2(c) adds a concrete full-surface compare (bridge/proxy/token/dripper/SponsoredFPC/PrivateFPC/FeeJuice/AuthRegistry).
- **HIGH — `compile.sh` compiles only 2 of 3.** `compile.sh:23` loops `token_minter_proxy token_bridge`; keystone excluded. → **ADOPTED:** Phase 2 explicitly adds keystone to the loop. Verified.
- **MED — Wonderland rc.1 `.tgz` not ledgered.** `apps/extension/package.json:55,64`. → **ADOPTED:** Scope "LEAVE PINNED" note (live-compat, PrivateFPC drift surface).

**Looks fine:** drift→hard-stop is the right default; committing re-derived `target/*.json` is build-input not an on-chain act; schema guards / lockfile allowlist / build commands / `BB_BINARY_PATH` fact materially improved.

## Round 3 — focused delta pass on the redeploy phases (session `019f2375`)

Context: the user overrode the gate ("class-ids will shift, we redeploy everything") → Phase 2 became a shift inventory, new Phase 3 = testnet redeploy. This round audited ONLY that delta.

**Verdict: `conditional approve`** (conditions: candidate-first Phase 3; preserve/re-pin `l1.feeJuice`; explicit fresh fuel pool setup; full chainId cascade; rename non-import package paths).

- **HIGH — Phase 3 promoted too early.** `deploy-bridge-testnet.ts:368-396` deliberately writes only `testnet-bridge.candidate.json`; promote AFTER `verify-l1 --config` + `smoke-existing-testnet --config` + fueled candidate smoke. → **ADOPTED** (Phase 3 restructured candidate-first — the script's own design).
- **HIGH — the candidate writer drops direct-Fuel config.** `CandidateManifest` has no `feeJuice` field (`deploy-manifest.ts:32-38`); the faucet consumes `l1.feeJuice` (`bridge-deployments.ts:53-63`, `useFuel.ts:75-77`) — promotion would disable direct Fuel. → **ADOPTED** (extend manifest+writer in Phase 3.3).
- **HIGH — pool/fuel reset underspecified.** `DeployBridge.s.sol:154-201` seeds unconditionally and is NOT the live AZLO topology; the guarded live path is `DeployFuelLive.s.sol:83-100` + `FUEL_ROUTER`/`FUEL_SWAP` into `deploy-bridge-testnet.ts:326-339`. → **ADOPTED** (Phase 3.2 rewritten).
- **MED — chainId cascade incomplete.** Add extension `network/service.ts:77-82` + `components/ui/utils.ts:5-8` + faucet `chain-info.test.ts:7-9` to the re-pin list. → **ADOPTED**.
- **MED — non-import package paths.** `check-fpc-version.ts:35`, `fuel-testnet.ts:180-184`, `private-fuel.test.ts:82-85` must stop resolving `@wonderland/…`. → **ALREADY DONE** (verified post-rename: all three use `resolvePackageFile("@alejoamiras/aztec-fee-payment", …)` / the fixed join segments; raw grep = 0 wonderland refs — codex read pre-rename state).

**Looks fine:** Phase 2 tripwire re-pin before the live canary is honest given Phase 3 is mandatory; faucet `deploy.ts` idempotency reasonable (`:14-16,187-241`); bridge deploy journal/resume guardrails solid for partial deploys (`deploy-bridge-testnet.ts:112-120`).

## Round 4 — post-implementation audit (session `019f23b0`)

**Verdict: `reject`** (blocking: v9 misses EntityStorage rows; promoted manifest carries the stale fuel FeeJuicePortal). All findings verified + FIXED same-session:

- **HIGH — v9 wipe missed EntityStorage rows.** `KEYS_TO_WIPE` removes bare roots (`nulo:core:accounts`) but EntityStorage persists rows as `<root>@<id>` (`packages/wallet-core/src/storage/entity_storage.ts:75`) — stale accounts/txs/balances from the pre-reset chain survived (ghost pending txs could reload via `transaction/service.ts`). **A latent v8 gap too.** → **FIXED:** added `accounts@ · txs@ · token-balances@ · tokens@ · auth-registry@ · auth-registry-enabled@` to `KEY_PREFIXES_TO_WIPE_LOCAL` (verified against the live `new EntityStorage(` root inventory). `contacts@` deliberately kept — user-authored address book, matching v8's stance.
- **MED/HIGH — promoted manifest carried the DEAD portal in `l1.fuel.feeJuicePortal`** (`0x7c4176…`) — the fuel-carry copied it from the prior manifest; `verify-l1.ts:142` consumes it for router constructor args (masked earlier because forge had already Etherscan-verified the router → skip). → **FIXED:** live+candidate manifests re-pointed to `0xb06ac8…`; the writer now refreshes `feeJuicePortal` from `nodeL1Addresses()` inside the fuel-carry (rollup-coupled, never carried); `verify-l1` re-run — all 4 contracts verified against the corrected args.
- **LOW — `DeployFuelLive.s.sol:49` + fork test defaulted to the OLD AZLO** (`0xA40A2F…`) — a future no-env rerun would silently seed the old pool. → **FIXED:** both constants → the live token `0x457F9C…`.

**Looks fine:** the sender port matches rc.2 tagging-source semantics (`getSenders` correctly filters `address-derived`); the `l1.feeJuice` node-sourced block, portal/FPC re-pins, chainId cascade, and class-qualified Unsafe renames sound; the min-age exclude set tolerable as a dated temporary exception with the removal follow-up.
