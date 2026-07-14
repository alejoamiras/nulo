# Aztec JS 5.0.0-rc.2 → 5.0.0 (stable) — bump + signing-key-root accounts + testnet redeploy

**Tier:** `mid` (rubric at Phase 0.5: novelty LOW — 4th bump on this line, and this exact rc.2→5.0.0 migration shipped in aztec-accelerator (2026-07-13) + ecosystem-tooling (2026-07-14) with detailed lessons; blast radius + irreversibility HIGH — live Sepolia broadcasts, Fee Juice movement, wallet-wide address change; precedent: the rc.2 bump here and the accelerator stable bump both ran `mid`). **Audits:** codex `gpt-5.6-sol` at `model_reasoning_effort=xhigh` (its max) + fable subagent, dual + final fresh-context pass. **Branch:** `worktree-aztec-5.0.0-stable`.

**Status: DRAFT — pre-audit.**

## Summary

Bump the `@aztec/*` line `5.0.0-rc.2` → `5.0.0` (67 pins across 8 package.json) plus the three `@alejoamiras/*` packages (10 pins) to their published `5.0.0`, adopt upstream's **signing-key-root** account model (the user's explicit Phase-0 decision — `deriveSigningKey` is removed and the relationship inverted), absorb the PXE API churn (`updateContract` removed, `registerContract` split, `currentContractClassId` dropped from the instance preimage, browser KV store defaults to SQLite-OPFS), migrate the Noir surface (toolchain + tags + `consume_l1_to_l2_message([secret])` + the last `@defi-wonderland` remnant → `alejoamiras/ecosystem-tooling`), and execute the **coupled testnet redeploy** — the live network HAS reset (rollupVersion `2787991301` → `1821665230`, FeeJuicePortal → `0xb4a9f8ea…`), so `verify:deployments` reds the faucet build until the live world and the pins agree. Same Branch-B shape as the rc.2 run, with three sibling worked examples to draw on.

**Urgency context:** the deployed faucet targets the dead rollup — the public faucet is broken **today**. This plan is the path back to a working public surface.

## Why this shape (context from the probes)

- **Live probe 2026-07-14:** `node_getNodeInfo` on `v5.testnet.rpc.aztec-labs.com` → `nodeVersion 5.0.0`, `rollupVersion 1821665230`, `l1ChainId 11155111`. Our pin: `TESTNET_ROLLUP_VERSION = 2787991301` (`apps/faucet/src/lib/chain-constants.ts:22`). New wallet chainId = `(11155111 ^ 1821665230) >>> 0` = **`1816023401`**.
- **New L1 set:** rollup `0xd73a91bd…`, registry `0xa0bfb1b4…`, inbox `0x3047dbf2…`, outbox `0x905f8000…`, **feeJuicePortal `0xb4a9f8ea…` (moved — the router-rebind failure mode)**; feeJuice `0x762c1320…` + feeAssetHandler `0x5602c39a…` **unchanged** (L1 never resets).
- **npm:** `@aztec/*@5.0.0` published 2026-07-13; `@alejoamiras/aztec-accelerator@5.0.0` 2026-07-13; `@alejoamiras/{aztec-standards,aztec-fee-payment}@5.0.0` 2026-07-14. All three `@alejoamiras` names + the ~30 `@aztec` names are ALREADY in `bunfig.toml` `minimumReleaseAgeExcludes` (name-based), so the 7-day gate does not block this bump; the exclude comment gets re-dated and the removal follow-up re-owed.
- **Sibling lessons** (the "we learned a ton" memory): aztec-accelerator `implementations-plan/aztec-5.0.0-stable-2026-07-13/` (read via `git show origin/main:…` in that clone) and ecosystem-tooling PR #2. Un-changelogged catches they surfaced: upstream `deriveKeys` stopped stubbing the message-signing/fallback public-key hashes (addresses shift no matter what), 5.0.0 nodes 405 a plain GET `/status` (we have no such probe — verified), and the SQLite-OPFS/Vite integration fights (worker resolution, `#msgpackr` subpath imports, unhashed `sqlite3.wasm` emission).

## Scope

**IN:**

1. **Pins**: 67 `@aztec/*` → `5.0.0` across `apps/{extension(19),faucet(15),playground(7)}` + `packages/{aztec-runtime(10),bridge-core(9),wallet-bridge(4),wallet-crypto(1),wallet-sdk-schema-patch(2)}`; 10 `@alejoamiras/*` → `5.0.0` (`aztec-accelerator` ×2, `aztec-standards` ×5, `aztec-fee-payment` ×3). `@aztec/viem` untouched (independent line).
2. **Patches**: re-key `patches/@aztec%2Fnoir-{acvm_js,noirc_abi}@5.0.0-rc.2.patch` → `@5.0.0` + the root `patchedDependencies` keys; verify they still apply (both patch only `package.json` exports maps).
3. **Lockfile ritual**: `rm bun.lock && bun install` (Bun #25305; `linker = "hoisted"` stays pinned), allowlist diff, zero `5.0.0-rc.2` entries remain.
4. **Signing-key-root account model** (user decision): invert `packages/aztec-runtime/src/account/nulo-account.ts` — the single production inversion point (lines 54-68 + 189). New chain: `accountSeed = poseidon2Hash([master, chainId, type, index])` (unchanged, `account/service.ts:205-211`) → **deterministic seed→signingKey step** (upstream-primitive-based reduction to `GrumpkinScalar`; no hand-rolled crypto) → `secretKey = await deriveSecretKeyFromSigningKey(signingKey)` (`@aztec/accounts/utils`, verified exported in the published 5.0.0) → `deriveKeys(secretKey)` → instance at `salt Fr.ZERO` → address. Passkey + password layers untouched (they terminate at the master secret — verified). Key-vector updates: V7a replaced by a pinned pair (seed→signingKey; signingKey→secretKey), regenerated per the file's own documented migration ritual. E2E fixture parity check (`tests/e2e/fixtures/aztec.ts:365-392`) + the 9 script call sites (`createSchnorrAccount` signing-key-first signature) migrated to the same model.
5. **PXE seam churn**: remove `updateContract` (upstream-removed; zero external callers of the seam method — verified); adapt `registerContract` internally to the split `registerContractClass(artifact)` + `registerContract(instance)` while keeping OUR `{instance, artifact?}` RPC shape (rc.2 precedent: wrap upstream churn inside `PxeService`); re-verify the zod response pins (`ContractInstanceWithAddressSchema` loses `currentContractClassId`); migrate the 4 production readers of `instance.currentContractClassId` (`account-state/service.ts:169-171`, `note/service.ts:271`, `execution/tx-request-builder.ts:269`, `logger/utils.ts:92`).
6. **Browser KV store (SQLite-OPFS)**: the flip has exactly one blast radius — the extension offscreen PXE (`chain-runtime.ts:140,189`; faucet/playground browser code never instantiates a PXE — verified). Work: determine 5.0.0's backend selection in `createPXE`; add the missing Vite plumbing for `@aztec/sqlite3mc-wasm` (wasm emit + worker handling, adapting the accelerator lessons to the MV3 extension pipeline); **rework the purge cascade** — `pxe/service.ts:458,509` + `client.ts:198` delete by IndexedDB database name and would silently no-op on OPFS (storage leak + broken profile/chain purge); empirical persistence spike in the offscreen document.
7. **Noir surface**: `compile.sh` toolchain → `~/.aztec/versions/5.0.0` (`aztec-up install 5.0.0`); the 5 aztec-nr/portal-lib tags ×3 Nargo.toml → `v5.0.0` (upstream tag verified); **the `token` dep → `git = "https://github.com/alejoamiras/ecosystem-tooling", tag = "v5.0.0", directory = "packages/aztec-standards/src/token_contract"`** (path verified in the tag's tree — this is the LAST live `@defi-wonderland` reference; the npm pins moved at rc.2); `consume_l1_to_l2_message(content, [secret], …)` in `token_bridge/src/main.nr` (the only Noir break — the other changelog items grep to zero); recompile all 3 + path-scrub + commit artifacts; portal-fork pins reviewed/regenerated if 5.0.0's l1-contracts shifted bytecode (`FORKED_PORTAL_KECCAK` / `PORTAL_PIN`).
8. **Shift inventory + coupled testnet redeploy (Branch B, user-authorized)**: chainId cascade (4 sites), L1 constants re-pin, guarded `DeployFuelLive` (SEED flags false first, dry-run first), candidate-first L2 bridge, faucet deploy, PrivateFPC **version-gate-then-deploy at the canonical 5.0.0 pin** (`0x257aa870…efc86e9`, fixed salt `0x…01` — ecosystem-tooling `canonical-deployment.json`; rc-era operator-local salts are dead), SponsoredFPC cross-check against the accelerator's already-deployed-and-funded salt-0 instance (`0x0628377e…3fe1`, same rollup), pool re-seed for the fresh AZLO, candidate smokes incl. the FUELED smoke, promote, the five live canaries.
9. **Delivery + docs**: PR labeled `e2e:network` + `e2e:smoke`; stale `5.0.0-rc.2` sweep (live refs only — `compile.sh`, bunfig comment dates, `UPDATE.md` current-line; historical plan/lesson mentions stay); `UPDATE.md` coupling appendix entries; `aztec-update` skill lesson updates; `implementations-plan/index.md`.

**OUT:**
- The min-age-exclude **removal** (separate follow-up PR after the 5.0.0 set ages past 2026-07-21).
- Marketplace/npm publishing; anything mainnet-shaped; Cloudflare dashboard config (user-owned).
- A storage **migration** for the address change: pre-production rule (CLAUDE.md) — no users, devs reinstall; the stored `nulo:core:accounts` rows keyed by old addresses become stale and `getAccountContract`'s address-consistency assert would throw on old data; the launch baseline is simply redefined. No `BASELINE_VERSION` bump needed (shape unchanged; values stale; fresh installs stamp and run nothing).
- The Footer.vue "Wonderland aztec-standards" credit link stays (authorship credit, not a package reference — rc.2 precedent). Flagged for the gate; trivially changeable if the user disagrees.
- Firefox-runtime OPFS validation: the Firefox build stays a build-only gate (current CI scope); runtime proof is Chrome smoke + network e2e.

## Main plan

### Phase 1 — Mechanical bump + install + break inventory

1. `bunfig.toml`: re-date the `minimumReleaseAgeExcludes` comment (5.0.0 set published 2026-07-13/14, ages out ~2026-07-21; follow-up removal PR re-owed). After install, re-enumerate the `@aztec/*` transitive set from the NEW `bun.lock` and reconcile the exclude list (5.0.0 may add/drop transitive names).
2. Re-key the two patches + `patchedDependencies`.
3. Bump the 67 + 10 pins.
4. `rm bun.lock && bun install`. Allowlist diff (only `@aztec/*` + `@alejoamiras/*` + in-range `^` refreshes; trace odd new transitives); `rg -c '5\.0\.0-rc\.2' bun.lock` → 0; `bun install --frozen-lockfile` re-run green (CI equivalence).
5. `bun run typecheck:all` — **expected RED**; write the complete break inventory to `lessons/phase-1.md` (the checklist for Phase 2).

**Validation gate** — Commands: `bun install` (patches apply; min-age holds on non-excluded) · lockfile allowlist check + zero-rc.2 grep · frozen-lockfile re-install · typecheck break inventory complete in lessons. Pass: install clean, lock diff Aztec-scoped, inventory written. Layers: install · lockfile · inventory. (Typecheck green is Phase 2's gate, not this one's.)

### Phase 2 — API migration: signing-key-root + PXE seam + TS churn

1. **Account inversion** (`nulo-account.ts` + `account/service.ts`): implement the chain in Scope #4. The deterministic seed→signingKey step uses an upstream-exported reduction primitive (to be confirmed against installed 5.0.0 — e.g. the same sha512-to-Grumpkin-scalar helper the removed `deriveSigningKey` used, if still exported from `@aztec/foundation`; else `GrumpkinScalar.fromBufferReduce` over a domain-separated hash). **No hand-rolled crypto**: only `@aztec/foundation`/`@aztec/accounts` primitives, and the choice is pinned by new key vectors. Re-check `pxe.registerAccount`'s 5.0.0 signature (the changelog moves PXE toward receiving only privacy keys) and adapt `ensureRegistered` accordingly.
2. **Key vectors**: replace V7a with the new pinned pair; regenerate fixtures via the file's documented ritual (this IS the sanctioned "signing key of every wallet just changed" migration moment its header describes); V3/V8/V9/P1 and the password vectors must NOT move (they pin layers above/beside the inversion — if any of them shifts, STOP: something upstream moved that we didn't model).
3. **Scripts + e2e fixture**: migrate the 9 `createSchnorrAccount`/`deriveSigningKey` call sites (faucet deploy.ts, 7 bridge-core scripts, e2e fixture) to signing-key-first; keep the fixture's NuloAccount↔EmbeddedWallet address-parity assertion as the cross-implementation proof.
4. **PXE seam**: Scope #5. `updateContract` removed from descriptors/spec/ipxe/service/client + descriptor-pin tests; `registerContract` adapted internally; zod pins re-verified against 5.0.0 shapes; the 4 `currentContractClassId` readers migrated per-site (default: `originalContractClassId` — this wallet predates contract-upgrade support; document the assumption at each site).
5. Sweep the rest of the inventory until green.

**Validation gate** — Commands: `bun run typecheck:all` · `bun run test:all` · `bun run lint` · the 5 builds (`build:chrome`, `build:firefox`, `build:faucet`, `--cwd apps/playground build`, `--cwd apps/landing build`). Pass: all exit 0 (units include the regenerated vectors + schema-patch runtime guards + dispatcher reachability pin). Layers: typecheck · unit · lint · build. **Fast-fail:** a non-mechanical break (an API we depend on with no 5.0.0 equivalent) → stop, codex triage, re-plan.

### Phase 3 — Offscreen PXE storage backend (SQLite-OPFS)

1. Inspect installed 5.0.0 `@aztec/pxe/client/bundle`: how `createPXE` selects the browser backend; whether a config knob exists to stay on IndexedDB (deprecated entrypoint). **Default decision: follow upstream onto SQLite-OPFS** (the deprecated entrypoint is a dead end and the v5 wipe resets state regardless); staying on IndexedDB is the documented fallback ONLY if OPFS proves unavailable in the offscreen document.
2. Vite plumbing for `@aztec/sqlite3mc-wasm` in the extension build (accelerator lessons, adapted to MV3: wasm emit alongside the existing bb-wasm plugins, worker-request handling with exact-basename matching, no SPA-fallback concern but MV3 CSP + `web_accessible_resources` apply; COEP/COOP already configured for bb threads).
3. **Purge cascade rework**: replace the IndexedDB-name deletions (`pxe/service.ts:458,509`, `client.ts:198`) with backend-appropriate teardown (OPFS directory removal keyed on `chainDataDir`); update the `chain-coordinates.ts` PERSISTED-comment. One-shot best-effort cleanup of orphaned rc.2 IndexedDB databases: pre-production, NOT owed — devs reinstall; note it.
4. **Empirical spike (the phase's point)**: dev build → offscreen PXE boots on OPFS → create account → restart extension → state persists → profile/chain purge actually removes the OPFS store (verify via `navigator.storage` inspection in the offscreen context).

**Validation gate** — Commands: `bun run test:e2e` (smoke — boots the real extension) · the scripted offscreen persistence + purge check (recorded in lessons with the observed OPFS layout) · `typecheck:all` + touched-package units + `lint` stay green. Pass: smoke green, persistence + purge proven in the real offscreen document. Layers: smoke-e2e · runtime-empirical · typecheck/unit/lint. **Fast-fail:** OPFS unavailable in offscreen → fall back to the deprecated IndexedDB entrypoint (if a knob exists) and log the decision; no knob AND no OPFS → stop + surface (that would block the whole bump).

### Phase 4 — Noir surface + shift inventory

1. `aztec-up install 5.0.0`; `compile.sh` `AZTEC_HOME` → `5.0.0` (+ its rc.2 comment).
2. Nargo tags: aztec-nr + `token_portal_content_hash_lib` ×3 → `v5.0.0`; the `token` dep → ecosystem-tooling `v5.0.0` (Scope #7 — the defi-wonderland close-out).
3. `token_bridge/src/main.nr`: wrap the message secret — `consume_l1_to_l2_message(content, [secret], sender, leaf_index)`.
4. Recompile all 3 + transpile + path-scrub + commit `target/*.json`. If `aztec compile` stack-overflows, run raw `aztec-nargo compile` (`ulimit -s 65520`) to surface real type errors (rc.2 gotcha; mixed-Noir-set errors mean a tag mismatch — check the `token` dep first).
5. **Portal-fork pins**: diff rc.2→5.0.0 l1-contracts for `NuloTokenPortal.sol`'s imports; regenerate `NuloTokenPortal.build.json` with pinned solc against 5.0.0 artifacts; update `FORKED_PORTAL_KECCAK`/`PORTAL_PIN` if shifted.
6. **Shift inventory** (drift EXPECTED — the reset confirms it): `bun run --cwd apps/faucet verify:deployments` (expected RED against dead-rollup pins), the PrivateFPC tripwire (`private-fuel.test.ts` — expected fire → **conscious re-pin to the canonical `0x257aa870…` at salt `0x…01`**, cross-checked TWO ways: `check-fpc-version.ts` against the live node AND ecosystem-tooling's `canonical-deployment.json`; the live re-canary is owed by Phase 5), the one-shot bridge/proxy re-derive. Full old→new inventory written to `lessons/phase-4.md` — it is Phase 5's checklist.

**Validation gate** — Commands: the 3 compiles + transpile · the shift-inventory scripts · `test:all` (tripwire consciously re-pinned, never silenced) · `lint` · builds. Pass: artifacts committed, inventory complete, all local gates green except `verify:deployments` (intentionally red until Phase 5 promotes). Layers: contract-compile · derivation-inventory · unit · lint · build.

### Phase 5 — Coupled testnet redeploy (live; authorized at Phase 0)

Pre-flight (fail-closed, before any signing): re-probe `node_getNodeInfo` (nodeVersion `5.0.0`, rollupVersion `1821665230`, chainId `11155111`); deployer envs present + funded (`packages/bridge-core/.env`: `PRIVATE_KEY`, `SEPOLIA_RPC_URL`; `apps/faucet/.env`: `DEPLOYER_SECRET_KEY`, `DEPLOYER_SALT` — byte-identical standing copies existed in the nulo-3/nulo-4 worktrees at rc.2; **surface if missing, never create/rotate credentials, never print key material**).

1. **ChainId cascade**: `TESTNET_ROLLUP_VERSION` → `1821665230` / chainId `1816023401` at the 4 sites: `apps/faucet/src/lib/chain-constants.ts` + `chain-info.test.ts`, `apps/extension/src/wallet/services/network/service.ts:84` (DEFAULT_SEEDS), `apps/extension/src/components/ui/utils.ts:7` (CHAIN_IDS).
2. **L1 constants**: FeeJuicePortal `0xb4a9f8ea…` (+ registry/inbox/outbox where referenced) in `DeployBridge.s.sol`, `DeployFuelLive.s.sol` (+ its AZLO default), `.env.example`, both fork tests.
3. **L1 fuel**: `DeployFuelLive` with `SEED_AZLO_WETH=false SEED_ETH_FJ=false` (pools persist; L1 never reset) — **dry-run first, read the planned actions, then `--broadcast --slow`**. Router rebinds the new portal ⇒ router + swap redeploy.
4. **L2 bridge — candidate-first**: `deploy-bridge-testnet.ts` with `FUEL_ROUTER`/`FUEL_SWAP` = the fresh pair; writes `testnet-bridge.candidate.json` only (the `l1.feeJuice` block node-refreshed by the rc.2 manifest fix — never carried). Fresh L1 AZLO minted by design. **Faucet deploy in parallel** (`bun run --cwd apps/faucet deploy:testnet` — independent accounts, rc.2-proven).
5. **PrivateFPC — version gate FIRST**: `AZTEC_NODE_URL=<node> bun packages/bridge-core/scripts/check-fpc-version.ts` (read-only). Green ⇒ `deploy-private-fpc-testnet.ts` at the **canonical salt `0x…01`** (update the script's salt/pin expectations to canonical — rc-era salts are dead; the script asserts the pinned address, which must equal `0x257aa870…efc86e9`). Red gate ⇒ STOP (a wrong-version FPC deposit is unrecoverable).
6. **SponsoredFPC**: re-derive at salt 0 with the 5.0.0 artifact; expected == the accelerator's live funded instance `0x0628377e…3fe1` (same rollup, universal deploy — reuse; deploy only if our derivation unexpectedly differs, which would itself be a stop-and-investigate signal).
7. **Pool seed for the fresh AZLO**: re-run `DeployFuelLive` with `TOKEN_ADDRESS=<new AZLO>` + `ROUTER_ADDRESS`/`FUEL_SWAP_ADDRESS` reuse flags + `SEED_AZLO_WETH=true SEED_ETH_FJ=false`.
8. **Candidate smokes → promote**: `verify-l1.ts --config candidate` · `smoke-existing-testnet.ts --config` · `smoke-swap-existing-testnet.ts --config` (the FUELED smoke — mandatory before promotion). All green ⇒ promote candidate → `testnet-bridge.json` + re-pin consumers (`deployments.json`/`deployments.ts`, `bridge-deployments.ts`, `sponsored-fpc.ts`).
9. **The five live canaries**: `verify-l1` · `verify:deployments` GREEN on the new pins · the candidate smoke (done) · `fuel-testnet.ts` `PRIVATE_RUNS=1` (settle-canary ONLY — its one-sample `minFuelFj` may RAISE the floor, never lower; full calibration is a follow-up unless the floor must move down) · a drip.
10. **Client-side + CSP**: confirm `apps/faucet/public/_headers` `connect-src` still covers the RPC host (unchanged host — expect no-op); PXE schema-wipe note (upstream auto-wipes on version mismatch — combined with the address change, the dev story is "reinstall", documented in lessons; no reset-UX work owed pre-production).

**Validation gate** — Commands: the five canaries. Pass: all green against the LIVE 5.0.0 testnet — world and pins agree. Layers: live-deploy · derivation · live-canary. **Live-deploy discipline:** fix forward, never blind-retry; partial L1 fuel ⇒ re-run with reuse flags (never from scratch); partial L2 bridge ⇒ the script hard-stops by design, fix forward; **never promote a candidate built over a partial landing**; a few failures on one live step ⇒ stop + surface (5-failure hard stop in autonomous mode).

### Phase 6 — Delivery: PR + native-proving network-e2e + docs

1. PR to `dev` labeled **`e2e:network` + `e2e:smoke`** (dep-diff warrants both). Accelerator-server binary stays `v1.0.6` (bb is injected per the SDK version by `setup-aztec`; runtime bb-5.0.0 download + digest-verify already proven in the accelerator's own CI). Fallback only if network-e2e fails specifically on proving: bump `version`+`expected_sha256` in `_network-e2e.yml` to a newer server release.
2. Stale-ref sweep: live `5.0.0-rc.2` mentions (`compile.sh` comment, `bunfig.toml` comment dates, `UPDATE.md` "Current line", `_network-e2e.yml` comments, the schema-patch comments if any); historical plan/lesson mentions stay.
3. Docs in the same PR: `UPDATE.md` coupling appendix (new entries: the seed→signingKey derivation seam, the OPFS purge coupling), `aztec-update` skill (canonical FPC salt policy, ecosystem-tooling as the standards Noir source, the OPFS notes, the double-reset probe lesson), `implementations-plan/index.md`.
4. Check `mergeable` before reading CI silence as failure (a CONFLICTING PR runs zero CI).

**Validation gate** — Commands: `quality-status` + `smoke-e2e-status` + `network-e2e-status` green on the PR head (native proving, `VITE_NULO_ACCELERATOR_REQUIRED=1`, silent WASM fallback = hard fail). Pass: all three required checks green; no stale live rc.2 refs. Layers: quality · smoke-e2e · network-e2e-live.

### Post-implementation

`/code-review max --fix` (separate commits) → codex post-impl audit (`gpt-5.6-sol` xhigh; net diff + code-review-commit summary + plan + adversarial ask) → fix loop. **/harden: not scheduled** — the repo completed security-harden arcs in June/July; this plan adds no new trust boundary beyond what the audits here cover. Surfaced at the gate for the user to override.

## Competing outline — "live-first" (restore the public faucet before the client work)

Reorder: Phase 1 (mechanical bump) → Phase 4 (Noir + shift inventory) → Phase 5 (redeploy) → Phases 2–3 (account inversion + OPFS) → Phase 6. Rationale: the public faucet is broken TODAY; live-first shortens the outage window and de-risks the irreversible work while the diff is small.

**Why the main plan rejects it:** the redeploy scripts themselves sit ON the broken APIs — `deploy-bridge-testnet.ts`, `fuel-testnet.ts`, `deploy.ts` et al. all call `deriveSigningKey`/`createSchnorrAccount` and won't run under 5.0.0 until migrated (Phase 2's script leg), and `verify:deployments`/the faucet build can't go green while the faucet's TS doesn't compile. The minimum viable "live-first" is Phase 1 + the script/API leg of Phase 2 + Phase 4 — at which point it has converged with the main plan's order minus the extension-side work, for zero net time saved and a mid-arc mixed state (live world promoted while the wallet can't build). The outage argument also cuts the other way: the faucet stays broken until the PR **merges and deploys**, and the PR can't merge until everything is green regardless of internal ordering. Sequencing stays cheap-fail-first.

## Security & Adversarial Considerations

- **Threat model**: supply chain (npm packages 0–1 days old), live-deploy credential handling, an attacker-controlled testnet RPC response shaping deploy targets, malicious backup blobs (unchanged surface — no new storage shape), the PXE trust boundary (improved by this plan).
- **Supply chain**: all four lines exact-pinned; `@aztec/*` provenance = upstream's pipeline; `@alejoamiras/*` are first-party (accelerator: OIDC trusted publisher; ecosystem-tooling: rehearse-then-release byte-compare + provenance — its own audited pipeline). The min-age excludes are name-scoped and already present; the removal follow-up is re-owed with a date. Lockfile allowlist diff guards the transitive graph; `--frozen-lockfile` re-install proves CI equivalence.
- **Key handling (live redeploy)**: standing deployer envs only — never created, rotated, printed, or echoed; env sourced inside the command's own shell (accelerator lesson); dry-run-first forge discipline; `--slow` on broadcast. Partial-landing recovery via reuse flags only.
- **The FPC unrecoverable-deposit window**: a version bump is exactly the op that opens it. Two independent gates before any Fee Juice moves: `check-fpc-version.ts` (live node vs artifact) AND the ecosystem-tooling canonical pin cross-check. Red ⇒ stop, never deploy-then-hope.
- **Signing-key-root is a security improvement**: post-change, the PXE-held privacy secret can no longer reconstruct the ownership (signing) key — the changelog's stated motivation. Our inversion preserves that property: the signing key exists only in the extension's derivation path, never registered into the PXE.
- **Cryptography**: no hand-rolled primitives — the seed→signingKey reduction uses `@aztec/foundation` exports, and `deriveSecretKeyFromSigningKey` is upstream's. Every derivation step pinned by regenerated key vectors; the non-Aztec vectors (V1/V2/V3/V6/V8/V9/P1) must NOT move — any drift there is a stop signal.
- **Input validation**: the PXE seam's zod response pins are re-verified against 5.0.0 shapes (a widened/reshaped upstream schema silently rejecting valid responses at runtime is the known failure mode; network e2e is the detector).
- **Nargo git deps**: tag-pinned to upstream + first-party repos; committed compiled artifacts make source drift detectable (a moved tag changes the recompile diff). ecosystem-tooling additionally verifies its refs bidirectionally (`nargo-deps.lock.json`).
- **CI/e2e**: no gate weakening anywhere — `verify:deployments` stays the drift detector (red until promotion, green required to merge); the PrivateFPC tripwire is re-pinned consciously, never silenced; native-proving required mode stays on.

## Assumptions

**Facts** (verified this session):
1. Live testnet: rollupVersion `1821665230`, nodeVersion `5.0.0`, FeeJuicePortal `0xb4a9f8ea…`, feeJuice/feeAssetHandler unchanged (probe 2026-07-14). Our pin `2787991301` (`chain-constants.ts:22`) ⇒ NETWORK RESET.
2. `@aztec/*@5.0.0`, `@alejoamiras/{aztec-accelerator,aztec-standards,aztec-fee-payment}@5.0.0` all published (npm, 2026-07-13/14); all names already in `minimumReleaseAgeExcludes`.
3. `deriveSecretKeyFromSigningKey(signingKey: GrumpkinScalar): Promise<Fr>` exported from `@aztec/accounts/utils`; `getSchnorrAccountContractAddress(signingPrivateKey, salt, secretKey?)` in `@aztec/accounts/schnorr/private_immutable` (unpacked the published 5.0.0 tarball).
4. Pin surface: 67 `@aztec` + 10 `@alejoamiras` across 8 package.json (counted); patches currently keyed `@5.0.0-rc.2`; `compile.sh:13` pins `~/.aztec/versions/5.0.0-rc.2`; Nargo tags `v5.0.0-rc.2` ×5 + `token` at `defi-wonderland/aztec-standards#prerelease-568f58f`.
5. Derivation chain mapped (Explore agent, file:line in the report): single inversion point `nulo-account.ts:54-68,189`; account secret from `account/service.ts:205-211`; passkey/password layers terminate at the master secret; account rows keyed by derived address (`nulo:core:accounts`, throw-on-mismatch at `account/service.ts:199-201`); `BASELINE_VERSION = 1` with zero real migrations shipped.
6. Production `getSchnorrAccountContractAddress` usage: none (doc-comment only). `updateContract`: seam-internal only. `currentContractClassId`: 4 production readers (listed in Scope #5).
7. The extension offscreen PXE is the only browser PXE in the repo (faucet/playground are wallet-sdk dApps — grep-verified); the purge cascade deletes by IndexedDB name (`pxe/service.ts:458,509`, `client.ts:198`); the extension Vite config has bb-wasm plumbing but zero sqlite3mc handling.
8. ecosystem-tooling `v5.0.0` tag: public repo, `packages/aztec-standards/src/token_contract/Nargo.toml` exists; canonical PrivateFPC `0x257aa870…efc86e9` at salt `0x…01`, `aztecVersion 5.0.0` (`canonical-deployment.json`).
9. Upstream `v5.0.0` git tag exists on AztecProtocol/aztec-packages. Accelerator-server CI binary is `v1.0.6` + SHA-pinned; bb is version-injected via `setup-aztec` (rc.2 Fact, re-confirmed by the accelerator's 5.0.0 CI run).
10. The only Noir break on our surface is `consume_l1_to_l2_message` in `token_bridge/src/main.nr` (all other changelog Noir items grep to zero across `contracts/`).
11. Sibling migrations shipped clean on this exact version pair: aztec-accelerator PR #376/#378 (2026-07-13), ecosystem-tooling PR #2 (2026-07-13/14) — their lessons are folded into this plan (405 /status probe: we have none; sqlite-opfs Vite fixes; `deriveKeys` stub removal).

**Inferences** (unverified — attack these):
1. 5.0.0's `createPXE` (browser bundle) offers no store-backend knob and defaults to SQLite-OPFS; Phase 3 step 1 verifies. If a knob exists, the OPFS-vs-IndexedDB decision reopens (default remains OPFS).
2. OPFS (incl. SyncAccessHandle workers) is available in the Chrome MV3 offscreen document. Phase 3's spike verifies empirically. If not: fall back per the phase's fast-fail.
3. `pxe.registerAccount(secret, partialAddress)` keeps a compatible shape (the changelog reshapes account *export*, not registration). Typecheck + the seam pins catch it if not.
4. The instance preimage retains `originalContractClassId`, making it the right substitute at the 4 `currentContractClassId` sites for a pre-upgrade-support wallet. Verified against installed types in Phase 2.
5. The two Bun patches apply unchanged to the 5.0.0 packages (they only add exports maps; rc.1→rc.2 held). Phase 1 verifies.
6. The v1.0.6 accelerator-server + SDK-injected bb 5.0.0 proves our network e2e (mechanism proven at rc.2 + in the accelerator's 5.0.0 CI; our suite re-proves in Phase 6).
7. Our salt-0 SponsoredFPC derivation with the 5.0.0 artifact equals the accelerator's live `0x0628377e…3fe1` (same artifact, same salt, same rollup). A mismatch = artifact/salt divergence to investigate, not deploy-over.
8. aztec-nr `v5.0.0` + ecosystem-tooling standards `v5.0.0` Noir sources are tag-compatible (ecosystem-tooling compiled them together in its own release gates). A mixed-set nargo error (`generic argument N on 'call'`) points here first.
9. The stable protocol at rollup `1821665230` matches the published 5.0.0 artifacts (nodeVersion says so) — i.e., no third reset lands mid-arc. Phase 5's pre-flight re-probes immediately before signing.

**Asks** (all resolved at Phase 0 — none open):
- Bump class: **network reset, coupled redeploy** (user, 2026-07-14).
- Live authorization: **full scripted redeploy authorized** (user; dry-run-first + candidate-first discipline binding).
- Key model: **adopt upstream signing-key-root** (user; the vendored-secret-root alternative recorded as rejected in the ledger).
- Tier/audits: **mid; codex `gpt-5.6-sol` at `xhigh`** (user; "ultra" mapped to codex's max effort `xhigh`).
- At the gate (small, defaulted): Footer.vue Wonderland credit stays; /harden not scheduled; Firefox runtime-OPFS stays out of scope.

## Decision ledger

_To be completed through the audit rounds. Seeded entries:_

| # | Decision | Chosen | Rejected alternative(s) | Why |
|---|---|---|---|---|
| D1 | Account key model | Upstream signing-key-root (user override of my recommendation) | Vendor the removed `deriveSigningKey`, keep secret-root | Upstream alignment + the PXE-can't-reconstruct-ownership-key property; addresses shift either way (deriveKeys stub removal + reset) so the migration cost delta is small |
| D2 | Phase order | Cheap-fail-first (bump → API → OPFS → Noir → redeploy) | "Live-first" competing outline | The redeploy tooling itself sits on the broken APIs; see the competing-outline section |
| D3 | Browser store | Follow upstream onto SQLite-OPFS | Pin deprecated IndexedDB entrypoint | Deprecated path is a dead end; v5 wipes state regardless; purge-cascade rework owed either way it stays correct |
| D4 | PrivateFPC pin | Canonical salt `0x…01` / `0x257aa870…` | Keep operator-local-salt lineage | Canonical policy is the 5.0.0-onward contract of the fee-payment package; two independent gates before funds move |
| D5 | Wonderland close-out | Nargo `token` dep → ecosystem-tooling `v5.0.0`; Footer credit stays | Fork-tag on alejoamiras/aztec-standards (no v5.0.0 tag exists); de-credit the UI | ecosystem-tooling is the published 5.0.0 source of truth; the credit is authorship, not a dependency |
| D6 | Address-change handling | Pre-production reset (devs reinstall), no migration, no BASELINE bump | First real storage migration | CLAUDE.md pre-production rule; shape unchanged, values stale; migration would be untestable-against-real-data work |

## Seeds (DRAFT — finalized after the approval gate)

### Recommended: `/goal`

```
/goal All six phases marked ✓ in implementations-plan/aztec-5.0.0-stable/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/aztec-5.0.0-stable/lessons/phase-N.md in the transcript; the five live canaries green (verify-l1, verify:deployments, candidate smoke, fuel-testnet PRIVATE_RUNS=1 settle, a drip); /code-review max --fix complete with findings applied and committed separately; codex post-impl audit (gpt-5.6-sol, xhigh) complete with high/critical findings addressed; `bun run test:all` and `bun run lint` both report exit 0 in the transcript; the PR to dev is open with labels e2e:network + e2e:smoke and quality-status, smoke-e2e-status, network-e2e-status all green on its head.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/aztec-5.0.0-stable forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/aztec-5.0.0-stable/plan.md and lessons/ (authoritative state — not the chat); run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json mergeable,statusCheckRollup` (no --watch; CONFLICTING = zero CI, resolve first).
2. Waiting on CI is fine — confirm it progresses (`gh run watch <id>` up to 10 min); use the wait to review the diff or prep the next phase.
3. No task in hand? Pick the next pending step from plan.md. After each meaningful edit run the fast layers (`bun run lint` + the touched package's tests), then commit → push.
4. Stuck or facing a decision you'd bring to me? Call codex (`gpt-5.6-sol`, xhigh) with full context, reach a defensible verdict, act, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to main, never publish, never weaken a CI gate, never move Fee Juice past a red check-fpc-version gate, never promote a candidate over a partial landing, no scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex. Live-deploy steps: stop and surface after a FEW failures — never blind-retry a broadcast.
6. Phase green = ITS VALIDATION GATE as written in plan.md passes; paste the result, mark ✓ in plan.md, write lessons, print LESSONS_FILE=implementations-plan/aztec-5.0.0-stable/lessons/phase-N.md, advance.
7. All phases ✓? Run /code-review max --fix → commit separately → codex post-impl audit → address high/critical → wrap-up report with every contentious decision + ELI5 context. Surface and stop.
```
