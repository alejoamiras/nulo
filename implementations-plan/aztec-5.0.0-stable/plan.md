# Aztec JS 5.0.0-rc.2 → 5.0.0 (stable) — bump + signing-key-root accounts + testnet redeploy

**Tier:** `mid` (rubric at Phase 0.5: novelty LOW — 4th bump on this line, and this exact rc.2→5.0.0 migration shipped in aztec-accelerator (2026-07-13) + ecosystem-tooling (2026-07-14) with detailed lessons; blast radius + irreversibility HIGH — live Sepolia broadcasts, Fee Juice movement, wallet-wide address change; precedent: the rc.2 bump here and the accelerator stable bump both ran `mid`). **Audits:** codex `gpt-5.6-sol` at `model_reasoning_effort=xhigh` (its max) + fable subagent, dual + final fresh-context pass. **Branch:** `worktree-aztec-5.0.0-stable`.

**Status: DRAFT v3 — fable round 1 folded (conditional approve → all 5 conditions in); codex round 1 folded (reject → all blocking findings dispositioned below); awaiting final fresh-context codex pass.**

## Summary

Bump the `@aztec/*` line `5.0.0-rc.2` → `5.0.0` (66 pins across 8 package.json; `@aztec/viem` excluded) plus the three `@alejoamiras/*` packages (10 pins) to their published `5.0.0`, adopt upstream's **signing-key-root** account model under a **frozen, reference-vectored derivation spec** (D7/D13), absorb the PXE API churn (`updateContract` removed, `registerContract` takes a `ContractInstancePreimage`, `registerAccount` takes `AccountPrivacyKeys`, browser KV store defaults to SQLite-OPFS **ignoring `dataDirectory`** — store injection mandatory), re-root the **PrivateFPC on its canonical 5.0.0 identity** (salt `0x…01` — a salt CHANGE that ripples into the extension's salt-0 derivation), bump the backup **compat-epoch** (rc.2 full backups are cleanly rejected, not silently broken), migrate the Noir surface (toolchain + tags + `consume_l1_to_l2_message([secret])` ×2 + the last `@defi-wonderland` remnant → `alejoamiras/ecosystem-tooling`), and execute the **coupled testnet redeploy** under an explicit deployment-intent manifest + spend envelope, with the private settle canary run against the candidate BEFORE promotion. The live network HAS reset (rollupVersion `2787991301` → `1821665230`, FeeJuicePortal → `0xb4a9f8ea…`); `verify:deployments` reds the faucet build until the live world and the pins agree.

**Urgency context:** the deployed faucet targets the dead rollup — the public faucet is broken **today**. Phases 1–6 land the PR; **Phase 7 (production delivery — post-merge `dev → main` promote + stable release + live acceptance) is what actually restores the public surface** and carries its own authorization gate.

## Why this shape (context from the probes)

- **Live probe 2026-07-14:** `node_getNodeInfo` on `v5.testnet.rpc.aztec-labs.com` → `nodeVersion 5.0.0`, `rollupVersion 1821665230`, `l1ChainId 11155111`. Our pin: `TESTNET_ROLLUP_VERSION = 2787991301` (`apps/faucet/src/lib/chain-constants.ts:22`). New wallet chainId = `(11155111 ^ 1821665230) >>> 0` = **`1816023401`**. (Independently re-probed by the fable audit leg.)
- **New L1 set:** rollup `0xd73a91bd…`, registry `0xa0bfb1b4…`, inbox `0x3047dbf2…`, outbox `0x905f8000…`, **feeJuicePortal `0xb4a9f8ea…` (moved — the router-rebind failure mode)**; feeJuice `0x762c1320…` + feeAssetHandler `0x5602c39a…` **unchanged** (L1 never resets).
- **npm:** `@aztec/*@5.0.0` published 2026-07-13; `@alejoamiras/aztec-accelerator@5.0.0` 2026-07-13; `@alejoamiras/{aztec-standards,aztec-fee-payment}@5.0.0` 2026-07-14. All names already in `bunfig.toml` `minimumReleaseAgeExcludes`; the exclude comment gets re-dated and the removal follow-up re-owed.
- **Sibling lessons**: aztec-accelerator `implementations-plan/aztec-5.0.0-stable-2026-07-13/` and ecosystem-tooling PR #2. Un-changelogged catches: upstream `deriveKeys` stopped stubbing the message-signing/fallback public-key hashes (addresses shift no matter what), 5.0.0 nodes 405 a plain GET `/status` (we have no such probe — verified), the SQLite-OPFS/Vite integration fights (worker resolution, `#msgpackr` subpath imports, unhashed `sqlite3.wasm` emission — a production-only runtime failure with a green build).

## Scope

**IN:**

1. **Pins**: 66 `@aztec/*` pins → `5.0.0` (**`@aztec/viem@2.38.2` explicitly excluded** — do not bump it when sweeping); 10 `@alejoamiras/*` → `5.0.0`.
2. **Patches**: re-key the two `patches/@aztec%2Fnoir-*@5.0.0-rc.2.patch` files → `@5.0.0` + root `patchedDependencies`; verify they apply.
3. **Lockfile + supply chain (executable, not prose — codex F14)**: `rm bun.lock && bun install` (hoisted linker stays); machine-checkable allowlist diff (a script asserting every changed lock entry is `@aztec/*`, `@alejoamiras/*`, or an in-range `^` refresh — anything else listed as an explicit exception for review); `rg -c '5\.0\.0-rc\.2' bun.lock` → 0; `bun install --frozen-lockfile` green; **`npm audit signatures`** over the workspace + **`dist.attestations` fetch for the three `@alejoamiras` lines** (pass = attestations present + registry signature valid), tarball shasums recorded in lessons; **Nargo tag→commit SHAs recorded** (`git ls-remote` for both repos at bump time) in lessons.
4. **Signing-key-root account model under a FROZEN derivation spec** (user decision + fable F1 + codex F8; ledger D7/D13):
   - Spec (versioned, in `packages/aztec-runtime` next to the helper): `accountSeed = poseidon2Hash([master, chainId, type, index])` (unchanged) → **`signingKey = sha512ToGrumpkinScalar([accountSeed, <IVSK_M domain separator>])`** — byte-identical to the removed upstream `deriveSigningKey` (V7a header, `key-vectors.test.ts:161-169`) → `secretKey = await deriveSecretKeyFromSigningKey(signingKey)` → `deriveKeys(secretKey)` → instance at `salt Fr.ZERO` → address. ONE exported runtime helper; every consumer (extension, scripts, e2e fixture) imports it.
   - **Known-answer vectors generated from the rc.2-installed upstream implementation BEFORE the bump** (codex F8's independence requirement, satisfied without hand-rolled reference code: upstream's own rc.2 `deriveSigningKey` IS the reference — the construction is unchanged): ≥2 seed→signingKey vectors (today's V7a value `0x14a31cb4…` for seed `0x…42` + one fresh seed) + 1 signingKey→secretKey vector + 1 full seed→address vector, captured in Phase 1 step 0 while rc.2 is still installed. The 5.0.0 helper must reproduce them; **regenerating these fixtures from the implementation under test is forbidden** (the address vector may shift ONLY for upstream-attributable reasons — the `deriveKeys` stub removal — and the shift must be explained in lessons, not blindly re-pinned).
   - The `GrumpkinScalar.fromBufferReduce` fallback is **struck** (modulo bias + improvised domain tag). If the IVSK_M separator is unavailable/renamed in 5.0.0: STOP and re-gate — never improvise a domain tag.
   - Passkey + password layers untouched (terminate at the master secret — verified). Addresses change (upstream stub removal + inversion) — accepted, pre-production + network reset.
5. **PXE seam churn** (fable F2/F5 + codex 1/6, verified against published 5.0.0):
   - `updateContract` removed end-to-end (zero external callers — verified).
   - **Preimage/instance split**: upstream `PXE.registerContract(instance: ContractInstancePreimage): Promise<AztecAddress>`; `ContractInstanceWithAddress` RETAINS `currentContractClassId` — the ~28 production reads across 11 files mostly keep compiling; Phase 1's typecheck inventory enumerates the truly broken sites. **No mass-migration to `originalContractClassId`** (semantic downgrade). Where a class-identity decision survives at a seam (artifact/selector resolution), route it through ONE helper that resolves the effective class and **fails explicitly on original≠current divergence** (this wallet doesn't support upgraded contracts — detect, don't pretend; codex 6).
   - **`registerAccount` reshape**: upstream takes `(keys: AccountPrivacyKeys, partialAddress)`. Wire-shape: OUR seam keeps carrying `secretKey` (Fr); the offscreen side derives the struct via `deriveKeys` — **no signing-key material is ever a seam argument**, pinned by a unit test (fable F7): the values reaching `pxe.registerAccount` equal the derived privacy keys and are provably not the seed nor the signing key.
   - Keep OUR `{instance, artifact?}` RPC shape, adapting internally; zod pins re-verified.
6. **Browser KV store (SQLite-OPFS) — store injection mandatory** (fable F3 + codex 5, verified in the published kv-store): the default path shares ONE hardcoded-name store (wipes on rollup switch, exclusive SAH lock, `dataDirectory` ignored). Work: `ProductionPxeFactory` constructs + injects per-(profileId, chainId) stores (`AztecSQLiteOPFSStore.open(log, <nulo-owned name>, false, poolDirectory = chainDataDir(network))`) via `createPXE`'s `options.store`; `ChainRuntime` owns the handle with **fail-closed `close()`/`delete()`**; an **independently enumerable store registry** (derivable from OPFS directory listing keyed by our naming scheme) for orphan cleanup and purge-without-live-runtime; purge cascade rework (`store.delete()` + OPFS dir removal replacing the IndexedDB-name deletions at `pxe/service.ts:458,509`, `client.ts:198`); Vite plumbing for `@aztec/sqlite3mc-wasm` (wasm emit, worker handling, exact-basename matching; `web_accessible_resources` untouched); **at-rest encryption explicitly DEFERRED** (D9 — the injection seam is where the key plugs in later).
7. **PrivateFPC canonical re-root** (codex 3 — VERIFIED: the extension derives it at `salt: Fr.zero()`, `fpc/service.ts:100-104`, while canonical 5.0.0 is salt `0x…01`): sweep EVERY PrivateFPC salt/address embed onto the canonical identity — extension `fpc/service.ts` (protocol-address derivation), `bridge-core` (`private-fuel.ts` pin, `private-fpc-artifact.ts`, deploy/smoke/fuel scripts), e2e fixtures. Each package pins a **canonical descriptor** (address, salt, deployer, aztecVersion, artifact digest) **machine-asserted by a derivation test against the installed artifact** (single-sourced by test, not by import — bridge-core is not an extension dependency). **Harden `check-fpc-version.ts`**: exact full-version match (no prerelease-stripping — VERIFIED false-green today), artifact-digest reconciliation against the descriptor, live `node.getContract(address)` class check distinguishing RPC failure from absence. SponsoredFPC stays salt 0 (its canonical; the accelerator's funded instance `0x0628377e…3fe1` — cross-checked, mismatch = stop).
8. **Backup compat-epoch bump** (codex 9 — the designed mechanism for exactly this): `COMPAT_EPOCH` +1 in `backup-migration-registry.ts` so rc.2-era **full backups are cleanly rejected at import** (the "only hard version reject" per its own doc) instead of restoring stale addresses that explode later (`account/service.ts:248` restores without re-deriving — verified path); unit test with an old-epoch backup fixture.
9. **Noir surface**: `compile.sh` toolchain → `5.0.0`; the 5 aztec-nr/portal-lib tags → `v5.0.0`; **the `token` dep → `git = "https://github.com/alejoamiras/ecosystem-tooling", tag = "v5.0.0", directory = "packages/aztec-standards/src/token_contract"`** (the LAST live `@defi-wonderland` reference); `consume_l1_to_l2_message(content, [secret], …)` at **both** call sites (`token_bridge/src/main.nr:98,115`); recompile ×3 + path-scrub + commit; portal-fork pins reviewed/regenerated.
10. **Shift inventory + coupled testnet redeploy (Branch B)** under codex-10/7 discipline: a **deployment-intent manifest** written and reviewed BEFORE any signing (target node identity from the RPC probe CROSS-CHECKED against a second source — the L1 Registry/Rollup read via `SEPOLIA_RPC_URL` with `cast`; rollupVersion, all planned addresses, signer allowlist = the standing deployer addresses, every seed flag + amount EXPLICIT, hard exposure ceiling); **dry-run-first on EVERY forge invocation**; candidate-first L2 with the **candidate SHA-256 recorded at write** and re-verified at every canary + at promotion; **the private-FPC settle canary runs against the CANDIDATE (`fuel-testnet.ts --config <candidate> PRIVATE_RUNS=1` — `--config` support verified) BEFORE promotion**; Etherscan `verify-l1` treated as supplementary (its "already verified = success" is not semantic proof — codex 10); the five live canaries; chainId cascade (4 sites); L1 constants re-pin.
11. **Delivery + docs** (Phase 6) and **production delivery** (Phase 7 — post-merge promote + stable release + live acceptance; separately authorized).

**OUT:**
- The min-age-exclude **removal** (follow-up PR after ~2026-07-21).
- Marketplace/npm publishing; anything mainnet-shaped; Cloudflare dashboard config (user-owned).
- A data-preserving storage **migration** for the address change: pre-production rule (CLAUDE.md) — devs reinstall; stale `nulo:core:accounts` rows throw the address-consistency assert on old installs; the launch baseline is redefined. (The backup-import edge IS handled — via the compat-epoch reject, Scope #8, not a migration.)
- PXE-store at-rest encryption (D9 — deferred, follow-up filed; the D3 injection seam is the future hook).
- The Footer.vue "Wonderland aztec-standards" credit link stays (authorship credit — rc.2 precedent). Gate-flagged.
- An **emergency faucet-only deploy lane** ahead of the PR (codex 15): possible as a separately-authorized exact-SHA arc, but rejected by default — the corrected main outline + a same-day Phase 7 is simpler and this repo's release pipeline is now near-one-click. Gate-flagged (D14).
- Firefox **runtime** OPFS validation beyond a boot check: gate-flagged (codex 12) with the default = build-only gate as today + the offscreen boot check in Phase 3 IF trivially drivable; full Firefox e2e stays out.

## Main plan

### Phase 1 — Reference vectors + mechanical bump + install + break inventory

0. **BEFORE touching pins (rc.2 still installed): generate the D13 known-answer vectors** from the installed upstream `deriveSigningKey`/`deriveKeys` (≥2 seed→signingKey incl. the existing V7a pair, 1 signingKey→secretKey via a scratch 5.0.0 install in the scratchpad, 1 full seed→address under rc.2 for the lessons record) — committed to the vector fixture + lessons. These are the reference the 5.0.0 implementation must hit (Scope #4).
1. `bunfig.toml`: re-date the excludes comment; post-install, re-enumerate the `@aztec/*` transitive set from the new lock and reconcile.
2. Re-key the two patches + `patchedDependencies`.
3. Bump the 66 + 10 pins (`@aztec/viem` untouched).
4. `rm bun.lock && bun install`; the machine-checkable allowlist diff (Scope #3); zero-rc.2 grep; frozen-lockfile re-install; `npm audit signatures` + attestation checks; shasums + Nargo `git ls-remote` SHAs to lessons.
5. `bun run typecheck:all` — **expected RED**; full break inventory to `lessons/phase-1.md` (settles which of the ~28 `currentContractClassId` reads actually break).

**Validation gate** — Commands: the D13 vector capture (fixtures committed) · `bun install` · the allowlist-diff script (exit 0, exceptions empty or reviewed) · zero-rc.2 grep · frozen-lockfile re-install · `npm audit signatures` (0 invalid) + attestation presence for the `@alejoamiras` three · inventory in lessons. Pass: all of the above. Layers: reference-vectors · install · lockfile · supply-chain · inventory. (Typecheck green is Phase 2's gate.)

### Phase 2 — API migration: signing-key-root + PXE seam + FPC canonical + TS churn

1. **Account inversion** (`nulo-account.ts` + `account/service.ts`): implement the frozen D7 spec via the ONE exported helper; the D13 vectors must pass unmodified. IVSK_M unavailable/renamed → STOP + re-gate.
2. **`registerAccount`/`AccountPrivacyKeys` seam reshape** + the registration-hygiene unit pin (derived privacy keys only — never seed, never signing key).
3. **Key vectors**: V7a's replacement pair = the D13 fixtures (values pre-captured, not regenerated); V1/V2/V3/V6/V8/V9/P1 must NOT move (**V3 is Aztec-stack-sensitive** — its drift is a STOP signal, fable F8).
4. **Scripts + e2e fixture** (semantic migration — `createSchnorrAccount(secret, salt, signingKey)` signature is UNCHANGED, codex 2): each of the 9 sites gets the explicit two-step through the exported helper; **remove the fixture's `as any`** (verified at `aztec.ts:387`) so argument order is compiler-checked; enforcement points migrated same-phase (fixture parity throw + nulo-account unit parity test against `getSchnorrAccountContractAddress(signingKey, salt, secret)`).
5. **PXE seam registerContract**: preimage/instance split; `updateContract` removed; the effective-class helper with explicit divergence failure (Scope #5); zod pins re-verified.
6. **PrivateFPC canonical re-root** (Scope #7): the salt sweep (extension `fpc/service.ts` + bridge-core + fixtures), the per-package canonical descriptors + derivation tests, the hardened `check-fpc-version.ts` (exact version + digest + live class), the conscious tripwire re-pin (`private-fuel.test.ts` fires here — fable F4; both cross-checks run now; live re-canary owed by Phase 5). Audit `fuel.test.ts` for the same coupling. Never silence.
7. **Backup compat-epoch bump** (Scope #8) + old-epoch reject test.
8. Sweep the rest of the Phase-1 inventory until green.

**Validation gate** — Commands: `bun run typecheck:all` · `bun run test:all` · `bun run lint` · the 5 builds. Pass: all exit 0 (units include: D13 vectors unmodified, registration-hygiene pin, parity tests, canonical-descriptor derivation tests, the epoch-reject test, the consciously re-pinned tripwire, schema-patch guards, dispatcher reachability). NOTE: the extension builds are compile-level proof only — the OPFS runtime proof is Phase 3's (codex 13; the sibling's failure mode was production-runtime with a green build). Layers: typecheck · unit · lint · build. **Fast-fail:** non-mechanical break → stop, codex triage, re-plan.

### Phase 3 — Offscreen PXE storage backend (SQLite-OPFS, store-injected)

1. **Per-(profile, chain) store injection** (Scope #6 — mandatory; never ship the upstream default path): Nulo-owned DB + pool names, `ChainRuntime` owns the handle, fail-closed close/delete, the enumerable store registry.
2. **Purge cascade rework**: `store.delete()` + registry-driven OPFS removal replacing the IndexedDB-name deletions; must work with NO live runtime for that (profile, chain); update the `chain-coordinates.ts` PERSISTED-comment.
3. **Vite plumbing** for `@aztec/sqlite3mc-wasm` (+ the accelerator's dev-server lessons if the dev flow needs them); `web_accessible_resources` untouched.
4. **Empirical spike as a COMMITTED script** (codex 13 — not an ad-hoc check; landed under the e2e helpers so it's re-runnable): drives the PRODUCTION-built extension (loaded unpacked) through: offscreen PXE boots on OPFS → **the `sqlite3.wasm` asset resolves with correct MIME under MV3 CSP** (the sibling's production-only failure) → create account → restart → persists → **two profiles × two chains concurrently open** (no SAH-lock contention) → **targeted chain purge + full profile purge: A removed, B intact (negative control)** → **purge with no live runtime removes the store via the registry** → **zero residual IndexedDB AND OPFS artifacts after profile erase**.

**Validation gate** — Commands: `bun run test:e2e` (smoke) · the committed spike script against the production build (all checks above; OPFS layout recorded in lessons) · `typecheck:all` + touched units + `lint`. Pass: smoke green; ALL spike checks pass. Layers: smoke-e2e · runtime-empirical (production build) · typecheck/unit/lint. **Fast-fail:** OPFS unavailable in the offscreen document → fall back to the deprecated IndexedDB entrypoint through the SAME injection seam, log; neither → stop + surface.

### Phase 4 — Noir surface + shift inventory

1. `aztec-up install 5.0.0`; `compile.sh` → `5.0.0`.
2. Nargo tags → `v5.0.0` ×5; the `token` dep → ecosystem-tooling `v5.0.0` (recording resolved commit SHAs — Phase 1 captured them).
3. `token_bridge/src/main.nr`: wrap the secret at **both** sites (:98, :115).
4. Recompile ×3 + transpile + path-scrub + commit (raw `aztec-nargo` fallback for masked errors; mixed-set errors → check the `token` dep tag first).
5. **Portal-fork pins**: diff → regenerate `NuloTokenPortal.build.json` → update `FORKED_PORTAL_KECCAK`/`PORTAL_PIN` if shifted.
6. **Shift inventory**: `verify:deployments` (expected RED — note it re-derives COMMITTED pins, it does not query the live network; codex 13), bridge/proxy re-derive, **re-verify the Phase-2 canonical FPC pin against the freshly compiled artifacts**, SponsoredFPC salt-0 re-derivation (expected == `0x0628377e…3fe1`). Inventory → `lessons/phase-4.md`.

**Validation gate** — Commands: the 3 compiles + transpile · shift-inventory scripts · `test:all` · `lint` · builds. Pass: artifacts committed, inventory complete, everything green except `verify:deployments` (red until Phase 5 promotes). Layers: contract-compile · derivation-inventory · unit · lint · build.

### Phase 5 — Coupled testnet redeploy (live; authorized at Phase 0, executed under the intent manifest)

**Pre-flight — the deployment-intent manifest** (fail-closed, BEFORE any signing; codex 7/10): written to lessons and reviewed in-transcript — (a) node identity re-probed via RPC AND cross-checked against the Sepolia L1 Registry/Rollup on-chain state via `cast` + `SEPOLIA_RPC_URL` (two independent sources for the addresses the deploy will trust; divergence = STOP); (b) rollupVersion `1821665230` re-confirmed (a THIRD reset = STOP + re-gate); (c) signer allowlist = the standing deployer addresses from the env files (never created/rotated/printed; envs sourced inside the command's own shell; surface if missing); (d) **every seed flag and amount EXPLICIT** (no `DeployFuelLive` defaults — both SEED flags default TRUE upstream, codex 10), with the planned total exposure stated and bounded (rc.2 precedent: ~0.1 ETH L1 gas + pool seed + the FJ canary amounts); (e) the planned address set (new FeeJuicePortal `0xb4a9f8ea…` etc.).

1. **ChainId cascade** (4 sites): `TESTNET_ROLLUP_VERSION` → `1821665230` / chainId `1816023401`.
2. **L1 constants**: FeeJuicePortal + friends in `DeployBridge.s.sol`, `DeployFuelLive.s.sol` (+ AZLO default), `.env.example`, both fork tests.
3. **L1 fuel**: `DeployFuelLive` `SEED_AZLO_WETH=false SEED_ETH_FJ=false` — dry-run, review against the intent manifest, then `--broadcast --slow`.
4. **L2 bridge — candidate-first**: `deploy-bridge-testnet.ts` (+ faucet deploy in parallel); **record the candidate's SHA-256 at write** — every subsequent canary and the promotion re-verify it (codex 10).
5. **PrivateFPC**: the hardened `check-fpc-version.ts` gate (exact version + digest + live class; red ⇒ STOP) → `deploy-private-fpc-testnet.ts` at canonical salt `0x…01` (asserted address `0x257aa870…efc86e9`).
6. **SponsoredFPC**: expect the accelerator's funded `0x0628377e…3fe1`; mismatch = stop-and-investigate, never deploy-over.
7. **Pool seed for the fresh AZLO**: `DeployFuelLive` re-run with `TOKEN_ADDRESS=<new>` + reuse flags + `SEED_AZLO_WETH=true SEED_ETH_FJ=false` — **dry-run first here too** (real liquidity).
8. **Candidate proofs — ALL against the candidate, BEFORE promotion** (codex 3): `verify-l1 --config` (supplementary — Etherscan "already verified" is not semantic proof) · `smoke-existing-testnet --config` · `smoke-swap-existing-testnet --config` (fueled) · **`fuel-testnet.ts --config <candidate> PRIVATE_RUNS=1` — the private settle canary runs HERE, pre-promotion** (`--config` support verified; its one-sample `minFuelFj` may RAISE the floor, never lower).
9. **Promote**: verify the candidate digest is unchanged since step 4 → copy candidate → `testnet-bridge.json` → re-pin consumers (`deployments.json`/`deployments.ts`, `bridge-deployments.ts`, `sponsored-fpc.ts`) atomically in one commit.
10. **Post-promotion canaries**: `verify:deployments` GREEN on the new pins · a drip · post-flight deployer balance check against the intent manifest's exposure ceiling.
11. **Client-side + CSP**: `_headers` connect-src (expect no-op); PXE schema-wipe + reinstall note in lessons.

**Validation gate** — Commands: the candidate proofs (step 8) + promotion digest check + post-promotion canaries (step 10). Pass: all green against the LIVE 5.0.0 testnet; spend within the stated envelope. Layers: live-deploy · derivation · live-canary. **Live-deploy discipline:** fix forward, never blind-retry; partial L1 fuel ⇒ reuse flags; partial L2 ⇒ script hard-stops, fix forward; **never promote over a partial landing or a changed digest**; a few failures on one live step ⇒ stop + surface (5-failure hard stop in autonomous mode).

### Phase 6 — Delivery: PR + native-proving network-e2e + docs

1. PR to `dev` labeled **`e2e:network` + `e2e:smoke`**. Accelerator-server binary stays `v1.0.6` (bb SDK-version-injected; fallback only on a proving-specific failure).
2. Stale-ref sweep (live `5.0.0-rc.2` mentions; historical plan/lesson mentions stay).
3. Docs in the same PR: `UPDATE.md` coupling appendix (D7 derivation seam, `AccountPrivacyKeys` seam, OPFS store-injection + purge coupling, the canonical-FPC descriptor); `aztec-update` skill (canonical FPC salt policy, ecosystem-tooling as the standards source, OPFS store-injection, the double-reset probe lesson, the check-fpc-version hardening); `implementations-plan/index.md`.
4. **File the follow-ups**: min-age-exclude removal (~2026-07-21); PXE-store encryption (D9); full `minFuelFj` calibration if suggested; the upgraded-contract divergence epic if the effective-class helper ever fires.
5. Check `mergeable` before reading CI silence as failure.

**Validation gate** — Commands: `quality-status` + `smoke-e2e-status` + `network-e2e-status` green on the PR head (native proving; silent WASM fallback = hard fail). Pass: all three green; no stale live rc.2 refs; follow-ups filed. Layers: quality · smoke-e2e · network-e2e-live.

### Phase 7 — Production delivery (post-merge; separately authorized — codex 11)

The public faucet is restored ONLY here: after the PR merges to `dev`, run the release runbook (CLAUDE.md § Release): promote `dev → main` → merge the Release PR (auto-unstick is ON) → publish chain → **live acceptance**: `faucet.nulo.sh` `nulo-build` meta == `/build.json` buildId on the NEW build, wallet chainId `1816023401` served, and **a drip through the actual public site**. This phase carries its own authorization (release-runbook territory: merging to `main` + a public deploy) — it is IN the plan so the outage-recovery claim is honest, and GATED on the user's explicit go at that moment (the Phase-0 live-deploy authorization covers testnet broadcasts, NOT the release).

**Validation gate** — Commands: release-runbook steps green (`gh release view` assets; `verify-live` advisory) · public-site build-id reconciliation · a public drip. Pass: the deployed faucet serves the new chain and drips. Layers: release · live-acceptance.

### Post-implementation

`/code-review max --fix` (separate commits) → codex post-impl audit (`gpt-5.6-sol` xhigh; net diff + code-review-commit summary + plan + adversarial ask) → fix loop. **Hardening (codex 4/12, gate question):** default = the post-impl audits above, PLUS an offered **scoped `/harden security`-style targeted pass over exactly the new trust surface** (the D7 KDF helper, the OPFS store ownership/deletion, the deploy-intent tooling) — user decides at the gate; a full repo-wide `/harden` is NOT scheduled (recent June/July arcs cover the rest).

## Competing outline — "live-first" (restore the public faucet before the client work)

Reorder: Phase 1 → Phase 4 → Phase 5 → Phases 2–3 → Phase 6. Rationale: the faucet is broken today; live-first shortens the outage and de-risks irreversible work early.

**Why the main plan rejects it:** the redeploy scripts sit ON the broken APIs (`deriveSigningKey` removed, `createSchnorrAccount` semantics inverted — fable verified the imports), and `verify:deployments`/the faucet build can't green while the faucet's TS doesn't compile; the minimum viable live-first converges with the main order minus extension work — a mid-arc mixed state for no net time saved. The outage argument cuts against BOTH orderings equally: recovery is merge + Phase 7, not internal phase order. Codex added the honest refinement (folded): "zero net time saved" isn't strictly established — a **separately-authorized emergency faucet-only lane** could exist; rejected by default (D14) since Phase 7 on the near-one-click release pipeline is comparable effort without a second delivery path to secure. (Both auditors concurred with rejecting the raw live-first ordering.)

## Security & Adversarial Considerations

- **Threat model**: supply chain (0–1-day-old packages), live-deploy credential + spend handling, a compromised/stale RPC steering deploy targets (codex 7), FPC-identity confusion across a salt-policy change (codex 3), storage isolation across profiles (fable F3), backup-import of stale account generations (codex 9), the PXE trust boundary (improved by this plan).
- **Supply chain (executable)**: exact pins; `npm audit signatures` + attestation checks as Phase 1 gate commands; machine-checkable lock-diff allowlist with explicit exceptions (no blanket "Aztec-scoped" waves); shasums + Nargo tag→commit SHAs recorded; min-age exclude removal re-owed. First-party trust roots: accelerator (OIDC trusted publisher), ecosystem-tooling (rehearse-then-release byte-compare + provenance).
- **RPC trust**: the deployment-intent manifest cross-checks the node's claimed L1 addresses against direct Sepolia on-chain reads (two independent sources) before anything signs; re-validation immediately before each irreversible step; a mid-arc rollupVersion change is a STOP.
- **Spend envelope**: signer allowlist, explicit flags/amounts on every live invocation (no script defaults — `DeployFuelLive` seeds default TRUE upstream), stated exposure ceiling, post-flight balance reconciliation.
- **The FPC unrecoverable-deposit window**: canonical descriptor (address+salt+deployer+version+**artifact digest**) pinned per package and machine-asserted against the installed artifact (our OWN derivation is the second trust root, independent of the publisher's JSON+npm single root — codex 3); `check-fpc-version.ts` hardened to exact-version + digest + live-class with RPC-error≠absence; the private settle canary runs against the CANDIDATE before any promotion; red gate ⇒ stop.
- **Cryptography**: the D7 construction frozen in-plan (`sha512ToGrumpkinScalar([seed, IVSK_M])` — upstream's removed derivation verbatim, upstream primitives only, fromBufferReduce struck); D13 known-answer vectors generated from the rc.2 UPSTREAM implementation before the bump (independent reference; regeneration from the implementation-under-test forbidden); ONE exported helper (no parallel implementations to drift); stop-set vectors (V1/V2/**V3 — Aztec-sensitive**/V6/V8/V9/P1) must not move.
- **PXE trust boundary**: signing-key-never-crosses-the-seam pinned by unit test; PXE receives only derived privacy keys (`AccountPrivacyKeys`).
- **Storage isolation (OPFS)**: per-(profile,chain) injected stores; fail-closed delete; enumerable registry (no orphan stores after profile erase); the Phase-3 committed spike proves isolation, purge-without-runtime, and negative-control survival on the PRODUCTION build (green-build/broken-runtime is the sibling-proven failure mode).
- **Backup surface**: compat-epoch bump makes stale-generation full backups a clean reject (the designed hard gate), closing the restore-then-explode path; backup blobs remain hostile input (unchanged posture).
- **Input validation**: zod seam pins re-verified against 5.0.0; network e2e is the runtime detector.
- **CI/e2e**: no gate weakening — `verify:deployments` stays red until the world agrees; the tripwire is consciously re-pinned with dual cross-checks, never silenced; native-proving required mode stays on.

## Assumptions

**Facts** (verified this session; several independently re-verified by the fable leg against published 5.0.0 tarballs, and four codex claims re-verified by me against the repo):
1. Live testnet: rollupVersion `1821665230`, nodeVersion `5.0.0`, FeeJuicePortal `0xb4a9f8ea…`, feeJuice/feeAssetHandler unchanged (probe 2026-07-14, re-probed). Our pin `2787991301` ⇒ NETWORK RESET.
2. All four package lines have published `5.0.0` (npm 2026-07-13/14); all names already min-age-excluded.
3. Published-5.0.0 API surface: `deriveSecretKeyFromSigningKey` at `@aztec/accounts/utils`; `getSchnorrAccountContractAddress(signingKey, salt, secretKey?)`; `sha512ToGrumpkinScalar` in foundation; `createSchnorrAccount(secret, salt, signingKey, alias?)` signature UNCHANGED (semantic migration); `PXE.registerContract(ContractInstancePreimage) → Promise<AztecAddress>`; `ContractInstanceWithAddress` RETAINS `currentContractClassId`; `PXE.registerAccount(AccountPrivacyKeys, partialAddress)`; kv-store default `createStore` ignores `dataDirectory`, wipes on rollup change, exclusive SAH lock; escape hatch `createPXE options.store` + `AztecSQLiteOPFSStore.open(log, name, false, poolDirectory, encryptionKey?)` + `store.delete()`; deprecated IndexedDB entrypoint exists.
4. Pin surface: **66** `@aztec` pins (+ `@aztec/viem`, excluded) + 10 `@alejoamiras` across 8 package.json; patches keyed `@5.0.0-rc.2`; `compile.sh:13` at rc.2; Nargo `v5.0.0-rc.2` ×5 + `token` at `defi-wonderland#prerelease-568f58f`.
5. Derivation chain mapped: inversion point `nulo-account.ts:54-68,189`; seed from `account/service.ts:205-211`; passkey/password layers terminate at the master secret; account rows keyed by address with throw-on-mismatch (`service.ts:199-201`); `BASELINE_VERSION = 1`, zero real migrations; `deriveSigningKey` ≡ `sha512ToGrumpkinScalar([secret, IVSK_M])` (V7a header).
6. ~28 production reads of `instance.currentContractClassId` across 11 files (fable count, codex concurred).
7. The extension offscreen PXE is the only browser PXE; purge cascade deletes by IndexedDB name; vite config has zero sqlite3mc handling.
8. **PrivateFPC identity surfaces (codex 3, re-verified by me):** the extension derives it at `salt Fr.zero(), deployer ZERO` (`fpc/service.ts:100-104`); `check-fpc-version.ts:37` strips the prerelease (`"5.0.0-rc.2"→"5.0.0"`) — false-green across rc↔stable; canonical 5.0.0 = `0x257aa870…efc86e9` at salt `0x…01` (`canonical-deployment.json`, ecosystem-tooling v5.0.0 tag). The e2e fixture calls `createSchnorrAccount` through `as any` (`aztec.ts:387`).
9. **Backup epoch mechanism (codex 9, re-verified):** `COMPAT_EPOCH_FIELD` = "account-contract generation. NON-migratable — the only hard version reject" (`backup-migration-registry.ts`); account restore writes the stored address without re-deriving.
10. ecosystem-tooling `v5.0.0`: public, `packages/aztec-standards/src/token_contract/Nargo.toml` (deps pinned `v5.0.0`; `generic_proxy` path dep OK). Upstream `v5.0.0` tag exists. Accelerator-server `v1.0.6` SHA-pinned; bb SDK-version-injected. `fuel-testnet.ts` supports `--config` (verified — enables the pre-promotion candidate settle).

**Inferences** (unverified — attack these):
1. OPFS (incl. SAH workers) is available in the Chrome MV3 offscreen document — Phase 3 spike verifies; fallback = deprecated IndexedDB through the same injection seam.
2. The two Bun patches apply unchanged (exports-map-only; rc.1→rc.2 held) — Phase 1 verifies.
3. v1.0.6 accelerator-server + SDK-injected bb 5.0.0 proves our network e2e — Phase 6 re-proves.
4. Our salt-0 SponsoredFPC derivation equals the accelerator's funded `0x0628377e…3fe1` — requires same artifact+salt+deployer+keys, not just same rollup (codex 7); mismatch = stop-and-investigate.
5. aztec-nr `v5.0.0` + ecosystem-tooling standards `v5.0.0` are tag-compatible — the compile verifies; mixed-set errors point at the `token` tag first.
6. **The Noir break surface is limited to `consume_l1_to_l2_message` ×2** — grep-based, DEMOTED from Fact (codex 4); only the Phase-4 compile of the exact resolved dep set proves it.
7. No third network reset mid-arc — re-probed at Phase 5 pre-flight immediately before signing; movement = STOP.
8. Sibling-repo lessons accurate as folded (two specific claims independently confirmed upstream).
9. The IVSK_M separator (or its 5.0.0 name) is importable — else Phase 2.1 STOPs (D7; never improvise).

**Asks** — Phase-0 resolved: coupled redeploy (user); full testnet-broadcast authorization (user; **does NOT cover Phase 7's release** — separately gated); signing-key-root adoption (user); tier mid + codex xhigh (user). **At the approval gate (explicit, with defaults):**
1. **D7/D13 construction** — default: upstream's removed derivation verbatim + rc.2-generated reference vectors. (Permanent consensus-critical constant.)
2. **OPFS backend policy + Firefox runtime stance** (codex 12) — default: Chrome-proven store injection; Firefox stays build-gated (+ boot check if trivially drivable); full Firefox e2e out.
3. **Scoped hardening pass post-impl** (codex 4/12) — default: offered targeted pass over the KDF helper + OPFS deletion + deploy-intent tooling; full /harden NOT scheduled.
4. **Phase 7 release authorization** — acknowledged now as a named phase, GO given post-merge (release-runbook territory).
5. **Emergency faucet-only lane** (D14) — default: NOT taken.
6. Footer.vue Wonderland credit stays; PXE-store encryption deferred (D9).

## Decision ledger

| # | Decision | Chosen | Rejected alternative(s) | Why |
|---|---|---|---|---|
| D1 | Account key model | Upstream signing-key-root (user) | Vendor the removed `deriveSigningKey`, keep secret-root | Upstream alignment + PXE-can't-reconstruct-ownership-key; addresses shift either way |
| D2 | Phase order | Cheap-fail-first | "Live-first" competing outline | Redeploy tooling sits on the broken APIs (fable-verified); outage recovery is Phase 7, not ordering |
| D3 | Browser store | SQLite-OPFS via explicit `options.store` injection, per-(profile,chain) pools | Upstream default path (broken for us — shared store, wipe-on-switch, exclusive lock); deprecated IndexedDB (fallback only) | Isolation + the future encryption hook (fable F3, codex 5) |
| D4 | PrivateFPC pin | Canonical salt `0x…01` / `0x257aa870…`, re-rooted at Phase 2 with digest+live-class gates | Operator-local-salt lineage; a Phase-4 re-pin (too late — tripwire fires at Phase 2, fable F4) | Canonical is the package's 5.0.0-onward contract; the extension's salt-0 derivation HAD to move anyway (codex 3) |
| D5 | Wonderland close-out | Nargo `token` → ecosystem-tooling `v5.0.0`; Footer credit stays | Fork-tag (no v5.0.0 tag exists); de-crediting | ecosystem-tooling is the published source of truth |
| D6 | Address-change handling | Pre-production reset + **compat-epoch bump for full backups** | A real storage migration; leaving the epoch (silently-broken restores — codex 9) | CLAUDE.md pre-production rule; the epoch reject is the designed mechanism |
| D7 | seed→signingKey construction | `sha512ToGrumpkinScalar([accountSeed, IVSK_M])` — upstream's removed body verbatim | `fromBufferReduce` over a hash (STRUCK — bias + improvised tag); a fresh Nulo separator (breaks continuity for no gain) | Upstream primitives + domain separation; byte-identical signing keys vs rc.2 (fable F1, codex 8) |
| D8 | OPFS purge semantics | `store.delete()` + registry-driven removal, fail-closed, works without live runtime | Directory-only removal (purges nothing); keeping IndexedDB deletions (silent no-op) | Purge correctness is a security property; gate-proven with negative controls |
| D9 | PXE-store at-rest encryption | DEFER (parity with today); follow-up filed | `openEncryptedStore` now | Bounded blast radius; D3's seam is the future hook |
| D10 | FPC identity source of truth | Per-package canonical descriptor (address+salt+deployer+version+digest), machine-asserted vs the installed artifact; hardened exact-version+digest+live-class gate | Trusting the publisher's JSON+npm alone (single trust root); the major-only version gate (false-green — verified) | Our own derivation is the independent second root (codex 3) |
| D11 | Live-deploy discipline | Deployment-intent manifest (dual-source address verification, signer allowlist, explicit flags/amounts, exposure ceiling) + candidate-digest-bound promotion + pre-promotion private settle | "Authorized = go" with script defaults; post-promotion-only settle canary (the loss window — codex 3/10); single-RPC trust (codex 7) | Live testnet funds + irreversibility warrant the ceremony; all tooling supports it (`--config` verified) |
| D12 | rc.2 full backups | Clean reject via compat-epoch bump + test | Silent import (broken accounts at load); a restore-transform migration | The designed hard gate; pre-production |
| D13 | Derivation reference vectors | Generated from the rc.2-installed UPSTREAM implementation BEFORE the bump; regeneration from the implementation-under-test forbidden | Vectors regenerated by the new code (tautological — codex 8) | True independence without hand-rolled reference crypto |
| D14 | Emergency faucet-only deploy lane | NOT taken (default); Phase 7 on the near-one-click release pipeline instead | A separately-authorized exact-SHA faucet-only arc pre-merge (codex 15) | Comparable latency, one fewer delivery path to secure; user can override at the gate |

## Audit verdicts

- **Fable round 1 (2026-07-14, `audit-fable.md`):** `conditional approve` — 5 conditions (D7 pin; preimage/instance rewrite; store injection + extended Phase-3 gate; tripwire sequencing; `registerAccount` reshape + hygiene pin). **All folded in v2**; findings 8–15 also folded.
- **Codex round 1 (2026-07-14, `audit-codex.md`):** `reject` (blocking: 1, 3, 5–11, 13, 14). **All folded in v3**: 1/6 → Scope #5 effective-class helper + inventory-by-typecheck; 2 → Phase 2.4 semantic two-step + `as any` removal; 3 → Scope #7/D10/D11 (canonical descriptors, salt sweep, hardened gate, pre-promotion settle — all four sub-claims re-verified against the repo); 4 → Fact-10 demotion + scoped-hardening gate question; 5 → Scope #6 registry/fail-closed/2×2 spike; 7 → the intent manifest's dual-source verification; 8 → D13 reference vectors; 9 → Scope #8/D12 compat-epoch; 10 → the spend envelope + digest-bound promotion; 11 → Phase 7; 12 → the explicit gate-question list; 13 → committed spike script + production-build proof + gate-note on builds; 14 → executable supply-chain gate; 15 → D14.
- **Final fresh-context codex pass:** _pending on this v3._

## Seeds (DRAFT — finalized after the approval gate)

### Recommended: `/goal`

```
/goal Phases 1-6 marked ✓ in implementations-plan/aztec-5.0.0-stable/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/aztec-5.0.0-stable/lessons/phase-N.md in the transcript; the pre-promotion candidate proofs (verify-l1, candidate smoke, fueled candidate smoke, fuel-testnet --config candidate PRIVATE_RUNS=1 settle) and post-promotion canaries (verify:deployments green, a drip, balance-within-envelope) all reported green; /code-review max --fix complete with findings applied and committed separately; codex post-impl audit (gpt-5.6-sol, xhigh) complete with high/critical findings addressed; `bun run test:all` and `bun run lint` both exit 0 in the transcript; the PR to dev is open with labels e2e:network + e2e:smoke and quality-status, smoke-e2e-status, network-e2e-status all green on its head; Phase 7 (post-merge release) either completed with my explicit go or surfaced as awaiting my release authorization.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/aztec-5.0.0-stable forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/aztec-5.0.0-stable/plan.md and lessons/ (authoritative state — not the chat); run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json mergeable,statusCheckRollup` (no --watch; CONFLICTING = zero CI, resolve first).
2. Waiting on CI is fine — confirm it progresses (`gh run watch <id>` up to 10 min); use the wait to review the diff or prep the next phase.
3. No task in hand? Pick the next pending step from plan.md. After each meaningful edit run the fast layers (`bun run lint` + the touched package's tests), then commit → push.
4. Stuck or facing a decision you'd bring to me? Call codex (`gpt-5.6-sol`, xhigh) with full context, reach a defensible verdict, act, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to main, never publish or release (Phase 7 needs my explicit go), never weaken a CI gate, never move Fee Juice past a red hardened check-fpc-version gate, never promote over a partial landing or a changed candidate digest, never exceed the deployment-intent spend envelope, no scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex. Live-deploy steps: stop and surface after a FEW failures — never blind-retry a broadcast.
6. Phase green = ITS VALIDATION GATE as written in plan.md passes; paste the result, mark ✓ in plan.md, write lessons, print LESSONS_FILE=implementations-plan/aztec-5.0.0-stable/lessons/phase-N.md, advance.
7. Phases 1-6 ✓? Run /code-review max --fix → commit separately → codex post-impl audit → address high/critical → wrap-up report with every contentious decision + ELI5 context → surface Phase 7 for my release go. Stop there.
```
