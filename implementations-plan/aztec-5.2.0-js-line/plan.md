# Plan — aztec-5.2.0-js-line

Bump the `@aztec/*` JS line **5.0.1 → 5.2.0** (20 package names across 8 workspace
package.jsons), while deliberately **holding**: the Noir surface (Nargo tags, compile.sh
toolchain, committed `target/*.json`), `@aztec-foundation/aztec-standards@5.0.1`,
`@alejoamiras/private-fee-juice@5.0.1`, `@alejoamiras/aztec-accelerator@5.0.1` (nothing
5.2.0-targeted exists for any of them), `@aztec/viem@2.38.2` (upstream's own exact alias at both
versions), and the frozen account surface (permanent). In scope by owner choice: CI
accelerator-server binary 1.0.6 → 2.0.0 (shipped FIRST as its own PR — see Delivery), the
setup-aztec snappy-pin probe (+removal if proven fixed), and full local network-suite
validation before the bump PR.

Classification: **Branch A (version-only)** — live testnet rollupVersion 1821665230 equals our
pin; node already runs 5.2.0-nightly. No reset, no redeploys; the only broadcast is the
owner-gated sponsored drip canary (Ask 2). If any drift detector fires mid-run, STOP and
re-gate with the owner per the aztec-update skill — never a silent re-pin.

**Plan baseline**: `origin/dev` @ `21244d4a` (the worktree base — all "zero-diff" gates measure
against this OID, not the working tree). Companion: [recon.md](recon.md). Audits:
[audit-codex.md](audit-codex.md), [audit-fable.md](audit-fable.md). `eli5_mode: artifact`
(URL recorded in Seeds §).

## Success criterion

PR-0 merged: CI accelerator-server at 2.0.0 with verified SHA, canary green on the CURRENT
5.0.1 line. PR-1 merged: all workspace `@aztec/*` pins at 5.2.0 with held surfaces
byte-untouched vs baseline; every freeze test, KAT, keystone, and drift detector green with
**zero pin/vector edits**; `typecheck:all`, `test:all`, `lint`, builds green; smoke green;
**prover-ON frozen-account canary green locally (with `/prove` evidence) and in CI**; full
local network suite green prover-ON including the fee flows; snappy step resolved per probe;
docs updated; both PRs squash-merged into dev with `e2e:network` + `e2e:smoke` labels and all
three required checks green.

## Phase A ✓ — PR-0: accelerator-server 2.0.0 (against the CURRENT 5.0.1 line)

Isolates the binary variable from the version bump (adopted from codex audit H2): if 2.0.0
misbehaves, it reds on a line already known-good, and reverting it is one tiny PR.

1. Behavior diff: read the `accelerator-v2.0.0` release notes + headless-server README section;
   enumerate flag/env/default changes vs 1.0.6 (HTTPS-default, site-authorization /
   `ALLOWED_ORIGINS` semantics, first-run wizard — headless implications; the 1.0.1→1.0.6
   precedent hid a deny-by-default flip that masqueraded as proving timeouts). Verify the
   `Received /prove request` log-line shape survives 2.0.0 (Phase 3/4 gates grep for it) and
   re-check the `tx-sendTx-default.test.ts:24` note ("1.0.1 only covers createChonkProof")
   against 2.0.0's proof coverage. Least privilege: if 2.0.0 supports per-origin allow-listing,
   scope it to the extension origin; allow-all only as documented fallback.
2. Download `accelerator-server-2.0.0-linux-x86_64.tar.gz`; verify the `.sha256` sidecar;
   compute `expected_sha256` of the **extracted binary** (`tar -xzO accelerator-server |
   shasum -a 256`).
3. Edit `.github/workflows/_network-e2e.yml`: `version: "2.0.0"` + the new `expected_sha256`
   (+ any start-flag/env adaptations step 1 mandates; explicit loopback bind flag). **Ask 5 is
   APPROVED: the fail-on-zero-`/prove` enforcement lands HERE** (canary lane only; the
   kill-switch keeps working for manual/non-required lanes). `bun run lint:actions`.
4. Local pre-flight on the OLD line: start the 2.0.0 binary on `127.0.0.1:59833`, build with
   `VITE_NULO_ACCELERATOR_REQUIRED=1`, run
   `bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts`, assert ≥1
   `Received /prove request` in the server log.

**Validation gate** — commands: `bun run lint:actions` + the step-4 canary run; pass criteria:
lint exit 0; canary green WITH `/prove` log evidence on the 5.0.1 line; layers: workflow lint +
prover-ON e2e. Log: `lessons/phase-a.md`. Then PR-0's own quality loop (Post-implementation §,
scoped to its small diff) → open PR-0 (labels `e2e:network` + `e2e:smoke`) → required checks
green (its CI canary proves 2.0.0 under CI conditions) → owner merges → PR-1 work continues on
a rebased branch.

## Phase 0 ✓ — Pre-flight probes for the bump (no repo edits)

1. **Snappy probe**: fresh 5.2.0 toolchain install into a scratch `HOME`
   (`curl -fsSL https://install.aztec.network/5.2.0/install | VERSION=5.2.0 bash`), then
   `node -e "require('snappy')"` against the version dir. Load-clean ⇒ Phase 5 removes the pin
   step; broken ⇒ keep it (self-healing) and refresh its comment.
2. **Local toolchain**: snapshot `readlink ~/.aztec/current`, then `aztec-up install 5.2.0`,
   then re-check the symlink (multi-agent machine — record both readings; keep 5.0.1 installed,
   compile.sh needs it; e2e uses the exact version dir + `E2E_REQUIRE_SETUP=1`). Record the
   installed 5.2.0 tree's identity in lessons (the install channel is an unpinned vendor
   script — see Security).
3. Re-run the read-only SponsoredFPC probes with PASS CRITERIA, not just recording (final-pass
   High 1): `node_getContract` non-null for BOTH generations AND the 5.2.0 instance's fee-juice
   balance (`node_getPublicStorageAt(FeeJuice, deriveStorageSlotInMap(balancesSlot, fpc))`)
   above a one-sponsored-tx-plus-margin floor (use 10× the current network min-fee estimate as
   the margin). Below the floor or null ⇒ STOP and reopen Ask 2 with the owner. Plan-time
   snapshot (2026-08-25): `0x1441…970c` ≈ 1400.7e18, **`0x2ece…315b` ≈ 969.8e18 — deployed AND
   funded, orders of magnitude above any sane floor**.
4. Operational note for the owner: Phase 4's full suite occupies this machine solo for its
   duration (the suite mass-fails under concurrent load).

**Validation gate** — commands: the probe commands; pass criteria: snappy verdict recorded
with output; `~/.aztec/versions/5.2.0/bin/` present; layers: none (read-only probes). Log:
`lessons/phase-0.md`.

## Phase 1 — Pins, patches, lockfile, provenance

1. Edit exact pins to `5.2.0` in: `apps/extension` (20 names), `apps/faucet` (16),
   `apps/playground` (**8**), `packages/aztec-runtime` (**13**), `packages/bridge-core` (**9**),
   `packages/wallet-bridge` (4), `packages/wallet-crypto` (3), `packages/wallet-sdk-schema-patch`
   (2). Counting method (fable C4 — the off-by-ones were the held standards line): count
   `"@aztec/` keys minus `@aztec/viem`; `@aztec-foundation/*` is a DIFFERENT scope and must not
   move. Do NOT touch: `@alejoamiras/*`, `@aztec-foundation/*`, `@aztec/viem`.
2. **First install, THEN patch** (final-pass High 4 — `bun patch` operates on an INSTALLED
   package): run the initial `bun install` right after the pin edits (the 5.2.0 packages
   install unpatched — fine, the patches only fix bundler/node export resolution), then
   generate the `@5.2.0` patches (`bun patch @aztec/noir-acvm_js@5.2.0`, apply the exports-map
   fix, `bun patch --commit`; same for `noir-noirc_abi`), then REINSTALL so both patched
   generations apply. Do NOT blind-copy the 5.0.1 files (patch bodies contain no version
   strings; the only version-coupled artifact is a bun-generated `.bun-tag-<hash>` marker).
   **Keep the `@5.0.1` keys** (the accelerator SDK's nested copies still match them); pin down
   bun's behavior for an UNUSED patch key in lessons. If upstream fixed the exports maps at
   5.2.0, drop the 5.2.0 patch instead (verify the browser build resolves the web entry) and
   record the decision (D4).
3. `apps/extension/scripts/layout-identity.test.ts`: `expectVersion` ×2 → `"5.2.0"`.
4. The installs above are targeted re-resolution (isolated linker stays; NO `rm bun.lock`
   unless bun reports unresolvable conflicts — D1). **Per-mode expected observations**
   (disposition in
   lessons; only the accelerator nests — fable C2): (a) accelerator keeps private
   `@aztec/*@5.0.1` copies via real `dependencies`; (b) `@alejoamiras/private-fee-juice`'s
   exact-5.0.1 `peerDependencies` become unsatisfiable — PRE-DECIDED acceptable outcomes:
   bun links the workspace's 5.2.0 + warns (accept; record the warning verbatim), OR bun nests
   5.0.1 copies (accept; NOTE this flips its hazard mode to nested-dual like the accelerator),
   OR bun hard-errors (STOP — decision back to the owner). (c) standards declares nothing and
   phantom-imports `@aztec/aztec.js/abi` from consumer context (binds 5.2.0 — no lockfile
   change expected).
5. Lockfile review, exact commands:
   `git show 21244d4a:bun.lock > /tmp/bun.lock.base` (session scratch dir is fine too) then
   `bun scripts/lockfile-exception-diff.ts /tmp/bun.lock.base bun.lock` — disposition EVERY
   `exceptions/added/removed` entry by family in lessons (no blanket acceptance; the script
   auto-groups `@aztec/*`+`@alejoamiras/*` as intended-scope, so eyeball that group too for the
   held pins staying 5.0.1; have it emit canonical resolved `name@version`, not nested graph
   keys). **Residue reachability script** (D5, executable; final-pass High 6 spec): a small
   script (name it `scripts/aztec-hold-residue-check.ts`) that (a) asserts every remaining
   `@aztec/*@5.0.1` lock entry belongs to the dependency CLOSURE of the three held packages
   (ancestry, not just immediate referrers — including peer edges per the Phase 1.4 outcome),
   and (b) verifies RUNTIME resolution: from each consumer workspace,
   `realpath`/`require.resolve` the key `@aztec` modules and assert the accelerator's resolve
   lands on 5.0.1 copies while workspace code lands on 5.2.0. It reds on any other 5.0.1
   referrer and is INVOKED BY NAME in every later validation gate. Then
   `bun install --frozen-lockfile` must pass clean (any too-young transitive failing here is
   the gate working — disposition per-name with the owner, never blanket-exclude).
6. **Provenance (execute + transcribe; VERIFY, don't just observe — final-pass High 7)**: build
   the scratch npm project's package.json from the exception-diff's EXACT resolved
   `name@version` list (so npm's lock matches bun's resolution for the changed set), then
   `npm i --package-lock-only` + `npm audit signatures` — the step that cryptographically
   VERIFIES registry signatures (metadata presence alone proves nothing). Cross-check bun.lock
   integrity hashes against the scratch npm lock for the same versions. Upstream ships registry
   `signatures` but NO SLSA `attestations` (unchanged posture). Paste outputs into lessons.

**Validation gate** — commands: `bun install` (clean; BOTH patch generations reported applied),
`bun run --cwd apps/extension test scripts/layout-identity.test.ts`, the two lockfile checks
above, `bun install --frozen-lockfile`; pass criteria: all exit 0, zero un-allowlisted 5.0.1
entries, peer warnings dispositioned, provenance transcribed; layers: install + one unit file.
Log: `lessons/phase-1.md`.

## Phase 2 — API churn, typecheck, unit suites (the freeze invariant)

1. `bun run typecheck:all` — fix churn mechanically and behavior-preserving; wrap upstream
   renames inside our service layer (PxeService precedent) so our RPC surfaces don't ripple.
2. **Three-boundary verification** (codex C1 — one per binding mode):
   - *Accelerator (nested-dual)*: the SDK seam in
     `packages/aztec-runtime/src/pxe/chain-runtime.ts` has TWO typing sites (the constructor
     takes our root `WASMSimulator` at ~:229; `createPXE` takes the SDK prover at ~:248). If
     either type-errors, FIRST diff the relevant declarations (`PrivateKernelProver` .d.ts
     nested-5.0.1 vs root-5.2.0; the serialized `PrivateExecutionStep` shape); casts are
     permitted ONLY on structural identity and ONLY within this file's SDK seam (D2, fable C3);
     log the diff. Any SDK-typing error OUTSIDE `chain-runtime.ts` ⇒ stop and reassess.
   - *private-fee-juice (peer-binds to 5.2.0)*: re-read its wrapper entry points against the
     5.2.0 APIs they now execute on (fee-payment method construction, `PrivateFPC` calls);
     `bun run --cwd packages/bridge-core test src/private-fuel.test.ts` is the pin.
   - *standards (undeclared imports bind to 5.2.0)*: `descriptors-real-artifact.test.ts` + the
     token e2e cover its Token/Dripper wrappers running on 5.2.0 modules.
3. `bun run test:all` — **every** freeze/KAT/keystone/detector unit test green with ZERO
   vector/pin edits. Any red freeze test = STOP (new-major territory), per CLAUDE.md.

(The ~16-file copied-logic re-diff moves to Phase 4 step 1 — after the fail-fast canary — so a
HOLD verdict doesn't waste the largest manual block; fable + codex alignment, D8.)

**Validation gate** — commands: `bun run typecheck:all` && `bun run test:all` && `bun run lint`
&& the freeze-invariant diff `git diff <BASELINE>...HEAD --stat -- packages/aztec-runtime/src/account/ contracts/`
(must be EMPTY; `<BASELINE>` = the PR-1 baseline re-pinned after PR-0 merges — see Delivery)
&& `git status --porcelain packages/aztec-runtime/src/account/ contracts/` (must be empty)
&& `bun scripts/aztec-hold-residue-check.ts`; pass criteria: all exit 0 / empty; boundary
verdicts logged; layers: typecheck + lint + full unit. Log: `lessons/phase-2.md`.

## Phase 3 — Fail-fast checkpoint: first build + prover-ON canary

Runs BEFORE the full battery (codex H2): the two go/no-go unknowns (prover boundary at runtime;
bb pairing) get answered at the earliest buildable moment.

1. Start accelerator-server **2.0.0** (the PR-0 binary) — **UNSEEDED (no `BB_BINARY_PATH`,
   matching CI post-D3; a seed would answer every /prove with itself regardless of the
   requested version)** — with `ACCEL_ALLOW_ALL=1` + `RUST_LOG=info` (the 2.0.0 listener is
   hardcoded loopback with a Host-allowlist; there is no bind flag — assert via `/health`
   before any test).
2. `VITE_NULO_ACCELERATOR_REQUIRED=1` canary via
   `bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts` (agent.sh builds the
   wallet; verify its build-stamp assertions). **Assert ≥1 `Received /prove request`** in the
   server log. **D3 decision procedure** (final-pass High 3): run once with the EXACT
   CI-equivalent seed (`BB_BINARY_PATH` pointing at the 5.2.0 toolchain's bb, as
   `_network-e2e.yml` would set it) and record BOTH the SDK-requested version
   (`x-aztec-version`) and the bb executable the server actually ran; on mismatch, clear the
   server's bb cache / unset the seed and rerun to confirm the unseeded path — only then choose
   keep vs drop.
3. Print the `dist/chrome` size delta vs the baseline build (the dual-generation bundling's
   "size cost accepted" gets a number).
4. A red canary that survives triage = **HOLD the line** (default; Ask 4) — surface to the
   owner; a new extension major is the deliberate alternative. Never neutralize.

**Validation gate** — commands: the canary invocation; pass criteria: green + `/prove` log
evidence + bb version recorded + size delta printed; layers: prover-ON local-sandbox e2e
(canary file; the sandbox is local — no live-network broadcasts anywhere in this plan). Log:
`lessons/phase-3.md`.

## Phase 4 — Full battery: re-diff, detectors, builds, smoke, full prover-ON suite

1. Re-diff the copied-logic list against installed 5.2.0 sources (verdicts per file in
   lessons): `fee-options.ts` + `embedded-fpc-cap.ts` (MIN_FEE_PADDING both),
   `batched-view-simulation.ts` (SerialQueue cite), `fast-path.ts` (named base-wallet imports +
   appCallOffset), `block-header-anchor.ts`, `pxe/service.ts` (tagging-secret sources — 5.1.0
   #24772 scopes secrets to the selected explicit sender, re-verify our "address-derived"
   semantics; `overrides`⇒`skipKernels`; `pxe.debug.getNotes`), `effective-class.ts`,
   `opfs-store.ts` (`PXE_DATA_SCHEMA_VERSION` verified unchanged at 13 — confirm only; note
   the 5.1.0 OPFS quarantine/resync + web-lock changes as expected one-time behavior),
   `public-events.ts`, `pxe/{spec,client,schemas}.ts` zod pins (NoteDaoSchema has no compile
   pin — manual), the class-id-keyed note-decoding path (`note-schemas.ts` — noir-contracts.js
   Token/NFT/FPC class ids SHIFT at 5.2.0; live NULO token is standards-package, unmoved),
   `wallet-core/src/utils/serialization.ts` jsonStringify hand-copy,
   `content-script-validator.ts` InternalMessageType subset, `runtime.ts` BarretenbergSync
   memoized-rejection note, `bridge-core/src/fee-juice.ts` getMinFees mirror. Update the stale
   "wallet-sdk == 5.0.0" header in `packages/wallet-sdk-schema-patch/src/apply.ts`.
2. Builds: `bun run audit:vue` (typecheck ∥ extension-test ∥ lint → build) plus
   `bun run --cwd apps/faucet build`, `bun run --cwd apps/playground build`,
   `bun run --cwd apps/extension build:firefox`.
3. Drift detectors (all green untouched): `bun run --cwd apps/faucet verify:deployments`, then
   the bridge re-derivation via
   `BRIDGE_MANIFEST=public/testnet-bridge.json bun run --cwd apps/faucet verify:deployments`
   (opt-in manifest lane, `apps/faucet/scripts/verify-deployments.ts:146`).
4. `bun run test:e2e` (smoke; sandbox-free).
5. **Full local network suite prover-ON, fallback-proof** (final-pass Critical 1): accelerator-
   server 2.0.0 up, then `VITE_NULO_ACCELERATOR_REQUIRED=1 bun run e2e:agent` — the required-
   mode build makes silent WASM fallback IMPOSSIBLE for the whole suite, not just the canary
   (machine solo — the suite mass-fails under concurrent load; single re-run for known-flake
   fingerprints only, logged). This is the native-proof gate for the fee flows
   (private-fee-juice boundary) and the passkey canary — capture per-fee-flow `/prove`
   evidence from the server log (CI's fee shard is proverless-STUB post-split — it produces NO
   real proofs, so this local run is the ONLY real-proof coverage of the fee flows).

**Validation gate** — commands: steps 1–5; pass criteria: all exit 0; verify:deployments rows
all `[OK]` in BOTH lanes; suite green with fee-flow `/prove` evidence; re-diff verdicts logged
per file; layers: build + smoke + full prover-ON local-sandbox e2e. Log: `lessons/phase-4.md`.

## Phase 5 — Remaining CI wiring

1. `BB_BINARY_PATH`: RESOLVED in Phase A / PR-0 (D3 — dropped with logged evidence). Nothing
   to do here; verify only that Phase 3's canary log shows the expected
   `Requested Aztec version version=5.0.1` + download/prove lines post-bump.
2. `.github/actions/setup-aztec/action.yml`: remove the snappy pin step iff Phase 0 proved the
   5.2.0 install load-clean; otherwise keep + refresh comment.
3. `bun run lint:actions`. (Ask 5's fail-on-zero-`/prove` hardening, if approved, ships in
   **PR-0** — Phase A — so it guards PR-0's own "authoritative" CI canary and everything after;
   final-pass Critical 2.)

**Validation gate** — commands: `bun run lint:actions`; pass criteria: exit 0 + workflow diff
reviewed line-by-line in lessons; layers: workflow lint (the PR's own CI canary is the real
proof). Log: `lessons/phase-5.md`.

## Phase 6 — Docs + delivery prep

1. `UPDATE.md`: banner → 5.2.0; append 5.2.0-arc couplings (dual-key patches, the three-mode
   held-package boundary inventory, prover-boundary cast if made, `x-aztec-version` static-pin
   + BB_BINARY_PATH decision, SponsoredFPC derived-address generation change, superseded
   lockfile ritual on line 11); fix the stale line-47 claim about `node_getContract` absence
   (live node returns `"result": null`, not a missing key — the `!("result" in body)` branch is
   dead; behavior safe via `?? undefined`).
2. `.claude/skills/aztec-update/SKILL.md`: fold in durable lessons (isolated-linker reality
   replaces the hoisted warning; residue reachability replaces zero-residue; the three binding
   modes; SponsoredFPC dual-derivation probe; accelerator 2.0.0 headless notes; snappy outcome;
   two-PR sequencing precedent).
3. `implementations-plan/index.md`: add this plan's line.
4. Full re-gate: `bun run audit:vue` && `bun run test:all` && `bun run lint:actions`.

**Validation gate** — commands: step-4 trio; pass criteria: exit 0 each; docs diffs present;
layers: typecheck+unit+lint+build. Log: `lessons/phase-6.md`. Then the Post-implementation
protocol (quality loops BEFORE the PR exists).

## Architecture & Implementation

**Shape.** No new components. Version axes: the moving JS line (5.2.0) — client libraries,
PXE, simulator, proving JS, sandbox toolchain; the held packages (5.0.1); the permanent frozen
account surface. **Three distinct held-package binding modes** (verified in `bun.lock`):

| Package | Declaration | Post-bump runtime binding | Hazard mode | Pin/gate |
|---|---|---|---|---|
| `@alejoamiras/aztec-accelerator` | exact-5.0.1 `dependencies` | HYBRID in the bundle: nested 5.0.1 stdlib/foundation/bb-prover + Vite-deduped **5.2.0** acvm/abi leaves (final-pass note) | object identity across the prover slot | duck-typed upstream; D2 structural diff; Phase 3 canary |
| `@alejoamiras/private-fee-juice` | exact-5.0.1 `peerDependencies` | binds to workspace **5.2.0** modules (or nests — per the Phase 1.4 pre-decided outcome) | 5.0.1-compiled wrappers on 5.2.0 APIs | peer-warning disposition; `private-fuel.test.ts`; Phase 4 fee flows prover-ON |
| `@aztec-foundation/aztec-standards` | none | binds to workspace **5.2.0** modules | same | `descriptors-real-artifact.test.ts`; token e2e |

The prover boundary serializes to msgpack at the SDK edge with a statically-baked
`x-aztec-version: 5.0.1`. Circuit/VK/CRS/verifier/simulator identity between 5.0.1 and 5.2.0
is proven byte-level (recon §13); `barretenberg/{cpp,ts}` trees changed (perf/robustness, not
diffed file-by-file) — the prover-ON canary is the empirical residual gate.

**Key contracts.** `PrivateKernelProver` (`@aztec/stdlib/interfaces/client`) at the prover
slot; `WalletSchema` mutation contract (zod `.def` internals, runtime-guarded; upstream
byte-stable at 5.2.0); the PXE seam (`packages/aztec-runtime/src/pxe/{spec,ipxe,client,schemas}.ts`).

**Data/control flow (critical path).** Popup → execution service → NuloAccount (frozen
descriptor) → PxeService → PXE 5.2.0 (simulate, kernels) → AcceleratorProver 5.0.1 →
serialize (5.0.1 stdlib) → accelerator-server 2.0.0 → bb (version per D3 evidence) → proof →
PXE → node. Fallback lane (no accelerator): bb.js 5.2.0 WASM — internally consistent.

**File-level change map.** PR-0: `.github/workflows/_network-e2e.yml` (2–6 lines). PR-1: 8
package.jsons + root `patchedDependencies` + 2 generated patch files;
`apps/extension/scripts/layout-identity.test.ts` (2 literals); churn fixes surfaced by
typecheck (expected concentrated in `packages/aztec-runtime/src/pxe/*`, execution
fee/simulation helpers, faucet/playground call sites); possibly ONE cast in
`chain-runtime.ts`; `_network-e2e.yml` BB_BINARY_PATH line; `setup-aztec/action.yml` snappy
step; `UPDATE.md`, skill, index. NOT touched: `contracts/**`,
`packages/aztec-runtime/src/account/**`, held pins, FPC canonical descriptors, KAT vectors.

**Non-obvious mechanics.** (a) Residue reachability allowlist instead of zero-residue; (b)
dual-key patches (bun patches match exact `name@version`); (c) SponsoredFPC address is
generation-dependent — both instances verified live on testnet; (d) Vite dedupes only
`noir-noirc_abi`/`noir-acvm_js` to the 5.2.0 copies in-bundle; the accelerator's nested
stdlib/foundation/bb-prover 5.0.1 copies bundle alongside 5.2.0 (size cost accepted; identity
risk contained to the duck-typed boundary).

**Trade-offs & alternatives not taken.** Full-lockstep bump later — rejected: indefinite
external wait. SDK `5.0.1-revision.1` — rejected: identical @aztec deps, no benefit. Full
`rm bun.lock` regeneration — rejected as default (Bun 1.4 targeted re-resolution is
gate-correct and churn-minimal); fallback on conflict. Single-PR delivery — REVERSED by audit
(codex H2): the accelerator binary bump ships first as PR-0 against the known-good line.

## Competing outline (evaluated — spirit adopted)

**"Fail-fast spike, then clean redo."** Original form (throwaway branch, canary first, redo)
rejected: the canary needs most of Phases 1–2 anyway, so the spike isn't cheap. Its SPIRIT is
adopted per the codex audit: PR-0 isolates the binary variable first, and the canary moved to
Phase 3 — immediately after the first buildable state — so both go/no-go unknowns resolve
before the full battery, CI wiring, and docs.

## Security & Adversarial Considerations

- **Supply chain**: 5.2.0 is outside the 7-day min-age window (published 2026-08-17); the
  exclusion list stays EMPTY; `bun install --frozen-lockfile` proves the gate holds. Provenance:
  `npm audit signatures` transcribed (registry signatures present; upstream publishes NO SLSA
  attestations — unchanged posture, nothing more to verify). Accelerator binary: SHA-256 of the
  extracted binary repo-pinned, verified on every CI run; sidecar cross-checked at Phase A.
  Patches: generated locally against installed packages, content-reviewed (exports maps only).
  Accelerator binary honesty (fable): the `.sha256` sidecar is same-origin transport checking,
  not provenance — the first download is TOFU on an unsigned binary; the REAL control is the
  repo-pinned SHA verified on EVERY CI run (cache hits included), and the release URL/date is
  recorded in lessons.
- **Residual, explicitly accepted**: (a) the bb executable the accelerator-server downloads at
  runtime is NOT repo-pinned — mitigated by preferring a version-correct pinned
  `BB_BINARY_PATH` seed (D3) and by CI runners being single-tenant; (b)
  `vars.NULO_E2E_DISABLE_ACCELERATOR` can turn the canary WASM-only — it is the documented,
  owner-controlled emergency rollback; flipping it is an owner-visible act, and Ask 5 offers
  the fail-on-zero-`/prove` hardening; (c) `barretenberg/cpp` not diffed file-by-file — the
  canary is the gate; (d) the Aztec TOOLCHAIN channel (`curl install.aztec.network | bash`,
  `aztec-up`) is an unpinned vendor script feeding the sandbox the canaries run against — no
  practical pin exists today; Phase 0 records the installed tree's identity in lessons so a
  compromise window is at least reconstructable.
- **Threat model**: npm (mitigated above), the accelerator binary (SHA-pinned,
  localhost-only, CI single-tenant caveat per its release notes), and a silent address-regime
  shift — mitigated by the freeze tests being UNTOUCHABLE gates measured against the pinned
  baseline OID; any red = STOP, never re-pin.
- **Fund safety**: no broadcasts anywhere in the plan's phases (all e2e is local-sandbox; the
  ONLY candidate broadcast is the optional post-merge Ask-2 canary, owner-gated). The 5.2.0
  SponsoredFPC funding question is answered READ-ONLY (fable C1): plan-time probe shows
  `0x2ece…315b` holds ≈969.8e18 fee juice (vs ≈1400.7e18 on the 5.0.1 instance) — deployed,
  funded, in active ecosystem use; Phase 0 refreshes the number. FPC canonical descriptors and
  `PRIVATE_FPC_SALT` untouched; `check-fpc-version.ts` not run (deploy-time gate; its
  nightly-string exact-match is red today independent of this bump — pre-existing, out of
  scope).
- **Rollout coupling**: merging PR-1 to dev changes nothing live. The faucet site + extension
  release pick up 5.2.0 together at the next stable release; both SponsoredFPC generations are
  already deployed on testnet, so old faucet builds keep working against the old address
  meanwhile.
- **Rollback**: revert the squash commit(s) → back to 5.0.1 cleanly (no storage-schema wall —
  PXE_DATA_SCHEMA_VERSION unchanged at 13). After 5.1.0's OPFS quarantine/resync has touched a
  local PXE store, a downgraded client may need a local PXE wipe — acceptable pre-production;
  live testnet contracts unaffected. PR-0 is independently revertable.
- **Least privilege / crypto / frontend**: no new tokens or secrets; workflow edits limited to
  version/SHA/env lines; no crypto code changes (KDF/vector freeze enforced by KATs); no UI
  changes; testids untouched.

## Assumptions

**Facts** (verified; sources in recon.md):
- Testnet rollupVersion 1821665230 == pin; node 5.2.0-nightly (live probe).
- `@aztec/*@5.2.0` published 2026-08-17 → min-age-aged-out since 2026-08-24 (npm time).
- Protocol-circuit pinned build, CRS, sol verifier, AND `yarn-project/simulator` byte-identical
  v5.0.1↔v5.2.0 (git blob SHAs); `barretenberg/{cpp,ts}` changed (not file-diffed); bb has no
  independent version.
- All six `@aztec/accounts` artifacts recompiled at 5.2.0 (SchnorrAccount −3,892 B) — upstream
  class id moves; our vendored copy byte-matches published 5.0.1 (independent hash decode).
- SponsoredFPC: 5.0.1-derived `0x1441…970c` AND 5.2.0-derived `0x2ece…315b` both deployed on
  testnet (`node_getContract`, 2026-08-25); derivation probe reproduced both class ids; **both
  FUNDED** (read-only `getPublicStorageAt` on FeeJuice balances, 2026-08-25: ≈1400.7e18 and
  ≈969.8e18 fee juice respectively).
- Held-package binding modes per `bun.lock`: accelerator = exact-5.0.1 `dependencies`;
  private-fee-juice = exact-5.0.1 `peerDependencies` (TODAY symlinked to the workspace's 5.0.1
  store entries — verified on disk); standards = no declarations (its `Token.js`
  phantom-imports `@aztec/aztec.js/abi` from consumer context).
- Accelerator: npm ≤5.0.1(-revision.1, identical @aztec deps); binaries ≤v2.0.1-rc.1 all
  "Built against Aztec 5.0.1"; SDK bakes `x-aztec-version` from its own package.json; single
  `checkAcceleratorStatus` call site already union-shaped.
- CI: canary shard = transfers + tx-sendTx-default + frozen-account-canary (accelerator
  required); fee-methods + heavy-concurrent shards are proverless STUB post-split (no real
  proofs — corrected during PR-0 review; the audits' "WASM-proves" premise was stale);
  `/prove` count now ENFORCED in accelerator-ON lanes (PR-0), advisory nowhere.
- wallet-sdk 5.0.1→5.2.0: our imported subpaths byte-identical (only `base-wallet/` changed);
  `PXE_DATA_SCHEMA_VERSION = 13` at both; upstream aliases viem to `npm:@aztec/viem@2.38.2` at
  both; canonical addresses: only HandshakeRegistry moved.
- npm dist `signatures` present for the 5.2.0 set, `attestations` absent (same at 5.0.1).
- `@aztec/noir-contracts.js` Token/NFT/FPC/SponsoredFPC class ids shift at 5.2.0.
- Pin surface: 20 `@aztec` names; `layout-identity.test.ts` ×2 literals; isolated linker +
  lockfileVersion 2 + empty exclusion list on the base.
- `@aztec/foundation/serialize` unused; no `-32600` branching; no direct `HandshakeRegistry`
  use; snappy 7.4.1/7.4.2 exist.

**Inferences** (attackable):
- bb keyed per D3 proves 5.2.0-PXE-produced inputs — strongly supported (circuit/simulator
  byte-identity; no wire-format change found; residual = un-diffed `barretenberg/cpp`) —
  decided empirically by the Phase 3 canary.
- The 5.0.1 serializer reads 5.2.0-constructed `PrivateExecutionStep` objects — same decider.
- 5.0.1-compiled wrappers of private-fee-juice/standards run correctly on 5.2.0 modules
  (aztec.js surface stable; 5.3 breaks staged not landed) — gated by private-fuel tests, token
  descriptor tests, and Phase 4 fee flows.
- The published migration notes are complete (dossier exhaustiveness claim).
- Typecheck either passes at the prover slot or fails only there (D2 mitigation ready).
- The two patches either regenerate cleanly at 5.2.0 or are droppable (upstream fixed exports).
- `lockfile-exception-diff.ts` parses lockfileVersion 2 (JSONC assumption — verify before
  reliance).
- Local full-suite runtime/flake profile matches the "runs alone" memory.
- The live node (a rotating `5.2.0-nightly.*` build) accepts stable-5.2.0 clients — inferred
  from rollupVersion equality (the actual invariant), not observed against the stable release.

**Asks** — ALL RESOLVED at the approval gate (owner, 2026-08-26): plan **APPROVED**; Ask 1
leave the testnet map as-is; Ask 2 skip the drip canary; Ask 3 drop-on-mismatch confirmed;
Ask 4 hold-on-red confirmed; **Ask 5 APPROVED — the fail-on-zero-`/prove` hardening ships in
PR-0**. Original ask texts kept below for context:
1. Testnet FPC `compatibleNodeVersions`: append `"5.2.0"` (mirrors the 2026-07-27 mainnet
   ruling) or leave? Default: leave — deploy-time-only script, and it exact-matches full
   version strings so it is red against the rotating nightly string today regardless.
2. **Live sponsored drip canary** (`drip-canary-testnet.ts`) after PR-1 lands: OPTIONAL,
   default skip — the funding question it existed to answer is now answered read-only (the
   5.2.0 instance holds ≈969.8e18 fee juice and is in active use); the canary would only add
   end-to-end usability proof. One zero-cost sponsored broadcast if you want it.
3. `BB_BINARY_PATH` default: drop the pre-seed if Phase 3 shows mismatch (first-prove download
   tax accepted). Confirm.
4. Red canary or red freeze test surviving triage ⇒ HOLD the line (default) — the alternative
   (new extension major) is a separate deliberate plan. Confirm the default.
5. **Canary-shard hardening** (from codex C2; final pass RECOMMENDS APPROVE): make the
   `/prove`-count check enforcing (fail on zero) in the canary lane, closing the theoretical
   green-without-native-proving path that the owner-controlled rollback var opens. The
   kill-switch keeps working for the non-required/manual lanes. If approved it ships in PR-0
   (Phase A), so PR-0's own CI canary — the gate everything else trusts — is already guarded.
   Small workflow edit, touches required-gate semantics — approve or defer?

## Decision ledger

- **D1 — Lockfile method**: targeted re-resolution over `rm bun.lock`; Bun 1.4 gates
  transitives correctly (#25305 closed); full regen only on unresolvable conflicts. Supersedes
  the prior-bump ritual; UPDATE.md line 11 updated in Phase 6. Verification via exact
  `lockfile-exception-diff.ts <base> <new>` + reachability check + `--frozen-lockfile` (codex M2).
- **D2 — Prover boundary**: keep SDK 5.0.1; casts confined to the `chain-runtime.ts` SDK seam
  (both typing sites — the constructor's simulator arg and the `proverOrOptions` slot; fable
  C3), each permitted ONLY after a structural diff of the relevant declarations shows identity
  (codex H1); any SDK-typing error OUTSIDE that file ⇒ stop. Rejected: SDK `5.0.1-revision.1`
  (no benefit), holding the whole line.
- **D3 — CI bb seed**: **DECIDED (Phase A) — DROPPED, in PR-0; mechanism corrected by upstream
  source trace**: `find_bb` returns a seed UNCONDITIONALLY (upstream #352), so a seeded binary
  answers every /prove regardless of the SDK-requested version while the server logs a dead
  download of the right one — a version-mismatched seed would silently prove with the wrong bb.
  The seed is a footgun, not an optimization. Unseeded download tax: 8.1MB, <1s. The
  runtime-downloaded bb is unpinned (accepted residual, noted in Security). Bump-PR Phase 5.1
  is a no-op; Phase 3/4 local servers run UNSEEDED for CI fidelity.
- **D4 — Patches**: dual-key; 5.2.0 patches GENERATED against installed packages (bun patch
  flow), never blind-copied; drop the 5.2.0 key iff upstream fixed exports; never drop the
  5.0.1 key while the accelerator nests those versions.
- **D5 — Residue policy**: reachability allowlist (three held packages) replaces zero-residue;
  executable check in Phase 1.
- **D6 — Excludes**: none added; per-name owner disposition if the gate fires.
- **D7 — Two-PR delivery** (adopted from codex H2; DISPUTED by fable, which endorsed
  single-PR as "one logical one-revert unit"): kept two-PR — the binary bump is provable on the
  known-good line, independently revertable, and its 2.0.0 behavior changes are exactly the
  variable class worth isolating (1.0.6 ALLOWED_ORIGINS precedent); PR-1 remains the one
  logical unit fable argued for. The plan's one genuinely disputed decision — flagged for the
  owner at the gate.
- **D8 — Canary-first ordering** (codex H2 + fable): the prover-ON canary is Phase 3,
  immediately after first buildable state; the ~16-file copied-logic re-diff moved AFTER it
  (Phase 4 step 1) so a HOLD wastes no manual work; full battery, CI wiring, docs follow.
- **Rejected audit items** (with reasons, see audit-codex.md): removing the
  `NULO_E2E_DISABLE_ACCELERATOR` kill-switch (documented owner rollback lever; policy change →
  Ask 5 offers the narrower hardening); adding a CI-native PrivateFPC canary job in this bump
  (local full suite covers it natively; CI WASM-proves it; optional follow-up).

## Delivery

**Two sequential PRs** (D7), both from this worktree's branch history, both squash-merged into
`dev`, both labeled `e2e:network` + `e2e:smoke` at creation, both title-budgeted ≤93 chars:

- **PR-0**: `chore(ci): bump accelerator-server to 2.0.0 (sha-pinned, headless flags)` —
  Phase A only. Opened after its own quality loop; merged (owner) on green required checks.
- **PR-1**: `chore(deps): bump @aztec js line to 5.2.0 (noir, standards, accelerator held)` —
  Phases 0–6. Opened ONLY after the Post-implementation loops converge.

**Handoff protocol** (final-pass High 5): PR-1's branch is cut FRESH from dev after PR-0
merges; at that moment re-pin the plan baseline (`<BASELINE>` := the post-PR-0-merge dev OID —
recorded in lessons and used by every freeze-diff gate; the original recon baseline `21244d4a`
stays the recon reference only). PR-1 must be up-to-date with dev at merge time (re-run CI on a
rebase if dev moved). **Rollback order is PR-1 first, then PR-0** — reverting PR-0 alone would
create the untested 1.0.6-binary + 5.2.0-line pairing.

Check `mergeable` after opening each (a CONFLICTING PR runs zero CI silently). No PR before its
quality loop converges. Merge is the owner's call.

## Post-implementation (self-contained — the implementing session executes THIS, per PR)

Runs once for PR-0 (scoped to its small diff, before PR-0 opens) and once for PR-1 (the net
diff from the plan baseline `21244d4a` minus PR-0's merged content, before PR-1 opens):

1. **`/code-review max --fix`** on the diff under review. Skim applied fixes, then commit them
   SEPARATELY from implementation commits.
2. **Codex audit** (`/codex xhigh`), package: the diff under review; a summary of the
   code-review commits; this plan.md + decision ledger; recon.md; the adversarial/security ask
   ("What could go wrong? What would an attacker target? What are we trusting that we
   shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"); PLUS both
   rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant
     or constraint deserves a comment it doesn't have. Comments are permanent context every
     future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Iterative fix loop**: verify codex's factual claims against the repo first; apply accepted
   fixes; commit; log the round in `lessons/`; RESUME the same codex session with the fix diff.
   Repeat until a round yields no new material findings; still churning after 3 rounds ⇒ stop
   and surface.
4. **Final full re-gate AFTER the loops** (fable C5 + final-pass High 2 — pre-loop runs do NOT
   count): `bun run audit:vue && bun run test:all && bun run lint:actions &&
   bun scripts/aztec-hold-residue-check.ts` plus the freeze diff
   (`git diff <BASELINE>...HEAD -- packages/aztec-runtime/src/account/ contracts/` empty), plus
   a RERUN of the required-mode canary (Phase 3's command) whenever the loop diff touched
   runtime code (docs/comments-only loop diffs may skip it — state which applied), plus any
   phase gate whose surface the loops touched.
5. **Delivery**: only now `gh pr create` (title + labels per Delivery §; body = summary + gate
   evidence). `gh pr checks --watch`; red required check = flake→re-run or breakage→fix, NEVER
   neutralize. Owner merges. After PR-1 merges: watch the FIRST post-merge nightly/soak run for
   the dossier-predicted flake-profile shifts (receipt-poll delay, duplicate-tx-throw removal);
   then `agent-worktree status aztec-5.2.0-js-line "done: PR #N"`, update
   `implementations-plan/index.md`, suggest `agent-worktree done aztec-5.2.0-js-line`.

## Post-implementation hardening

Not scheduled: `/harden` is a release-time whole-repo audit; this bump adds no new trust
boundary. Owner can schedule separately.

## Audit verdicts

- **Codex round 1** (xhigh, fresh): `reject` — findings triaged in
  [audit-codex.md](audit-codex.md); Critical/High items adopted into this revision (three-mode
  boundary inventory, two-PR delivery, canary-first ordering, executable gates with pinned
  baseline, D2 structural-diff precondition, Ask 2 default flip, Ask 5 added). Two items
  rejected with reasons (kill-switch removal; CI-native fee canary).
- **Fable audit** (top-tier Claude, fresh context): `conditional approve (with conditions:
  C1 SponsoredFPC funding probe; C2 peer-mismatch modeling; C3 D2 seam budget; C4 pin
  counts + patch procedure; C5 seed count + post-loop re-gate)` — ALL FIVE conditions resolved
  in this revision (C1 answered empirically at plan time: the 5.2.0 instance is funded);
  triage + the one disputed item (single-vs-two-PR) in [audit-fable.md](audit-fable.md).
- **Final fresh-context codex pass** (new session, full decision trail): `conditional approve
  (with conditions: hard-enforce native proving, repair post-review and PR-handoff gates, and
  make the patch/residue/provenance checks executable)` — ALL conditions integrated in this
  revision (full-suite required-mode, Phase-0 funding floor, expanded post-loop re-gate, D3
  seed A/B procedure, install-then-patch ordering, PR handoff/baseline/rollback protocol,
  residue closure+realpath spec, provenance verification aim, hybrid sub-mode, explicit bind,
  stale-criterion cleanup). Consolidation judged "architecturally coherent"; D7 "defensible
  once its handoff and rollback rules are corrected" (now corrected). Round 2 recorded in
  [audit-codex.md](audit-codex.md).
- **OWNER: APPROVED** (2026-08-26) with all five Asks resolved (see Assumptions § Asks).

## Seeds (FINAL — approved scope, 2026-08-26)

ELI5 companion: published Artifact at
`https://claude.ai/code/artifact/8ffef5f5-6bd3-4851-8f4e-1e86e2676d23` (source:
`implementations-plan/aztec-5.2.0-js-line/eli5.html` — redeploying that file updates the same
URL; keep both in sync on any material plan change).

Recommended: `/goal` (completion is transcript-observable).

```
/goal All EIGHT phase headers in implementations-plan/aztec-5.2.0-js-line/plan.md (Phase A, Phase 0, 1, 2, 3, 4, 5, 6) marked ✓, each backed by its validation gate (as written in plan.md) reported passing in the transcript; for each phase the agent printed LESSONS_FILE=implementations-plan/aztec-5.2.0-js-line/lessons/phase-<id>.md; every freeze/KAT/detector test green with zero pin or vector edits (git diff 21244d4a...HEAD over packages/aztec-runtime/src/account/ and contracts/ is empty, quoted); the prover-ON frozen-account canary green locally with a "Received /prove request" line quoted (both on the old line in Phase A and post-bump in Phase 3); the full local network suite green with fee-flow /prove evidence; for EACH of the two PRs: /code-review max --fix complete with fixes committed separately AND the codex fix loop converged (resumed codex pass reporting no new material findings, quoted) BEFORE that PR was created; both PRs exist on GitHub with labels e2e:network and e2e:smoke (gh pr view output quoted); bun run test:all and bun run lint both exit 0 in the transcript.
```

Fallback `/loop 15m` (fixed interval):

```
/loop 15m Drive implementations-plan/aztec-5.2.0-js-line forward. Never idle waiting for my input. Each firing: (1) read plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if a PR exists, gh pr view --json statusCheckRollup (no --watch). (2) Waiting on CI is fine — confirm it progresses; use the wait to prep the next phase. (3) No task in hand? Pick the next pending plan.md step (order: Phase A → its quality loop → PR-0 → phases 0-6 → PR-1 loop); after each meaningful edit run bun run lint + the touched package's test; commit + push. (4) Stuck or facing a decision I'd normally get? Call /codex xhigh, reach a defensible decision, act, log the consult in lessons/. Hard limits: never merge, never publish/deploy, never broadcast to testnet (incl. drip canaries) without explicit owner authorization, never expand scope beyond plan.md, never edit freeze-surface pins/vectors — a red freeze test or canary means STOP and surface, not fix; never neutralize a required check. (5) Same step failed 5 times? Stop retrying; reassess with codex. (6) Phase gate green (commands + pass criteria as written, incl. the 21244d4a...HEAD freeze diff)? Mark ✓ in plan.md, write lessons, print LESSONS_FILE=implementations-plan/aztec-5.2.0-js-line/lessons/phase-<id>.md, advance. (7) All phases ✓? Run the Post-implementation section exactly, per PR (code-review max --fix → separate commits → codex xhigh loop with the plan's two verbatim rules → PR only after convergence, labels e2e:network e2e:smoke → gh pr checks --watch), then a wrap-up report: what shipped, contentious calls with ELI5 context, open items. Keep the ASCII checklist visible each firing.
```

Both seeds must run INSIDE this worktree (`agent-worktree resume aztec-5.2.0-js-line`). Use
exactly ONE per session — they don't compose.
