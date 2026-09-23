# Recon — aztec-5.2.0-js-line (Phase 0.4)

Bump the `@aztec/*` JS line 5.0.1 → 5.2.0 while HOLDING the Noir side (Nargo tags, compiled
artifacts, vendored SchnorrAccount), `@aztec-foundation/aztec-standards`, and
`@alejoamiras/private-fee-juice` at 5.0.1, and keeping the `@alejoamiras/aztec-accelerator` SDK at
5.0.1 (nothing newer exists). CI accelerator-server binary bump 1.0.6 → 2.0.0 is in scope
(owner-approved), as are the snappy-pin probe and confirming the min-age-exclude hygiene.

Recon base: `origin/dev` @ `21244d4a` (the worktree base). Seven recon agents ran against a
9-commit-stale local tree; every stale finding below was re-verified against the worktree base and
corrections are listed in §10. Method: 6 read-only repo sweeps + 1 upstream dossier + inline probes
(live node, npm registry, worktree greps).

## 1. Bump classification — Branch A (version-only), evidence

- Live testnet `node_getNodeInfo`: `nodeVersion 5.2.0-nightly.20260815`, `rollupVersion
  1821665230` — **equal to our pin** (`apps/faucet/src/lib/chain-constants.ts:22`). No reset.
- The live node already runs a 5.2.0-line build against the same rollup our 5.0.1 client uses
  today → server-side accepts both client generations; the bump aligns client with node.
- Alpha mainnet runs protocol 5.1.0 (owner ruling 2026-07-27 in
  `packages/bridge-core/src/private-fpc-canonical-mainnet.json`) — context, not in scope.
- npm: `@aztec/aztec.js@5.2.0` published 2026-08-17T08:30Z → **outside the 7-day min-age gate
  since 2026-08-24**. Stable 5.x line on npm: 5.0.0, 5.0.1, 5.1.0, 5.2.0 (no 5.0.2/5.1.1).

## 2. Reuse map

| Capability | Existing code / procedure | Verdict |
|---|---|---|
| Bump runbook | `.claude/skills/aztec-update/SKILL.md` + `UPDATE.md` (coupling ledger + validation gate) | reuse-as-is (two lessons superseded — §9) |
| Pin editing surface | §3 table (worktree-verified) | reuse (mechanical) |
| Lockfile diff disposition | `scripts/lockfile-exception-diff.ts` (from aztec-5.0.0-stable; JSONC parse) | adapt-with-verify: confirm it reads lockfileVersion 2 entries |
| Old-version residue check | prior bumps' `rg -c '<old>' bun.lock → 0` | **adapt**: zero-residue is WRONG now — held packages keep `@aztec/*@5.0.1` transitives; becomes an allowlist assertion (5.0.1 entries reachable only from `@alejoamiras/aztec-accelerator`, `@alejoamiras/private-fee-juice`, `@aztec-foundation/aztec-standards`) |
| Provenance check | scratch-npm `npm i --package-lock-only` + `npm audit signatures` ritual (documented in aztec-5.0.1-line/plan.md P1; **never transcribed as executed** for the @aztec scope) | reuse + actually execute and transcribe this time |
| Drift detectors / freeze tests | §5 inventory with exact commands | reuse-as-is (gates) |
| Execution canary | `tests/e2e/network/frozen-account-canary.test.ts` + CI `network-e2e-canary` job | reuse-as-is (gate); local prover-ON procedure in §7 |
| Accelerator binary install/verify | `.github/actions/setup-accelerator-server` (SHA-verified every run) | reuse; two-line caller edit in `_network-e2e.yml` |
| Snappy probe | skill Gotchas: fresh install in scratch HOME + `node -e "require('snappy')"` | reuse (procedure exists; snappy 7.4.1/7.4.2 published Aug 17/20) |
| Sandbox/toolchain provisioning | `setup-aztec` action + `tests/e2e/global-setup.ts` both derive from `apps/extension/package.json dependencies["@aztec/aztec.js"]` | reuse-as-is (no CI edits; local needs `aztec-up install 5.2.0`) |
| Build-new | tiny lockfile-residue allowlist check (script or documented manual disposition) — nothing in-repo does mixed-version residue verification | build new (justified: first split-line bump) |

## 3. Pin surface (worktree-verified; 20 distinct `@aztec` names)

**Bump to 5.2.0** (exact pins):
- `apps/extension/package.json` — 20× `@aztec/*` (accounts, aztec.js, bb.js, constants,
  entrypoints, ethereum, foundation, kv-store, l1-artifacts, noir-acvm_js, noir-contracts.js,
  noir-noirc_abi, protocol-contracts, pxe, simulator, sqlite3mc-wasm, standard-contracts, stdlib,
  wallets, wallet-sdk). `@aztec/viem: 2.38.2` — LEAVE (independent axis).
- `apps/faucet/package.json` — 16× · `apps/playground/package.json` — 8×
- `packages/aztec-runtime/package.json` — 13× · `packages/bridge-core/package.json` — 9×
  (counts = `@aztec/` keys minus viem; the `@aztec-foundation` line is a separate held scope —
  fable-audit correction)
- `packages/wallet-bridge/package.json` — 4× · `packages/wallet-crypto/package.json` — 3× ·
  `packages/wallet-sdk-schema-patch/package.json` — 2×
- Root `package.json` `patchedDependencies`: keys → `@5.2.0`; patch files renamed AND the
  `%2F`-encoded paths INSIDE each patch updated (aztec-5.0.1-line lesson). **Keep the two
  `@5.0.1` patch entries too** — the accelerator SDK's nested `noir-acvm_js@5.0.1` /
  `noir-noirc_abi@5.0.1` copies still match the old keys (agent-3 finding). Verify both apply on
  install.
- `apps/extension/scripts/layout-identity.test.ts:21,37` — `expectVersion: "5.0.1"` → `"5.2.0"`
  (worktree-base-only file; the isolated-linker layout guarantee).
- `UPDATE.md:7` version banner; append 5.2.0-arc coupling entries (additive, never rewrite).

**HOLD at 5.0.1 (deliberate)**:
- `@alejoamiras/aztec-accelerator` (extension + aztec-runtime) — npm has nothing 5.2.0-targeted;
  latest=5.0.1, `testnet` tag=5.0.1-revision.1 whose `@aztec` deps are byte-identical to 5.0.1.
  Newest binary releases (v2.0.0/v2.0.1-rc.1, Aug 18) say "Built against Aztec 5.0.1".
- `@aztec-foundation/aztec-standards` (5 packages) — npm latest=5.0.1; upstream repo has only
  `v5.2.0-rc.1`, no final. User-mandated hold.
- `@alejoamiras/private-fee-juice` (3 packages) — npm has only 5.0.1 (+canaries).
- Noir surface: 4 `Nargo.toml` (tags `v5.0.1` incl. `token` → AztecProtocol/aztec-standards),
  `contracts/bridge/aztec/scripts/compile.sh` (`AZTEC_HOME` 5.0.1), committed `target/*.json`.
- Frozen account surface: `packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json`
  (vendored from `@aztec/accounts@5.0.1`, sha256 `36562cde…`, class id `0x0db5…d0c5`) +
  `frozen-artifact.ts` + `instantiation-descriptor.ts` + `address-freeze.ts` (+ PROVENANCE.md).
  Never bumped with the line, by design; user's freeze question answered YES.

**Tripwires that must NOT be "fixed" by find/replace**:
`packages/bridge-core/src/noir-artifact-classids.test.ts:54` asserts artifact `aztecVersion ==
"5.0.1"` (enforces the Noir hold); KAT vector files; historical comments (§1-I of the pin agent's
sweep: `chain-ids.ts`, `contracts-register.test.ts`, e2e fixtures — comments only, leave).

**Derivation sites (auto-follow, no edit)**: `.github/actions/setup-aztec` (detects from
extension package.json), `apps/extension/vite.shared.ts:39` (`__AZTEC_VERSION__` from
`dependencies["@aztec/pxe"]`), `apps/extension/tests/e2e/global-setup.ts` (`AZTEC_PIN` →
`~/.aztec/versions/<pin>`, hard-fails under `E2E_REQUIRE_SETUP=1` instead of falling back to
`~/.aztec/current`), `apps/extension/scripts/e2e/docker-ci-like.sh`.

**bunfig.toml**: isolated linker (deliberate, keep); `minimumReleaseAgeExcludes` — none active
(removed 2026-08-24) and **none needed**: 5.2.0 aged out 2026-08-24. The "drop stale excludes"
add-on is already done upstream. Any <7d transitive surfacing during re-resolution is the gate
working — disposition per-name, don't blanket-exclude.

## 4. Frozen-account freeze status (user's direct question)

Already fully in place: vendored artifact + sha256/class-id pins (`frozen-artifact.ts`) +
instantiation descriptor + append-only regime record (single regime `nulo-v5`; `V5_REGIME`
reference-bound) + KAT (`derivation-vectors.test.ts`, reference-generated from published 5.0.1
tarballs, never regenerated) + anti-tamper (`address-freeze.test.ts` re-hardcodes the whole
record) + execution canary. The bump must leave ALL of it green with zero edits.

## 5. Drift detectors / gates (run all; expected green untouched)

| Detector | Command | Red means |
|---|---|---|
| artifact-freeze | `bun run --cwd packages/aztec-runtime test src/account/artifact-freeze.test.ts` | 5.2.0 stdlib computes a different class id from unchanged bytes → STOP, new-major territory |
| derivation-vectors KAT | `bun run --cwd packages/aztec-runtime test src/account/derivation-vectors.test.ts` | derivation chain drifted (ours or upstream's) → STOP |
| address-freeze / instantiation-descriptor / account-seed-vectors / account-export | same pkg, respective files | record tamper / init-hash computation change |
| PrivateFPC tripwire | `bun run --cwd packages/bridge-core test src/private-fuel.test.ts` | FPC artifact/derivation drift → conscious re-pin flow only |
| claim-secret + content-hash keystones | `bun run --cwd packages/bridge-core test src/claim-secret.test.ts` / `src/content-hash.test.ts` | poseidon/domain-sep/content-hash drift (irreversible-loss gates) |
| noir-artifact-classids | `bun run --cwd packages/bridge-core test src/noir-artifact-classids.test.ts` | 5.2.0 loader/hasher reinterprets unchanged Noir JSONs |
| verify:deployments | `bun run --cwd apps/faucet verify:deployments` | live testnet dripper/token addresses no longer re-derive from pinned params |
| descriptors-real-artifact | `bun run --cwd apps/extension test src/wallet/services/token/functions/descriptors-real-artifact.test.ts` | standards ABI matcher breakage — the artifact JSON is held, but `loadContractArtifact` runs from the BUMPED `@aztec/aztec.js/abi`, so a red implicates the 5.2.0 loader path, not the held artifact (fable-audit triage correction) |
| bridge re-derivation | manifest metas re-derive (rc.2 lessons one-shot) | instance derivation drift |
| **Execution canary (decisive)** | local prover-ON procedure §7 + CI `network-e2e-canary` (authoritative) | frozen 5.0.1 bytecode no longer simulates/proves/lands under 5.2.0 stack → **HOLD the line** (default) or deliberate new major |

Central subtlety (detector agent): all class-id detectors feed UNCHANGED 5.0.1-compiled artifacts
through the BUMPED loader/hasher. A red = upstream moved a protocol-level algorithm. The wrong
response is editing the pin; the sanctioned response is STOP.

Note `private-fuel.test.ts` compat-map assertions are static-JSON self-consistency; the live-node
gate is `packages/bridge-core/scripts/check-fpc-version.ts` (manual, deploy-time only — NOT part
of this bump's automated gates). Testnet map lacks "5.2.0" — an optional owner-ruling append
(mainnet precedent 2026-07-27), surfaced as an Ask.

## 6. Accelerator coupling (the mixed-version core)

- Boundary: `AcceleratorProver extends BBLazyPrivateKernelProver … implements PrivateKernelProver`
  (`@aztec/stdlib/interfaces/client`); instance passed to `createPXE(..., {proverOrOptions})` in
  `packages/aztec-runtime/src/pxe/chain-runtime.ts`. Upstream accepts by **duck-typing**
  (`isPrivateKernelProver`) — no runtime nominal check.
- Post-bump layout: SDK exact-pins `@aztec/{stdlib,bb-prover,foundation,noir-acvm_js,noir-noirc_abi}@5.0.1`
  → private nested 5.0.1 copies (normal under isolated linker) while the app uses 5.2.0.
- **Typecheck risk** (first empirical gate): nested-5.0.1 stdlib classes are nominally distinct
  from root-5.2.0 ones where private members exist; `new AcceleratorProver(...)` into the
  5.2.0-typed slot may hard-error. If it does: options = one documented boundary cast (runtime
  soundness then carried by the canary) vs holding the line. Decision for the plan.
- **Wire**: `serializePrivateExecutionSteps` (SDK's 5.0.1 stdlib) msgpacks steps CONSTRUCTED by
  the 5.2.0 simulator → `POST /prove` with `x-aztec-version: 5.0.1` **statically baked from the
  SDK's own package.json** — the server will fetch/use the 5.0.1-keyed bb regardless of our bump.
  Two open questions feed the plan's assumptions: (a) does the 5.0.1 serializer read
  5.2.0-constructed step objects correctly; (b) does bb-5.0.1 prove 5.2.0-simulator-produced
  ClientIVC inputs (decided by whether kernel circuits/IVC format moved 5.0.1→5.2.0 — upstream
  dossier + canary). CI nuance: `_network-e2e.yml` pre-seeds `BB_BINARY_PATH` from the
  **5.2.0** toolchain install; whether the server honors it over the requested-version fetch
  decides which bb actually proves in CI — verify empirically via accelerator log during canary.
- Vite: `dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"]` forces the two patched WASM
  packages to a single (5.2.0) copy in the bundle; stdlib/foundation/bb-prover are NOT deduped →
  both generations bundle. `optimizeDeps.exclude` covers bb.js/acvm/abi.
- `checkAcceleratorStatus`: single call site (`chain-runtime.ts`, required-mode only), already
  narrows on `.available`; installed 5.0.1 SDK ALREADY ships the discriminated union. Exposure to
  the v2-era SDK migration: **zero**. SDK pin stays 5.0.1; `5.0.1-revision.1` optional and
  unneeded (identical @aztec deps).
- Binary bump 1.0.6→2.0.0 edit points: `.github/workflows/_network-e2e.yml` `version:` +
  `expected_sha256:` only (recompute sha of EXTRACTED binary; sidecar `.sha256` cross-check).
  Precedent warning (aztec-5.0-upgrade lessons, Blocker 5): the 1.0.1→1.0.6 bump silently flipped
  `ALLOWED_ORIGINS` to deny-by-default and masqueraded as proving timeouts (`ACCEL_ALLOW_ALL=1`
  fix). v2.0.0 adds HTTPS-default + site-authorization + first-run wizard → MUST diff the
  headless-server README/flags before wiring; re-check the `tx-sendTx-default.test.ts:24` note
  ("1.0.1 only covers createChonkProof") against 2.0.0.
- No direct `@aztec/bb-prover` import in our code; no local tooling starts accelerator-server
  (CI-only; local prover-ON is a manual pre-flight).

## 7. e2e / CI wiring

- Version flows from `apps/extension/package.json` only (CI action + local global-setup parse it
  independently). No workflow edits for the version itself.
- Local prover-ON canary procedure (the ONLY meaningful local run — `e2e:agent` silently
  WASM-falls-back otherwise): start accelerator-server (2.0.0 binary, matching the CI bump) on
  `127.0.0.1:59833` → build with `VITE_NULO_ACCELERATOR_REQUIRED=1` → `bun run e2e:agent
  tests/e2e/network/frozen-account-canary.test.ts` → assert ≥1 `Received /prove request` in the
  server log.
- CI canary job `network-e2e-canary` (pr-network-e2e.yml): transfers + tx-sendTx-default +
  frozen-account-canary, retry 0, accelerator required; folded into required `network-e2e-status`.
- Smoke suite is Aztec-free (needs only a built `dist/chrome`).
- `_build-extension.yml` has no version coupling; CI never compiles Noir (5.0.1 toolchain is
  local-only for contract work). Machine needs BOTH `~/.aztec/versions/5.0.1` (held compile.sh)
  and `5.2.0` (sandbox); `E2E_REQUIRE_SETUP=1` insulates from the `~/.aztec/current` symlink race.
- Root scripts: `audit:vue` runs extension-only `test` — gates MUST additionally run
  `bun run test:all` (the KAT/freeze suites live in `packages/*`). `typecheck:all` via package
  scripts (never hand-rolled tsc).
- PR: label `e2e:network` + `e2e:smoke` (mandatory on dep bumps); CONFLICTING PR runs zero CI
  silently — check `mergeable`.

## 8. Upstream exposure (import surface + copied logic)

~600 `@aztec` imports over 75 subpaths (stdlib 265, aztec.js 120, foundation 99, entrypoints 36,
wallet-sdk 25, pxe 18 …). Deep/fragile: `foundation/curves/bn254` (72), `stdlib/interfaces/client`
(32), `pxe/client/bundle` (16), `wallet-sdk/extension/handlers` (10),
`stdlib/database-version/version`, `accounts/schnorr/{stub,lazy}`.

Re-diff-against-5.2.0 candidates (typecheck-invisible semantics):
- `packages/aztec-runtime/src/account/fee-options.ts` + `apps/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts`
  — TWO independent mirrors of upstream `minFeePadding = 0.5` (regression pin exists).
- `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts` (cites
  `@aztec/pxe@5.0.0/src/pxe.ts:355` SerialQueue behavior) · `fast-path.ts` (imports
  `buildMergedSimulationResult`/`simulateViaNode` by name; appCallOffset convention) ·
  `helpers/block-header-anchor.ts`.
- `packages/aztec-runtime/src/pxe/service.ts` (tagging-secret sources trio; `simulateTx`
  `overrides`⇒`skipKernels:true` rule cited to pxe.js:734; `pxe.debug.getNotes`) ·
  `effective-class.ts` (preimage/instance split) · `opfs-store.ts`
  (`PXE_DATA_SCHEMA_VERSION_PIN = 13` — conscious re-pin expected if upstream moved; plus
  refuse-and-preserve semantics re-check) · `public-events.ts` · `spec.ts`/`client.ts` zod pins ·
  `schemas.ts` (`NoteDaoSchema` has NO compile-time pin — manual re-verify).
- `packages/wallet-core/src/utils/serialization.ts` — hand-copied `jsonStringify` from
  `@aztec/foundation/json-rpc`; no drift detector; manual diff.
- `packages/bridge-core/src/fee-juice.ts` (`predictedWorstMinFees` mirrors `getMinFees` incl.
  `-32601` heuristic) — note 5.2.0 changes internal errors `-32600`→`-32603` (we branch on
  neither; `-32601` unaffected).
- Schema patch `packages/wallet-sdk-schema-patch/src/apply.ts` — reaches zod v4 internals
  (`.def.input/.def.output`); fragile against wallet-sdk reshape AND transitive zod drift; its
  header pins "wallet-sdk == 5.0.0 (revisit on bump)" — stale, update. Early signal: wallet-sdk
  5.0.1→5.2.0 npm diff shows IDENTICAL exports map + files list, +2KB content (low reshape risk;
  runtime guards + `dispatcher.test.ts` remain the proof).
- `content-script-validator.ts` mirrors upstream `InternalMessageType` subset; `runtime.ts`
  depends on `BarretenbergSync.initSingleton` memoized-rejection behavior.
- `wallet-crypto` KDF chain frozen by KATs; `nulo-separators.test.ts` asserts non-collision
  against upstream's whole `DomainSeparator` enum (re-runs green or flags additions).
- `@aztec/foundation/serialize`: ZERO imports — the `deserializeArrayFromVector` removal is a
  non-event. `-32600` branching: none. `HandshakeRegistry`: no direct usage (5.1.0 re-pin —
  wallet-sdk-internal note discovery could be affected; pre-production, dev re-handshake
  acceptable; dossier to confirm).

## 9. Lessons applied vs superseded

Applied: closest template `implementations-plan/aztec-5.0.1-line/` P1; patch-internal `%2F` paths;
biome exact-pin churn control + never blanket `--write` on test trees; scratch-npm provenance
(execute + transcribe this time); labels; conflicting-PR-zero-CI; `as never` masks arity; e2e
fixtures outside typecheck; verify a checker can fail before trusting it; nested-worktree
resolution mixed-clone TS-error signature; accelerator binary default-behavior diffing.

Superseded by the new base (decision-ledger material):
- "keep `linker = hoisted`" → base is deliberately ISOLATED (layout-identity.test.ts guards it).
- "always `rm bun.lock`" (Bun #25305) → closed on Bun 1.4; targeted re-resolution (edit pins +
  `bun install`) preferred; full regen only as fallback. UPDATE.md:11 still soft-recommends the
  old ritual — update it with the arc.
- "zero 5.0.1 residue in bun.lock" → allowlist assertion (held packages legitimately keep 5.0.1).
- "min-age excludes needed for a fresh line" → 5.2.0 already aged out (published 2026-08-17).
- Agent-6 inference "CI sandbox install path won't re-trigger fresh resolution" → WRONG: CI's
  toolchain follows the JS pin to 5.2.0; fresh cache-miss install = live npm resolution → snappy
  class risk ACTIVE; the approved scratch-HOME probe covers it (snappy 7.4.1/7.4.2 exist).

## 10. Corrections to stale-tree agent findings (worktree-verified)

- bunfig excludes: already removed upstream (2026-08-24); linker isolated; lockfileVersion 2.
- Pin count: 20 `@aztec` names in the extension (`standard-contracts` + `sqlite3mc-wasm` declared
  by the phantom-dep fix, #454/#455) — stale grep showed 16.
- `apps/extension/scripts/layout-identity.test.ts` exists only on the new base — 2 must-edit
  literals.
- `manifest.config.ts` "5.0.1" hit = substring of a `0.15.0-rc.1` comment — false positive.
- Freeze/detector literals byte-identical between stale tree and base (detector agent
  cross-checked); `private-fuel.test.ts` delta in #455 was mechanics, not pins.
- Test runner: suites run `bun --bun vitest` on the base (#459); `test:all` =
  `bun run --filter '@nulo/*' --if-present test`.

## 11. Absence claims (with trails)

- No `@aztec/foundation/serialize` imports (`rg 'from "@aztec/foundation/serialize"'` — 0).
- No `-32600` branching (`rg '\-32600'` — 0 outside our own emitted `-32603`).
- No direct `@aztec/bb-prover` import outside the SDK (`rg '@aztec/bb-prover' apps packages` — 0).
- No second accelerator-server pin site (all workflows route through `_network-e2e.yml`).
- No CI invocation of `compile.sh`/nargo/contracts (full reads of all 7 workflow files).
- No hardcoded aztec 5.0.1 in `.github/**` or top-level docs (repo-wide `rg -l '5\.0\.1'`
  classification; the only actionable src-side literal is layout-identity.test.ts).
- No local accelerator-server auto-provisioning (CI.md "Local equivalents" + e2e README).
- `@alejoamiras/aztec-accelerator` npm ≤ 5.0.1(-revision.1); binaries ≤ v2.0.1-rc.1, all "Built
  against Aztec 5.0.1" (gh releases + npm view, 2026-08-25).
- aztec-standards upstream: no final v5.2.0 tag (only v5.2.0-rc.1); npm latest 5.0.1.

## 12. Open unknowns → plan Assumptions

1. Does `typecheck:all` pass with the nested-5.0.1 prover instance in the 5.2.0 `createPXE` slot
   (nominal-typing hazard)? Empirical, first gate after install.
2. Does bb-5.0.1 (server-side, per the SDK's static `x-aztec-version`) prove
   5.2.0-simulator-produced ClientIVC inputs — and in CI, does the pre-seeded 5.2.0
   `BB_BINARY_PATH` override the per-version fetch? Canary + accelerator log decide; upstream
   dossier assesses circuit churn.
3. Did `PXE_DATA_SCHEMA_VERSION` move upstream (expect a conscious re-pin of
   `PXE_DATA_SCHEMA_VERSION_PIN = 13` if so)?
4. Do the two noir-wasm patches still apply at `@5.2.0` (upstream may have fixed the exports maps
   → drop instead of rename)?
5. accelerator-server 2.0.0 headless flag/behavior changes (ALLOWED_ORIGINS/HTTPS/first-run) —
   release-notes + README diff required before the CI edit.
6. Upstream 5.1.0/5.2.0 JS breaking changes beyond the published migration notes (dossier).
7. Testnet FPC `compatibleNodeVersions` append of "5.2.0" — owner-ruling Ask, optional.

## 13. Upstream churn dossier (5.0.1 → 5.2.0)

Sources: GitHub contents API at tags v5.0.1/v5.2.0, npm registry, jsDelivr per-file hashes.

**Migration notes are complete as published** — no hidden 5.1.0/5.2.0 entries beyond: pub note
types (aztec-nr, N/A — no recompile), sequencer min-peers (N/A), `-32603` internal errors (we
branch on no numeric codes), `GET /status` JSON body (no consumers), `deserializeArrayFromVector`
removed (zero imports — §11), HandshakeRegistry re-pin, typed property selectors (aztec-nr, N/A).

**Proving stack — proven compatible at the circuit level.**
`noir-projects/noir-protocol-circuits/pinned-build.tar.gz` has the SAME git blob SHA at both
tags (`3bedcb1f…`, 67,808,507 B) — every private-kernel/rollup circuit + VK byte-identical.
Also byte-identical: `barretenberg/sol` (on-chain verifier), `barretenberg/crs`, the chonk/rollup
circuit manifests, and `yarn-project/simulator`. `barretenberg/{cpp,ts}` trees changed
(perf/robustness; e.g. bb socket-startup fix #24802) — **no wire-format/msgpack/ACIR
serialization change found** (an earlier "wire format did change" phrasing was retracted); bb
has no independent version (monorepo-versioned). Residual: cpp not diffed file-by-file — the
prover-ON canary is the empirical gate. `@aztec/bb-prover` export surface identical.

**Artifact recompiles (Noir beta.22→beta.25).** All `@aztec/noir-contracts.js` app artifacts
recompiled ⇒ class ids shift for Token/NFT/FPC/SponsoredFPC from THAT package. All six
`@aztec/accounts` artifacts recompiled (SchnorrAccount −3,892 B) ⇒ upstream's account class id
moved — our vendored freeze is actively load-bearing (and byte-matches published 5.0.1,
independently re-hashed). **SponsoredFPC resolved live**: 5.0.1-derived `0x1441…970c` AND
5.2.0-derived `0x2ece…315b` are BOTH deployed on testnet (`node_getContract` probes,
2026-08-25). Watch item: `note-schemas.ts` keys note decoding by class id; the live NULO token
comes from held `@aztec-foundation/aztec-standards` (unmoved), so live balances unaffected —
verify the class-id-keyed paths against shifted noir-contracts.js ids in Phase 2/3.

**Canonical addresses.** Only HandshakeRegistry moved (`0x086c…831d` → `0x0612…aa9d`);
AuthRegistry/MultiCallEntrypoint/PublicChecks byte-identical. `@aztec/protocol-contracts`
(ClassRegistry/InstanceRegistry/FeeJuice): artifact files content-changed (equal-length
`aztec_version` swap) yet generated `protocol_contract_data.js` **byte-identical** — natural
experiment proving the 5.2.0 loader is derivation-neutral on unchanged bytecode and
`aztec_version` doesn't feed the artifact hash. Derivation surface: `stdlib/src/contract`,
`hash`, `keys`, `vks`, `aztec-address` trees byte-identical; `stdlib/src/abi` changed in 2 files,
purely additive.

**PXE storage.** `PXE_DATA_SCHEMA_VERSION = 13` at BOTH versions (read from
`@aztec/pxe/dest/storage/metadata.js`) — our `PXE_DATA_SCHEMA_VERSION_PIN = 13` stays; no
re-pin. 5.1.0 OPFS behavior changes (runtime, non-breaking): legacy duplicate handles
quarantined with store-reopened-EMPTY + resync (#24743), web-lock-guarded pool creation
(#24740), corruption → rebuild+resync (#24739). Expect possible one-time PXE resync for
existing dev profiles.

**Behavioral drifts to watch** (runtime, not API): tagging secrets scoped to the selected
explicit sender (5.1.0 #24772 — re-verify our "address-derived" source semantics);
`aztec.js` delays first receipt poll after send (#25089) + `EmbeddedWallet` drops a local
duplicate-tx throw (e2e timing/flake profile may shift); bounded deserialization caps on
Tx/HashedValues/sim-overrides (#25026/28/29); JSON-RPC clients send/accept cookies (#25231);
browser CRS + SQLite wasm-load robustness fixes (#24894/#24937).

**wallet-sdk: no-op for us.** Only `base-wallet/` changed; our imported subpaths
(`/extension/handlers`, `/types`, `/manager`) byte-identical; `WalletSchema` byte-stable (schema
patch inputs unchanged). Indirect: `EmbeddedWallet` picks up the receipt-poll delay.

**Staged for 5.3.0, confirmed INERT at 5.2.0** (next-bump foresight): protocol contracts move
out of `noir-contracts.js` into `@aztec/aztec.js/protocol`; `at(wallet)` → `withWallet(wallet)`.

**@aztec/viem**: upstream aliases `viem` to exactly `npm:@aztec/viem@2.38.2` at both versions —
our pin needs no action.

**Provenance**: npm registry `signatures` present for the 5.2.0 set; `attestations` ABSENT
(same at 5.0.1 — registry signing only, no SLSA; unchanged posture, nothing for
`--provenance` to verify beyond signatures).

**Stale docs found**: `UPDATE.md:47` claims testnet `node_getContract` absence omits the
`result` key; live node returns `"result": null` (the `!("result" in body)` branch in
`rpcOptional` is dead; behavior safe via `?? undefined`). Drive-by fix in Phase 6.

**FPC node-compat gate**: `check-fpc-version.ts` exact-matches full version strings; the live
nightly string (`5.2.0-nightly.20260815`, rotating daily) fails it TODAY — pre-existing,
deploy-time-only, out of scope (owner Ask noted in plan).
