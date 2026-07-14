# Aztec JS 5.0.0-rc.2 → 5.0.0 (stable) — bump + signing-key-root accounts + testnet redeploy

**Tier:** `mid` (rubric at Phase 0.5: novelty LOW — 4th bump on this line, and this exact rc.2→5.0.0 migration shipped in aztec-accelerator (2026-07-13) + ecosystem-tooling (2026-07-14) with detailed lessons; blast radius + irreversibility HIGH — live Sepolia broadcasts, Fee Juice movement, wallet-wide address change; precedent: the rc.2 bump here and the accelerator stable bump both ran `mid`). **Audits:** codex `gpt-5.6-sol` at `model_reasoning_effort=xhigh` (its max) + fable subagent, dual + final fresh-context pass. **Branch:** `worktree-aztec-5.0.0-stable`.

**Status: ✅ APPROVED 2026-07-14** — the user activated the recommended `/goal` seed (implementation directive) with all gate defaults kept **plus D9 flipped: at-rest store encryption adopted in-arc**. Audit trail: fable r1 `conditional approve` (folded) → codex r1 `reject` (folded) → codex final-pass `reject` (folded, 2 reasoned rejections) → codex re-verdict **`conditional approve`, all 4 conditions folded**. Seeds below are FINAL (the active `/goal` matches verbatim). Implementation in progress.

## Summary

Bump the `@aztec/*` line `5.0.0-rc.2` → `5.0.0` (66 pins across 8 package.json; `@aztec/viem` excluded) plus the three `@alejoamiras/*` packages (10 pins), adopt upstream's **signing-key-root** account model under a **frozen derivation spec with two-regime reference vectors** (rc.2-continuity for the unchanged signingKey construction; hash-pinned published-5.0.0 tarball references for everything downstream — D7/D13), absorb the PXE API churn (`updateContract` removed, `registerContract` takes a `ContractInstancePreimage` and its returned address is asserted, `registerAccount` takes `AccountPrivacyKeys`, browser KV store defaults to SQLite-OPFS — **store injection mandatory, fail-closed, no IndexedDB fallback ships**), re-root the **PrivateFPC on its canonical 5.0.0 identity** (salt `0x…01` — a salt CHANGE that ripples into the extension's salt-0 derivation), bump the backup **compat-epoch**, migrate the Noir surface (+ the last `@defi-wonderland` remnant → `alejoamiras/ecosystem-tooling`), and execute the **coupled testnet redeploy** under a schema-validated deployment-intent artifact, an intent-enforcing live-run wrapper with a plan-pinned signer and per-asset caps, a strict candidate schema (incl. the direct Fee-Juice lane), and pre-promotion candidate proofs including the private settle canary. The live network HAS reset (rollupVersion `2787991301` → `1821665230`); `verify:deployments` reds the faucet build until the live world and the pins agree.

**Urgency context:** the deployed faucet targets the dead rollup — broken **today**. Phases 1–6 land the PR; **Phase 7 (post-merge promote + stable release + live acceptance) is what restores the public surface** and carries its own authorization gate.

## Why this shape (context from the probes)

- **Live probe 2026-07-14:** `node_getNodeInfo` on `v5.testnet.rpc.aztec-labs.com` → `nodeVersion 5.0.0`, `rollupVersion 1821665230`, `l1ChainId 11155111`. Our pin: `2787991301` (`apps/faucet/src/lib/chain-constants.ts:22`). New wallet chainId = **`1816023401`**. (Independently re-probed by the fable leg.)
- **New L1 set:** rollup `0xd73a91bd…`, registry `0xa0bfb1b4…`, inbox `0x3047dbf2…`, outbox `0x905f8000…`, **feeJuicePortal `0xb4a9f8ea…`**; feeJuice `0x762c1320…` + feeAssetHandler `0x5602c39a…` unchanged.
- **npm:** all four lines published 5.0.0 (2026-07-13/14); the rc.2-known exclude names already in `bunfig.toml`; comment re-dated, removal follow-up re-owed, and the stable lock may ADD transitive names (reconciled in Phase 1).
- **Sibling lessons**: aztec-accelerator `implementations-plan/aztec-5.0.0-stable-2026-07-13/`; ecosystem-tooling PR #2. Un-changelogged catches: `deriveKeys` stopped stubbing two public-key hashes (addresses shift regardless — independently confirmed by fable against the published tarballs); 5.0.0 nodes 405 GET `/status` (we have no such probe); the sqlite-opfs/Vite production-only runtime failure with a green build.

## Scope

**IN:**

1. **Pins**: 66 `@aztec/*` → `5.0.0` (**`@aztec/viem@2.38.2` excluded**); 10 `@alejoamiras/*` → `5.0.0`.
2. **Patches**: re-key both `patches/@aztec%2Fnoir-*` files + root `patchedDependencies`; verify they apply.
3. **Lockfile + supply chain (executable — codex F14, final-pass F5)**: `rm bun.lock && bun install` (hoisted linker stays); **machine-generated full lock diff with NO blanket acceptance** — every changed non-Aztec entry is enumerated as an explicit `(package, old→new)` exception line in lessons and individually dispositioned (in-range refresh is a *classification*, not an auto-pass); `rg -c '5\.0\.0-rc\.2' bun.lock` → 0; frozen-lockfile re-install; `npm audit signatures` + `dist.attestations` for the `@alejoamiras` three **including the provenance subject's repository + source commit** recorded and eyeballed against the expected repos; tarball shasums to lessons. **Nargo deps pinned by COMMIT**: use `rev = "<sha>"` if nargo supports it on our toolchain, else keep the tag AND assert the fetched checkout's commit SHA (from nargo's cache) equals the `git ls-remote` SHA recorded at bump time — either way the resolved SHAs are committed in lessons. *Explicit reasoned REJECTION (residual risk accepted): cross-repo reproducible-build verification of the PrivateFPC artifact against its source commit — ecosystem-tooling is first-party and its own audited release pipeline already byte-compares rehearsal vs release; duplicating that here buys little for a testnet arc. The descriptor's digest+derivation checks give internal consistency (artifact↔address↔salt), NOT an independent trust root — the trust root is the first-party pipeline, stated honestly (D10 reworded).*
4. **Signing-key-root under a FROZEN spec with two-regime reference vectors** (D7/D13, final-pass F6 fold):
   - Spec (versioned, colocated with the ONE exported helper in `packages/aztec-runtime`): `accountSeed = poseidon2Hash([master, chainId, type, index])` → **`signingKey = sha512ToGrumpkinScalar([accountSeed, <IVSK_M domain separator>])`** (upstream's removed `deriveSigningKey` verbatim — V7a header) → `secretKey = await deriveSecretKeyFromSigningKey(signingKey)` → `deriveKeys(secretKey)` → instance at `salt Fr.ZERO` → address. `fromBufferReduce` fallback STRUCK. IVSK_M unavailable/renamed in 5.0.0 ⇒ STOP + re-gate.
   - **Regime A — rc.2-continuity vectors** (seed→signingKey ×2, incl. today's V7a pair): captured from the INSTALLED rc.2 upstream before the bump. Valid across versions because the construction is unchanged; they pin that we didn't change the recipe.
   - **Regime B — stable reference vectors** (signingKey→secretKey; full seed→address; **the COMPLETE serialized `AccountPrivacyKeys` wire value — every privacy-secret and public-key field — plus the resulting `CompleteAddress`** (re-verdict condition 3)): captured BEFORE implementing the helper by a **committed reference script** (`implementations-plan/aztec-5.0.0-stable/reference/derive-vectors.ts`) run against the **hash-pinned published 5.0.0 tarballs** (digests committed alongside), with inputs, exact outputs, domain-separator numeric value, and serialization recorded. The implementation must EQUAL these — **no explanatory exception may replace equality** (the rc.2-address-can't-be-a-stable-KAV contradiction from final-pass F6 is thereby removed: the stable address expectation comes from the stable tarball, not from rc.2).
   - Passkey/password layers untouched; addresses change (accepted — pre-production + reset).
5. **PXE seam churn** (+ final-pass F8): `updateContract` removed end-to-end; **preimage/instance split** with the effective-class helper that **fails explicitly on original≠current** and carries an upgraded-instance regression test (immutable-success + divergence-hard-failure, exercised through an artifact/selector caller); the seam's `registerContract` **asserts the upstream-returned address equals the supplied instance's address** (malformed preimage ⇒ loud failure, not identity drift); `registerAccount` reshape to `AccountPrivacyKeys` with the signing-key-never-crosses-the-seam hygiene pin AND an assert that the resulting registered `CompleteAddress` equals the expected derivation; zod pins re-verified; the Phase-1 typecheck inventory is committed to lessons with a per-site disposition (machine-listed, not prose).
6. **Browser KV store (SQLite-OPFS) — store injection, FAIL-CLOSED** (fable F3 + codex 5 + final-pass F7): per-(profileId, chainId) stores via `createPXE options.store` (Nulo-owned DB + pool names, `poolDirectory = chainDataDir`); `ChainRuntime` owns the handle (fail-closed `close`/`delete`); an enumerable store registry (backend type + identifier recorded per store) driving purge-without-live-runtime and orphan cleanup; purge rework replacing the IndexedDB-name deletions; Vite plumbing for `@aztec/sqlite3mc-wasm`; `web_accessible_resources` untouched. **The deprecated-IndexedDB fallback is REMOVED from the plan** (final-pass F7; resolves the D3↔D8 tension): if the Phase-3 spike finds OPFS unavailable in the offscreen document, the plan STOPS and re-gates — we do not ship an untested fallback backend. Firefox: **honestly not runtime-supported this cycle** — build-gated only, stated in docs; no "if trivially drivable" hedge. **At-rest encryption: ADOPTED IN THIS ARC** (D9 flipped by the user at the gate, 2026-07-14 — codex's cheapest-adoption-point argument accepted): each injected store opens via the `encryptionKey` parameter of `AztecSQLiteOPFSStore.open` (sqlite3mc ChaCha20 — upstream's own battle-tested path, `openEncryptedStore`-equivalent; we do NOT roll crypto), with a **32-byte per-profile store key derived from the in-memory master secret via HKDF-SHA256 under a NEW dedicated domain label** in `@nulo/wallet-crypto` (the same WebCrypto HKDF primitive the session box uses; label pinned by a new key vector in the stop-set file). Properties: the key exists only while the profile is unlocked (the offscreen receives it with the chain-runtime boot, never persisted); purge gains **crypto-erase** (key discard + `store.delete()`); a password change does NOT re-key (the password wraps the master; the master is stable) so the never-migratable KDF-rotation rule is not tripped; the PXE store is fresh this cycle anyway (no migration surface). Spike + gate extended accordingly.
7. **PrivateFPC canonical re-root** (codex 3, verified): the salt sweep (extension `fpc/service.ts:100-104` salt-0 derivation + bridge-core pins/scripts + fixtures) onto canonical salt `0x…01` / `0x257aa870…efc86e9`; per-package canonical descriptors (address+salt+deployer+version+**artifact digest**) machine-asserted by derivation tests; `check-fpc-version.ts` hardened (exact full-version, digest, live `node.getContract` class check, RPC-error ≠ absence). SponsoredFPC stays salt 0 (accelerator's funded `0x0628377e…3fe1`; mismatch = stop).
8. **Backup compat-epoch bump** + old-epoch reject test (codex 9).
9. **Noir surface**: toolchain → 5.0.0; tags → `v5.0.0` ×5; **`token` dep → ecosystem-tooling `v5.0.0`** `packages/aztec-standards/src/token_contract` (the last live `@defi-wonderland` ref), commit-pinned per Scope #3; `consume_l1_to_l2_message([secret])` at both sites (:98, :115); recompile ×3 + commit; portal-fork pins reviewed.
10. **Coupled testnet redeploy (Branch B)** under hardened tooling (final-pass F1–F4 folds):
    - **Deploy-tooling hardening (built + unit-tested BEFORE any live step)**: (a) a **strict candidate schema** (zod: typed `l1.fuel` AND `l1.feeJuice` blocks, address regexes, numeric bounds, `strict()` unknown-field rejection) applied at candidate write AND at every consumer (`bridge-deployments.ts` stops casting unvalidated shapes — final-pass F4); (b) a **schema-validated deployment-intent artifact** (`intent.json`: an **immutable source snapshot** — the git-tree hash taken AFTER all source/config changes (chainId cascade, L1 constants) land and BEFORE any signing, with a **narrow mutable operational-file allowlist** (candidate json, manifests, lessons) as the only files permitted to change during the live arc (re-verdict condition 2) — artifact digests from the canonical descriptors + committed `target/*.json` shas, planned address set, plan-pinned signer allowlist, every seed flag + numeric amount, per-asset caps, candidate digest slot) + a **verify-intent script** that machine-checks: **constructor-aware** L1 code verification of OUR deployed contracts vs the locally built artifacts, **plus readbacks of every privileged live binding** — router/swap `owner`, `swapTarget`, Permit2, FeeJuicePortal, pool manager, Fee Juice + WETH token bindings, portal `UNDERLYING`, handler `FEE_ASSET` (re-verdict condition 1: code hashes don't validate mutable storage; a wrong owner or malicious-but-functional swap target must fail this gate, not pass the canaries) — L2 class-ids vs our computed ones, signer-derived address vs the plan-pinned allowlist; (c) an **intent-enforcing live-run wrapper**: requires EVERY live parameter explicitly (rejects missing/unknown env — script defaults unreachable, incl. `DeployFuelLive`'s `WETH_SEED=0.22 ether` and seed booleans), runs dry-run first, binds the reviewed dry-run to the broadcast invocation, reconciles ETH/WETH/FJ/AZLO balances against the caps after each step.
    - **Plan-pinned L1 signer**: `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5` (the standing deployer, verified across the rc.2 + accelerator arcs) — the wrapper compares the env-derived address against THIS constant (breaks the env-file tautology; a different signer = STOP + surface). The L2 deployer address is recorded into `intent.json` at pre-flight.
    - **Node trust (final-pass F1, adopted via codex's own fallback posture)**: attempt a **second independently operated Aztec RPC** for the pre-flight cross-check; L1 Registry/Rollup state anchored via `cast` regardless. **If no second endpoint exists** (plausible — one public Labs endpoint): the single-L2-node trust is DOCUMENTED in `intent.json` as the accepted weaker posture (testnet-bounded exposure: the FJ canary amounts + the deployer's Sepolia gas within the caps), and the L2 canaries' settlement claims are corroborated by the faucet drip + balance reads through the SAME checks the wallet itself will use. Re-validation (node identity + rollupVersion + registry) runs **immediately before each broadcast group AND before promotion** (not just once).
    - Then the redeploy: chainId cascade (4 sites) → L1 constants → guarded `DeployFuelLive` (dry-run EVERY invocation) → candidate-first L2 bridge + faucet (parallel) → hardened FPC gate → canonical-salt FPC deploy → pool re-seed → **candidate proofs pre-promotion**: `verify-l1 --config` (supplementary) · candidate smoke · fueled candidate smoke · **`fuel-testnet.ts --config <candidate> PRIVATE_RUNS=1` (private settle)** · **a direct Fee-Juice deposit→claim canary against the candidate's `l1.feeJuice` block** (the lane `fuel-testnet` does NOT exercise — final-pass F4) → digest-verified promotion → post-promotion canaries (verify:deployments · drip · balance-vs-caps reconciliation).
11. **Delivery + docs** (Phase 6) and **production delivery** (Phase 7, separately authorized) — incl. a Phase-7 canary through the actual public Fuel surface.

**OUT:**
- Min-age-exclude removal (follow-up ~2026-07-21). Marketplace publishing; mainnet-shaped anything; Cloudflare dashboard.
- Data-preserving storage migration (pre-production reset; the backup edge handled via compat-epoch — D6/D12).
- **The deprecated-IndexedDB fallback backend** (final-pass F7): fail-closed instead.
- **Cross-repo reproducible-build verification of first-party artifacts** (reasoned rejection — Scope #3).
- Footer.vue Wonderland credit stays (its own small gate item, split from D9). Firefox runtime e2e (honest non-support this cycle). Emergency faucet-only lane (D14 — default not taken).

## Main plan

### Phase 1 ✓ — Reference vectors + mechanical bump + install + break inventory (gate green 2026-07-14 — `lessons/phase-1.md`)

0. **Regime-A vectors** (rc.2 still installed): seed→signingKey ×2 from the installed upstream `deriveSigningKey`. **Regime-B vectors**: commit `reference/derive-vectors.ts` + the hash-pinned 5.0.0 tarball digests + exact outputs (signingKey→secretKey, seed→address, AccountPrivacyKeys public set) generated in the scratchpad against the PUBLISHED tarballs (D13). Both fixture sets committed before any implementation exists.
1. `bunfig.toml` re-date + post-install transitive-name reconciliation.
2. Patch re-keys.
3. Pin bumps (66 + 10; viem untouched).
4. Lockfile ritual + the NO-blanket-acceptance exception-listed diff + provenance/attestation checks (incl. subject repo + source commit) + shasums + Nargo SHA recording (Scope #3).
5. `typecheck:all` — expected RED; machine-listed break inventory (incl. the `currentContractClassId` per-site disposition table) to `lessons/phase-1.md`.

**Validation gate** — Commands: both vector-fixture sets committed · `bun install` · the lock-diff exception script (every non-Aztec change enumerated + dispositioned) · zero-rc.2 grep · frozen-lockfile re-install · `npm audit signatures` 0-invalid + attestation subjects match expected repos · inventory in lessons. Layers: reference-vectors · install · lockfile · supply-chain · inventory.

### Phase 2 ✓ — API migration: signing-key-root + PXE seam + FPC canonical + TS churn (gate green 2026-07-14 — `lessons/phase-2.md`)

1. **Account inversion** via the ONE exported helper; Regime-A AND Regime-B vectors must pass UNMODIFIED (equality, no exceptions).
2. **`registerAccount` reshape** + hygiene pin + the registered-`CompleteAddress`-equals-expected assert (final-pass F8).
3. **Key vectors**: V7a's replacement = the committed fixtures; stop-set (V1/V2/**V3 — Aztec-sensitive**/V6/V8/V9/P1) must not move.
4. **Scripts + e2e fixture**: semantic two-step through the helper at all 9 sites; `as any` removed; parity enforcement points migrated same-phase.
5. **PXE seam registerContract**: preimage/instance split + returned-address assert; the effective-class helper + upgraded-instance regression tests (immutable success; original≠current hard failure through an artifact/selector caller); zod pins.
6. **PrivateFPC canonical re-root** (salt sweep, descriptors + derivation tests, hardened `check-fpc-version.ts`, conscious tripwire re-pin with both cross-checks — fires here, fable F4; audit `fuel.test.ts` too).
7. **Compat-epoch bump** + reject test.
8. Sweep the inventory until green.

**Validation gate** — Commands: `typecheck:all` · `test:all` · `lint` · the 5 builds. Pass: all exit 0 (incl. both vector regimes, hygiene + address-equality pins, upgraded-instance regressions, descriptor derivations, epoch reject, re-pinned tripwire, schema-patch guards, dispatcher reachability). Builds = compile-level only; OPFS runtime proof is Phase 3's. **Fast-fail:** non-mechanical break → stop, codex triage, re-plan.

### Phase 3 — Offscreen PXE storage backend (SQLite-OPFS, store-injected, fail-closed)

1. Per-(profile, chain) store injection (Nulo-owned names; `ChainRuntime` owns handles; fail-closed close/delete; the registry records backend type + identifier per store), **opened ENCRYPTED** (D9-adopted): the per-profile HKDF store key (new dedicated label in `@nulo/wallet-crypto`, pinned by a new stop-set vector) passed as `AztecSQLiteOPFSStore.open`'s `encryptionKey`; the key travels only with the chain-runtime boot message while the profile is unlocked, never persisted.
2. Purge rework (`store.delete()` + registry-driven removal; works with NO live runtime; `chain-coordinates.ts` comment updated) — with encryption, purge additionally gets **crypto-erase semantics** (key discard makes residual bytes unreadable even if an unlink is interrupted).
3. Vite plumbing for `@aztec/sqlite3mc-wasm`.
4. **Committed spike script** against the PRODUCTION build: **encrypted** OPFS boot → `sqlite3.wasm` asset/MIME/CSP → create account → restart persistence (same key re-derives, store reopens) → **wrong/absent key fails closed (store unreadable, no plaintext fallback)** → 2 profiles × 2 chains concurrent (no SAH contention; different per-profile keys) → targeted chain purge + full profile purge with negative control (B intact) → no-runtime purge via the registry → zero residual IndexedDB AND OPFS artifacts. **Legacy rc.2 cleanup proven** (re-verdict condition 4): the spike SEEDS legacy `pxe/<profile>/<chain>` IndexedDB stores (and a shared-store fixture) before the run, and the purge path must remove the departing profile's legacy IndexedDB databases too — one-way cleanup, not a fallback backend and not a data-preserving migration — without touching another profile's.

**Validation gate** — Commands: `test:e2e` (smoke) · the committed spike script (all checks; OPFS layout to lessons) · `typecheck:all` + touched units + `lint`. **Fast-fail (fail-closed):** OPFS unavailable in the offscreen document ⇒ STOP the plan and re-gate with the user — no fallback backend ships (final-pass F7).

### Phase 4 — Noir surface + shift inventory

1. `aztec-up install 5.0.0`; `compile.sh` → 5.0.0.
2. Nargo tags ×5 → `v5.0.0`; `token` → ecosystem-tooling `v5.0.0`; commit-pin or SHA-assert per Scope #3.
3. `main.nr` secret-array wrap at both sites.
4. Recompile ×3 + transpile + path-scrub + commit (raw `aztec-nargo` fallback; mixed-set errors → the `token` tag first).
5. Portal-fork pins reviewed/regenerated.
6. **Shift inventory**: `verify:deployments` (expected RED; re-derives COMMITTED pins only), bridge/proxy re-derive, FPC canonical pin re-verified against fresh artifacts, SponsoredFPC re-derivation (expect `0x0628377e…3fe1`). → `lessons/phase-4.md`.

**Validation gate** — the 3 compiles · inventory scripts · `test:all` · `lint` · builds; everything green except `verify:deployments`.

### Phase 5 — Coupled testnet redeploy (live; testnet-broadcast authorization from Phase 0; executed under the intent tooling)

0. **Deploy-tooling hardening first** (all unit-tested BEFORE any live step): the strict candidate schema (writer + every consumer; `bridge-deployments.ts` stops casting), `intent.json` + its zod schema, the verify-intent script (codehash/UNDERLYING/FEE_ASSET/class-id/signer checks), the live-run wrapper (explicit-params-only, dry-run-bound broadcast, per-asset + cumulative caps, balance reconciliation).
1. **Source/config changes FIRST** (re-verdict condition 2 — all tracked-file edits land BEFORE the intent snapshot): chainId cascade (4 sites) + L1 constants re-pin, committed.
2. **Pre-flight — write + review `intent.json`** over the now-stable tree: the immutable source-snapshot hash + the operational-file allowlist; node identity via the primary RPC, a second independent Aztec endpoint if one exists (else the documented single-node posture — Scope #10), L1 Registry/Rollup anchored via `cast`; rollupVersion `1821665230` re-confirmed (moved ⇒ STOP); signer = plan-pinned `0xFcc22383…` (env-derived address must match); every flag + amount + cap explicit; deployer envs present (never created/printed).
3. **L1 fuel** via the wrapper — **revalidate identity (node + rollupVersion + registry) first**: `SEED_AZLO_WETH=false SEED_ETH_FJ=false`, dry-run → review vs intent → `--broadcast --slow`.
4. **L2 bridge candidate-first** (+ faucet in parallel) — **revalidate identity first**; candidate written under the strict schema; **candidate SHA-256 recorded into `intent.json`**.
5. **PrivateFPC** — **revalidate identity first**: hardened gate (exact version + digest + live class) → deploy at canonical salt `0x…01` (asserted `0x257aa870…`).
6. **SponsoredFPC**: expect the accelerator's funded instance; mismatch = stop.
7. **Pool seed** for the fresh AZLO via the wrapper — **revalidate identity first**; dry-run first; explicit amounts.
8. **Candidate proofs — ALL pre-promotion** — **revalidate identity first**: `verify-l1 --config` (supplementary) · `smoke-existing-testnet --config` · `smoke-swap-existing-testnet --config` (fueled) · `fuel-testnet.ts --config <candidate> PRIVATE_RUNS=1` (private settle) · **the direct Fee-Juice deposit→claim canary against the candidate's `l1.feeJuice`** (final-pass F4).
9. **Promote** — **revalidate identity first**: verify-intent re-run (incl. the privileged-state readbacks) + candidate digest unchanged + only allowlisted operational files changed since the snapshot → copy → re-pin consumers atomically in one commit.
10. **Post-promotion**: `verify:deployments` GREEN · a drip · balance reconciliation within the caps.
11. Client-side + CSP checks; reinstall note.

**Validation gate** — step-8 candidate proofs + step-9 digest/intent verification + step-10 canaries, spend within caps. **Live discipline:** fix forward; reuse flags on partial L1; never promote over a partial landing, a changed digest, or a red verify-intent; 5-failure hard stop.

### Phase 6 — Delivery: PR + native-proving network-e2e + docs

1. PR to `dev`, labels `e2e:network` + `e2e:smoke`; accelerator-server v1.0.6 stays (fallback only on proving-specific failure).
2. Stale-rc.2-ref sweep (live refs only).
3. Docs: `UPDATE.md` couplings (D7 helper, `AccountPrivacyKeys` seam, OPFS injection + purge, canonical-FPC descriptors, the intent tooling); `aztec-update` skill (canonical salt policy, ecosystem-tooling source, OPFS injection, double-reset probe, hardened FPC gate, the intent/wrapper pattern); index.md.
4. Follow-ups filed: exclude removal; `minFuelFj` calibration if suggested; upgraded-contract support epic if the divergence helper ever fires.
5. `mergeable` check before reading CI silence.

**Validation gate** — `quality-status` + `smoke-e2e-status` + `network-e2e-status` green on the PR head; no stale live rc.2 refs; follow-ups filed.

### Phase 7 — Production delivery (post-merge; separately authorized)

Release runbook: promote `dev → main` → Release PR (auto-unstick ON) → publish chain → **live acceptance**: `faucet.nulo.sh` build-id reconciliation, chainId `1816023401` served, a drip through the public site, **and a canary through the actual public Fuel surface** (final-pass F4's last leg). Gated on the user's explicit release go — the Phase-0 authorization covers testnet broadcasts only.

**Validation gate** — release assets present · build-id match · public drip + Fuel canary.

### Post-implementation

`/code-review max --fix` (separate commits) → **codex post-impl audit whose prompt MANDATES the targeted security checklist** over the new trust surfaces (the D7 helper + vectors, OPFS store ownership/deletion/registry, the intent/wrapper deploy tooling, the FPC descriptors) — this scoped hardening is now REQUIRED, not offered (final-pass F9); it lives inside the post-impl audit rather than a separate /harden arc. Full repo-wide /harden: not scheduled (recent arcs cover it) — gate-flagged.

## Competing outline — "live-first" — REJECTED

(Unchanged from v3; both auditors concurred. Reorder bump→Noir→redeploy→client fails because the redeploy tooling itself sits on the removed APIs — fable-verified — and outage recovery is Phase 7, not phase order. The separately-authorized emergency faucet-only lane remains D14: default not taken.)

## Security & Adversarial Considerations

- **Threat model**: supply chain (0–1-day-old packages), live-deploy credential + spend handling, a compromised/stale RPC steering deploys or falsely confirming settlement (single-L2-node posture documented when a second endpoint doesn't exist), FPC-identity confusion across the salt-policy change, storage isolation across profiles, stale-generation backups, the PXE trust boundary.
- **Supply chain**: exact pins; signatures + attestations with subject-repo/commit recording; NO blanket lock-diff acceptance (every non-Aztec change enumerated + dispositioned); Nargo commit pinning/SHA asserts; shasums recorded. Residual (explicit): first-party artifact reproducibility is delegated to ecosystem-tooling's own audited pipeline (D10 — internal-consistency checks here, not an independent root).
- **RPC trust**: dual-endpoint attempt + L1 anchoring + per-broadcast-group re-validation; single-node posture, when unavoidable, is written into the intent artifact with its bounded exposure — never silent.
- **Spend control**: plan-pinned signer constant (env tautology broken); wrapper-enforced explicit parameters (script defaults unreachable), per-asset + cumulative caps checked BEFORE each transaction, dry-run-bound broadcasts, post-step reconciliation.
- **The FPC window**: canonical descriptors machine-asserted; hardened exact-version+digest+live-class gate; pre-promotion private settle + direct-FJ canaries; red ⇒ stop.
- **Cryptography**: D7 frozen construction (upstream primitives; struck fallback); two-regime reference vectors with strict equality (no explanatory exceptions); ONE exported helper; stop-set vectors immovable.
- **PXE boundary**: signing key never crosses the seam (pinned); `AccountPrivacyKeys` only; registered-address equality asserted.
- **Storage isolation**: injected per-(profile,chain) stores; fail-closed (NO untested fallback backend ships); registry-driven purge with negative controls on the production build; plaintext-at-rest is an explicit, documented gate decision (D9), not an omission.
- **Backups**: compat-epoch hard reject; blobs remain hostile input.
- **CI/e2e**: no gate weakening; tripwire consciously re-pinned; native proving required.

## Assumptions

**Facts** (verified; several re-verified independently by fable against published tarballs; four codex-r1 claims re-verified in-repo):
1. Live reset confirmed (rollupVersion `1821665230` vs pinned `2787991301`; probe 2026-07-14, re-probed).
2. All four lines published 5.0.0; **the rc.2-known exclude names** are present in bunfig (the stable lock may add transitive names — Phase 1 reconciles).
3. Published-5.0.0 API surface as listed in v3 (deriveSecretKeyFromSigningKey; getSchnorrAccountContractAddress(signingKey, salt, secretKey?); sha512ToGrumpkinScalar; createSchnorrAccount signature unchanged; registerContract(ContractInstancePreimage)→address; ContractInstanceWithAddress retains currentContractClassId; registerAccount(AccountPrivacyKeys, partialAddress); kv-store default ignores dataDirectory + wipes on rollup change + exclusive SAH lock; options.store escape hatch; deprecated IndexedDB entrypoint exists — unused by this plan).
4. Pin surface 66 + 10 (+ viem excluded); patches at rc.2; compile.sh at rc.2; Nargo `v5.0.0-rc.2` ×5 + `token` at `defi-wonderland#prerelease-568f58f`.
5. Derivation chain as mapped (inversion point; seed formula; master-secret termination; address-keyed account rows with throw-on-mismatch; `BASELINE_VERSION = 1`; `deriveSigningKey` ≡ `sha512ToGrumpkinScalar([secret, IVSK_M])`).
6. ~28 production `currentContractClassId` reads across 11 files.
7. Offscreen is the only browser PXE; purge deletes by IndexedDB name; zero sqlite3mc vite handling.
8. FPC identity surfaces (re-verified): extension salt-0 derivation (`fpc/service.ts:100-104`); `check-fpc-version.ts` compares **major-only** (the prerelease strip is one symptom) — false-green across rc↔stable; canonical = `0x257aa870…` at salt `0x…01`; fixture `as any` at `aztec.ts:387`.
9. Backup epoch mechanism as designed (hard reject); restore writes stored addresses without re-deriving.
10. ecosystem-tooling `v5.0.0` public with the token_contract path; upstream `v5.0.0` tag exists; accelerator-server v1.0.6 SHA-pinned with SDK-injected bb; `fuel-testnet.ts --config` support verified.

**Inferences** (attack these):
1. OPFS (incl. SAH workers) is available in the Chrome MV3 offscreen document — Phase 3 verifies; **unavailable ⇒ STOP** (no fallback ships).
2. The two Bun patches apply unchanged — Phase 1 verifies.
3. v1.0.6 accelerator-server + SDK-injected bb 5.0.0 proves our network e2e — Phase 6 re-proves.
4. SponsoredFPC salt-0 derivation equals the accelerator's funded instance (same artifact+salt+deployer+keys required) — mismatch = stop.
5. aztec-nr `v5.0.0` + standards `v5.0.0` tag-compatible **as of the recorded commit SHAs** (the compile proves that resolution; the SHA pin/assert prevents later tag movement from changing it silently).
6. The Noir break surface is limited to `consume_l1_to_l2_message` ×2 — grep-based; only the Phase-4 compile proves it.
7. No third reset mid-arc — re-validated per broadcast group AND at promotion (not just once).
8. Sibling lessons accurate as folded — independently confirmed items: the `deriveKeys` stub removal and the sqlite-opfs `dataDirectory`/lock behavior (fable, published tarballs); the rest treated as leads, not facts.
9. IVSK_M (or its 5.0.0 name) importable — else STOP (D7).
10. A second independently operated Aztec testnet RPC may not exist — if so, the documented single-node posture applies (Scope #10).

**Asks** — Phase-0 resolved: coupled redeploy; testnet-broadcast authorization (NOT Phase 7's release); signing-key-root; tier mid + codex xhigh. **At the approval gate (each its own line — final-pass F9):**
1. **D7/D13 derivation spec** — default: upstream's removed construction + two-regime reference vectors (permanent consensus-critical constant).
2. **Storage backend** — default: SQLite-OPFS via injection, fail-closed, NO IndexedDB fallback ships.
3. **Firefox stance** — default: build-gated only this cycle; runtime honestly unsupported (documented).
4. **PXE-store at-rest encryption** — **RESOLVED: ADOPT NOW** (user, at the gate 2026-07-14; D9 flipped): sqlite3mc ChaCha20 via the injection seam, per-profile HKDF key, crypto-erase purge.
5. **Targeted hardening checklist inside the post-impl codex audit** — default: MANDATORY (scoped to the new trust surfaces); full /harden not scheduled.
6. **Phase 7 release authorization** — acknowledged now; explicit go given post-merge.
7. **Emergency faucet-only lane** (D14) — default: not taken.
8. **Spend envelope numerics** — the caps in `intent.json` (L1 gas + `WETH_SEED` + pool seed + FJ canary amounts) are set at Phase 5 step 1 from the rc.2 precedent and presented for review in-transcript before any broadcast; deployer L1 signer pinned to `0xFcc22383…`.
9. Footer.vue Wonderland credit stays (small, separate item).

## Decision ledger

| # | Decision | Chosen | Rejected alternative(s) | Why |
|---|---|---|---|---|
| D1 | Account key model | Upstream signing-key-root (user) | Vendor old derivation, secret-root | Upstream alignment + PXE-can't-reconstruct-ownership-key |
| D2 | Phase order | Cheap-fail-first | Live-first | Redeploy tooling sits on removed APIs; recovery is Phase 7 |
| D3 | Browser store | OPFS via explicit injection, per-(profile,chain), **fail-closed — no fallback ships** | Upstream default (broken for us); deprecated IndexedDB fallback (REJECTED in v4 — untested path, final-pass F7) | Isolation + honesty; a spike failure re-gates instead of shipping the untested |
| D4 | PrivateFPC pin | Canonical salt `0x…01`, re-rooted at Phase 2, dual cross-checks | Operator-salt lineage; Phase-4 re-pin | The package's 5.0.0 contract; the extension's salt-0 had to move anyway |
| D5 | Wonderland close-out | `token` → ecosystem-tooling `v5.0.0` (commit-pinned); credit stays | Fork-tag (doesn't exist); de-crediting | Published source of truth |
| D6 | Address-change handling | Pre-production reset + compat-epoch reject | Real migration; silent epoch | Designed mechanism; CLAUDE.md rule |
| D7 | seed→signingKey | `sha512ToGrumpkinScalar([seed, IVSK_M])` verbatim | fromBufferReduce (STRUCK); fresh separator | Upstream primitives + continuity |
| D8 | OPFS purge | `store.delete()` + registry-driven, fail-closed, no-runtime-capable, negative-controlled | Directory-only removal; keeping IndexedDB deletions | Purge correctness = profile isolation |
| D9 | At-rest encryption | **ADOPT NOW** (user override at the gate, 2026-07-14): sqlite3mc ChaCha20 via `AztecSQLiteOPFSStore.open`'s `encryptionKey`; per-profile HKDF-SHA256 key (new dedicated label, stop-set-vectored); crypto-erase purge | Defer to a follow-up (the v4 default) | The backend transition is the cheapest adoption point (codex final-pass argument, accepted by the user); no migration surface exists this cycle; password changes don't re-key (master is stable) so the KDF-rotation trap doesn't apply |
| D10 | FPC identity trust | Per-package descriptors machine-asserted (internal consistency) + hardened live gate; **trust root = the first-party pipeline, stated honestly** | Calling our derivation an "independent root" (REWORDED — it shares publisher lineage, final-pass F5); the major-only gate | Honest posture; the live-class check is the runtime backstop |
| D11 | Live-deploy discipline | Schema-validated `intent.json` + verify-intent (codehash/UNDERLYING/FEE_ASSET/class-id/signer) + enforcing wrapper (explicit params, caps, dry-run-bound) + plan-pinned signer + per-group re-validation + pre-promotion settle & direct-FJ canaries | Prose intent in lessons (REJECTED v4 — unenforceable, final-pass F2/F3); "authorized = go"; post-promotion-only settle; single pre-flight probe | Executable enforcement over narrative discipline |
| D12 | rc.2 full backups | Clean epoch reject + test | Silent import; restore-transform | Designed hard gate |
| D13 | Reference vectors | **Two regimes**: rc.2-continuity (signingKey only) + hash-pinned PUBLISHED-5.0.0 tarball references via a committed script (secretKey/address/keys) — strict equality, no exceptions | rc.2-captured address as a stable KAV (REJECTED v4 — logically impossible, final-pass F6); vectors regenerated by the implementation (tautological) | True independence, both regimes |
| D14 | Emergency faucet lane | Not taken (default) | Separately-authorized exact-SHA arc | Phase 7 comparable; one delivery path |

## Audit verdicts

- **Fable round 1 (2026-07-14, `audit-fable.md`):** `conditional approve` — 5 conditions, all folded in v2 (+F8–F15).
- **Codex round 1 (2026-07-14, `audit-codex.md` §Round 1):** `reject` (blocking 1,3,5–11,13,14) — all folded in v3.
- **Codex final fresh-context pass, round 1 (2026-07-14, `audit-codex.md` §Final pass):** `reject` (blocking 1–7) — **folded in v4**: F1 → dual-endpoint attempt + documented single-node posture + per-group re-validation (codex's own fallback option adopted); F2 → schema-validated `intent.json` + verify-intent script; F3 → enforcing wrapper + plan-pinned signer + caps; F4 → strict candidate schema + direct-FJ candidate canary + Phase-7 Fuel-surface canary; F5 → no-blanket lock-diff + Nargo commit pinning + provenance-subject recording + D10 honest reword (cross-repo artifact reproduction REJECTED with reason); F6 → the two-regime vector split (rc.2-address-KAV contradiction removed); F7 → fail-closed, fallback REMOVED, Firefox honesty; F8/F9/F10 → asserts, assumption rewords, ask splits, ledger rewords. Two explicit reasoned rejections recorded: cross-repo reproducible-build verification (Scope #3) and the full second-Aztec-node REQUIREMENT (adopted as attempt + documented posture, per the finding's own fallback).
- **Codex final pass, re-verdict on v4 (2026-07-14, `audit-codex.md` §Final pass round 2):** **`conditional approve`** (with conditions: (1) verify-intent constructor-aware + assert all privileged live state; (2) stable source-tree/mutable-artifact lifecycle + explicit revalidation before every broadcast group; (3) pin the complete `AccountPrivacyKeys` wire vector; (4) seed + verify cleanup of legacy rc.2 IndexedDB stores). **ALL FOUR CONDITIONS FOLDED into this v5** (Scope #10(b), Phase 5 steps 1–9, Scope #4 Regime B, Phase 3 step 4). Codex also confirmed the two documented residuals (capped single-node testnet trust; first-party artifact pipeline) are proportionate as stated.

## Seeds (FINAL — the `/goal` below is ACTIVE in the implementation session since 2026-07-14)

### Recommended: `/goal`

```
/goal Phases 1-6 marked ✓ in implementations-plan/aztec-5.0.0-stable/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/aztec-5.0.0-stable/lessons/phase-N.md in the transcript; the pre-promotion candidate proofs (verify-l1, candidate smoke, fueled candidate smoke, fuel-testnet --config candidate PRIVATE_RUNS=1 settle, the direct Fee-Juice deposit→claim canary) and post-promotion canaries (verify:deployments green, a drip, balance-within-caps reconciliation) all reported green with verify-intent passing at promotion; /code-review max --fix complete with findings applied and committed separately; the codex post-impl audit (gpt-5.6-sol, xhigh, with the mandatory targeted checklist over the derivation helper, OPFS store ownership, intent tooling, and FPC descriptors) complete with high/critical findings addressed; `bun run test:all` and `bun run lint` both exit 0 in the transcript; the PR to dev is open with labels e2e:network + e2e:smoke and quality-status, smoke-e2e-status, network-e2e-status all green on its head; Phase 7 (post-merge release) either completed with my explicit go or surfaced as awaiting my release authorization.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/aztec-5.0.0-stable forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/aztec-5.0.0-stable/plan.md and lessons/ (authoritative state — not the chat); run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json mergeable,statusCheckRollup` (no --watch; CONFLICTING = zero CI, resolve first).
2. Waiting on CI is fine — confirm it progresses (`gh run watch <id>` up to 10 min); use the wait to review the diff or prep the next phase.
3. No task in hand? Pick the next pending step from plan.md. After each meaningful edit run the fast layers (`bun run lint` + the touched package's tests), then commit → push.
4. Stuck or facing a decision you'd bring to me? Call codex (gpt-5.6-sol, xhigh) with full context, reach a defensible verdict, act, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to main, never publish or release (Phase 7 needs my explicit go), never weaken a CI gate, never move Fee Juice past a red hardened check-fpc-version gate, never broadcast outside the intent wrapper or exceed its caps, never promote over a partial landing, a changed candidate digest, or a red verify-intent, no scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex. Live-deploy steps: stop and surface after a FEW failures — never blind-retry a broadcast.
6. Phase green = ITS VALIDATION GATE as written in plan.md passes; paste the result, mark ✓ in plan.md, write lessons, print LESSONS_FILE=implementations-plan/aztec-5.0.0-stable/lessons/phase-N.md, advance.
7. Phases 1-6 ✓? Run /code-review max --fix → commit separately → codex post-impl audit (with the mandatory targeted checklist) → address high/critical → wrap-up report with every contentious decision + ELI5 context → surface Phase 7 for my release go. Stop there.
```
