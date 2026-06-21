# Phase 0 — clarifying + research notes

## Decisions (user, blueprint Phase 0)
- Scope: **Everything, bridge-correct** (TS all packages + 3 Noir crates + bridge-core/evm, validate bridge).
- Validation: **Full network-e2e on real 5.0** (highest gate).
- Breaking posture: **Document the reset, no migration UX** (testnet rc; PXE wipe + dead Schnorr accounts accepted).
- Versions: leapfrog 4.2.0 → 5.0.0-rc.1; fold 4.3.0 changelog items. No 4.3.0 pins exist in-repo.

## Tier rubric → mega-deep
Novelty / blast-radius / irreversibility / migration-cost / external-coupling / security-sensitivity = 6/6 HIGH.

## Load-bearing facts verified
- All TS packages share one `bun.lock` → must bump together.
- `@aztec/aztec.js@5.0.0-rc.1` published 2026-06-15 → blocked by 7d min-age gate until ~06-22; needs temporary `minimumReleaseAgeExcludes`.
- `patchedDependencies` = only `@aztec/noir-noirc_abi@4.2.0` + `@aztec/noir-acvm_js@4.2.0` (no `@aztec/accounts` patch).
- `CURRENT_VERSION = 7` in `packages/extension/src/wallet/storage/migrate.ts` (precedent docs were stale at 4).
- `getInitialTestAccountsData` only at `packages/bridge-core/scripts/deploy-sandbox.ts:110-111` → initializerless switch site.
- Wallet uses `createPXE` (not EmbeddedWallet) → AuthRegistry preload is a real migration item.
- `fee-options.ts` is a byte-for-byte copy of base_wallet fee logic that changed in 5.0.

## BLOCKER discovered
**No 5.0-compatible accelerator-server binary exists.** CI pins binary v1.0.1; latest v1.0.6 tracks Aztec 4.3.1; SDK 5.0.0-rc.1 release has no binary asset. The user's "full network-e2e" choice depends on a 5.0 accelerator-server binary being released first (user owns `alejoamiras/aztec-accelerator`). Surfaced as top Ask + sequenced prerequisite. Conflict between stated validation choice and current reality — do NOT silently proceed; resolve at approval gate.

## Verification pass (Inferences → Facts; fold into plan.md at consolidation)
- **Standards 5.0 Noir tag = same tag as the TS tgz.** `prerelease-334c38d` (`@defi-wonderland/aztec-standards@5.0.0-rc.1-prerelease.334c38d`) serves BOTH the TS tgz and the Noir `src/token_contract` git directory. So `packages/bridge-aztec/token_minter_proxy/Nargo.toml:8` just bumps `tag="prerelease-1ad0e28"` → `"prerelease-334c38d"`. (Resolves Ask #3.) Multiple 5.0.0-rc.1 prerelease tags exist; user specified 334c38d.
- **Install endpoint serves the rc.** `https://install.aztec.network/5.0.0-rc.1/install` → HTTP 301 → `install.aztec-labs.com/5.0.0-rc.1/install`. `setup-aztec` uses `curl -fsSL` (follows redirects). (Resolves a P6 Inference.)
- **Accelerator SDK 5.0.0-rc.1 well-formed:** `main ./dist/index.js`, `types ./dist/index.d.ts`, single clean export. Deps incl. a NEW transitive `@aztec/bb-prover@5.0.0-rc.1` → must be covered by `minimumReleaseAgeExcludes` too (or the delete-bun.lock re-resolve path). Exact `AcceleratorProver` API stays typecheck-discoverable; risk downgraded.
- `token_bridge/Nargo.toml` deps: `aztec` + `token_portal_content_hash_lib` both `v4.2.0-aztecnr-rc.2` → bump to the 5.0 aztec-nr tag (confirm exact upstream tag name during P5).

## Consolidation deltas (independent Sonnet plan + verification) — fold into plan.md
- **bb.js is BUILD-EXTRACTED, not vendored.** No `packages/extension/libs/@aztec/bb.js/` dir; `packages/extension/scripts/extract-bb-wasm.ts` reads `node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz` + `dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg{,-threads}.js` at build, with a hash assertion + a clear throw if layout moved. ⇒ replace plan's "re-vendor" step (stale 4.2.0 precedent — research/01 was wrong) with "run build; extract-bb-wasm self-reports if bb.js@5.0 moved paths; fix the path constants if it throws."
- **`@aztec/viem@2.38.2` is a SEPARATE version axis** (viem-compat; `extension/package.json:79` direct + `bridge-core/package.json:29` `viem: npm:@aztec/viem@2.38.2`). Do NOT bump to 5.0; do NOT add to min-age excludes. Matrix's "all @aztec/*" was too broad.
- **Two-stage network-e2e** (Sonnet structure, adopt): 6A proverless network-e2e validates the protocol migration NOW (no binary needed; `NULO_E2E_DISABLE_ACCELERATOR=1`); 6B native-proving canary is the user's "full network-e2e" target, gated on the Phase-0 binary. Resolves the blocker tension without stalling migration validation.
- **Schema-patch same-arity silent-override risk** (Sonnet): the guards check arity, so an upstream method added with the SAME arity passes the guard and silently overwrites. Mitigation: in Phase 3, manually inspect 5.0 `WalletSchema` for native registerToken/isTokenRegistered/grantPublicAuthwit, not just rely on the arity guard.
- **`DOM_SEP__FPC_BRIDGE_SECRET` literal (3952304070)** in `private-fuel.ts` is `poseidon2HashBytes(...)`-derived; `private-fuel.test.ts` pins it. My read: Poseidon2 the HASH params are stable (the 5.0 change is the Schnorr signature CHALLENGE moving to Poseidon2, + NEW domain separators for merkle/block/blob — not a change to existing `poseidon2_hash_bytes`). So likely unchanged; the test is a tripwire either way. Rate MEDIUM (Sonnet rated CRITICAL — ledger disagreement).
- `compile.sh` pins toolchain via `AZTEC_RC2=$HOME/.aztec/versions/4.2.0-aztecnr-rc.2` → update to 5.0 toolchain string.
- `@aztec/bb-prover@5.0.0-rc.1` is a NEW transitive via the accelerator SDK → cover in min-age handling.

## BLOCKER DISSOLVED (user correction, 2026-06-19) + APPROVED
The "no 5.0 accelerator-server binary → blocker" framing was WRONG about the mechanism. The accelerator-server **downloads the SDK-requested `bb` version on demand**; bundling is only a first-prove latency optimization (v1.0.6 notes: bundled-4.3.1 ⇒ "no on-demand download on first prove" — confirming a non-matching version IS downloaded). SDK exposes `needsDownload` + a `"downloading"` phase. ⇒ the existing binary line proves 5.0; Phase 0 is now just a CI pin refresh (v1.0.1 → current + new extracted-binary SHA at `_network-e2e.yml:158-167`) + ensure runner egress for the first-prove download. Native-proving 6B is unblocked NOW. Ask #1 dissolved.
Resolved defaults (per "approve everything else"): min-age excludes added immediately (not waiting for 06-22); single feature-branch PR (lockfile coupling rules out a green-per-step stack); `/harden security` recommended at pre-release, not scheduled now.
Audit trail: codex round-1 reject (2 CRITICAL + 8 HIGH, all repo-verified) → fixed → codex round-2 conditional-approve (3 conditions folded; 1 was a grounded partial pushback — native proving stays a canary-shard concern per the repo's proverless-bulk/native-canary design).
