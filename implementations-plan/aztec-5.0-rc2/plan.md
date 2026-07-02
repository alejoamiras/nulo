# Aztec JS 5.0.0-rc.1 → rc.2 (library bump + testnet redeploy)

**Tier:** `mid`-audited base, **redeploy folded in by user override at the gate** ("class-ids will shift, we redeploy everything — it's part of the plan") · **Branch:** `deps/aztec-5.0-rc2`.

## Summary

Bump the ~20 `@aztec/*` packages `5.0.0-rc.1` → `5.0.0-rc.2` (across 7 package.json), re-key the 2 noir patches, **bump the rc.1-pinned Noir toolchain + aztec-nr git tags**, re-resolve `bun.lock` under a tracked min-age exclude, **redeploy the shifted contracts on the rc.2 testnet + re-pin the live manifests**, and prove it green through the cheap gates + the live re-canary + **native-proving network-e2e**. rc.1→rc.2 is 187 upstream commits with `!:` breaking changes in node/protocol internals we don't call directly (verified: zero `getCheckpoint`/`proposedCheckpoint`/`for_each`/`CapsuleArray` refs).

**The reframe (audits + user, final):** the audits proved a class-id/derivation drift is a **merge-blocker** (the network-e2e harness fresh-deploys and survives a shift, but `verify:deployments` re-derives the **live** faucet/bridge instances from pinned params inside the faucet build CI gate — `_build-faucet.yml:36` — and the PrivateFPC bytecode tripwire fires on the same class of change). The user then resolved the coupling the other way: **the shift is EXPECTED, and the testnet redeploy is IN SCOPE.** So Phase 2 stops being a go/no-go gate and becomes a **shift inventory** (measure old→new for every live identity), and a new **Phase 3 executes the redeploy + re-pin + live re-canary** — using the repo's proven scripts and the `fuel-portal-v5-fix` runbook shape. The PR only goes green once the live world and the pins agree again; that coupling is now embraced, not dodged.

## Tier note (Phase 0.5, final)

The `mid` dual+final audit cycle hardened the bump mechanics (3 rounds: codex reject → folded; Opus conditional → folded; final codex conditional → folded). The user's gate override moves the redeploy — which I'd scored as `deep`-shaped — into scope. Rather than re-running full deep ceremony over an already-thrice-audited base, the redeploy delta gets **one focused codex pass** (Round 3) on the restructured Phases 2–4; the redeploy itself has direct precedent (`fuel-portal-v5-fix`: portal re-pin + router redeploy + live canary; the faucet/bridge deploy + verify + canary scripts are exercised tooling). Escape hatch: if the redeploy surfaces novel ground (network not actually reset, pool re-seeding cascade, an account-derivation change forcing a storage migration), STOP and surface.

## Scope

**IN (the bump + the diagnostic):**
- The ~20 `@aztec/*` pins `rc.1`→`rc.2` across **7 package.json** — `apps/{extension(19),faucet(15),playground(7)}`, `packages/{aztec-runtime(10),bridge-core(9),wallet-bridge(4),wallet-crypto(1)}`. **NOT** `apps/landing` (0) or `packages/wallet-core` (0). `@aztec/viem@2.38.2` untouched (independent).
- The 2 patch re-keys (`patches/@aztec%2F{noir-acvm_js,noir-noirc_abi}@…`, `rc.1`→`rc.2`; both patch only `package.json` — mechanical).
- **The Noir toolchain + source pins** (codex Crit #2 / Opus HIGH #1): `contracts/bridge/aztec/scripts/compile.sh:4-9` (rc.1 aztec CLI/`aztec-nargo`) + the **5 `tag = "v5.0.0-rc.1"` git pins** in `contracts/bridge/aztec/{token_bridge,keystone,token_minter_proxy}/Nargo.toml` → `rc.2`. Recompile all 3 (`keystone` currently has **no `target/`** — compile it too) and **commit the re-derived `target/*.json`** (they track the source version; committing the compiled output is part of the bump, distinct from an on-chain redeploy).
- `bunfig.toml` `minimumReleaseAgeExcludes`: add the rc.2 `@aztec/*` set (temporary, dated, removal-follow-up); the accelerator is already name-excluded.
- `bun.lock` re-resolve (delete + install, Bun #25305) **+ an allowlist diff** asserting ONLY `@aztec/*` (+ intended) versions moved — no surprise transitive `^`-range jumps (codex Med).
- The 3 **`nulo-schema-patch.ts` runtime guards** (extension/faucet/playground) + the dispatcher reachability test — they `throw` at init if rc.2 moved `WalletSchema.registerToken`'s shape (zod-internal coupling); exercised by `test:all`, not `typecheck` (Opus MED).
- **The `@alejoamiras/aztec-accelerator` npm package** `rc.1`→`rc.2` (`apps/extension/package.json:32` + `packages/aztec-runtime/package.json:20`) — **REQUIRED, not optional**: at rc.1 it exact-drags rc.1 `@aztec/{bb-prover,foundation,stdlib,noir-acvm_js,noir-noirc_abi}` (`bun.lock:309`), so leaving it pinned creates a MIXED rc.1/rc.2 `@aztec` set. `@alejoamiras/aztec-accelerator@5.0.0-rc.2` exists (codex-final HIGH #1).
- The CI accelerator **binary** (`setup-accelerator-server` v1.0.6) — conditional (Phase 3; bb injected via `BB_BINARY_PATH` from `setup-aztec` → likely no bump).
- Stale `rc.1` doc/comment refs.

**The 2 Wonderland packages — SWITCH to the user's npm takeover scope at rc.2** (user now owns + publishes both; supersedes the earlier "leave pinned" note AND the interim tgz/build-from-SHA plan):
- `@defi-wonderland/aztec-standards` (GitHub-tgz URL, **5 pins**: extension · faucet · playground · aztec-runtime · bridge-core) → **`@alejoamiras/aztec-standards@5.0.0-rc.2`** (npm; verified published 2026-07-02, peers = rc.2 `@aztec/*`, **no hard deps** → no transitive drag).
- `@wonderland/aztec-fee-payment` (GitHub-tgz URL, **3 pins**: extension · aztec-runtime · bridge-core) → **`@alejoamiras/aztec-fee-payment@5.0.0-rc.2`** (npm; same shape — rc.2 peers only, verified).
- **Import-specifier rename across 16 TS files** (verified via `rg -l 'from "@(defi-)?wonderland/'`): faucet composables/contracts/scripts, bridge-core `src/{private-fuel,private-fpc-artifact}.ts` + scripts, `apps/extension/tests/e2e/fixtures/aztec.ts`. Mechanical two-token replace (`@defi-wonderland/aztec-standards`→`@alejoamiras/aztec-standards`, `@wonderland/aztec-fee-payment`→`@alejoamiras/aztec-fee-payment`). Non-import mentions (`Footer.vue` credit, `check-fpc-version.ts`, docs/tests) reviewed case-by-case — UI/protocol credits to Wonderland stay unless they encode the package name.
- **Both published TODAY → add to `minimumReleaseAgeExcludes`** alongside the accelerator + the rc.2 `@aztec/*` set (same dated removal-follow-up). Supply-chain: first-party-controlled scope (the user publishes them) — provenance strictly improves vs third-party GitHub-release tgz URLs; exact-pin both (no `^`).

**IN (the redeploy — user gate-override, was OUT):** the full testnet redeploy + re-pin, via the repo's exercised tooling: L1 (re-derive the rc.2 rollup's Aztec-side constants → update `DeployBridge.s.sol:127-131` pins → forge redeploy portals/router — the `fuel-portal-v5-fix` runbook shape), L2 (faucet `scripts/deploy.ts` for dripper+NULO/OLUN; bridge-core `scripts/deploy-bridge-testnet.ts` + `deploy-manifest.ts` for bridge/proxy/keystone; PrivateFPC per the fee-payment flow), the re-pin surface (`apps/faucet/src/contracts/{deployments.json,deployments.ts,bridge-deployments.ts,sponsored-fpc.ts}` + `chain-constants.ts` `TESTNET_ROLLUP_VERSION` if the reset bumped it — the wallet chainId is DERIVED from it), the conscious PrivateFPC tripwire re-pin + **live re-canary** (`smoke-existing-testnet.ts` + the `fuel-testnet.ts` private-FPC variant). Client-side: assess whether rc.2 changes *account* derivation → storage-version bump (document-the-reset precedent) — contract class-ids alone do NOT force a wallet migration.

**OUT:** the min-age-exclude *removal* (separate PR after rc.2 ages 7 days); marketplace/npm publishing; any mainnet-shaped act; the Cloudflare dashboard (user-owned).

## Main plan (cheap-fail-first; drift EXPECTED, redeploy in-arc)

### Phase 1 ✓ — Bump + install + typecheck

1. `bunfig.toml`: add the rc.2 `@aztec/*` names + `@alejoamiras/aztec-standards` + `@alejoamiras/aztec-fee-payment` to `minimumReleaseAgeExcludes` (dated + removal-follow-up comment).
2. Re-key both patches (`rc.1`→`rc.2`) + the `patchedDependencies` keys.
3. Bump the ~20 `@aztec/*` pins in the 7 package.json (leave `@aztec/viem`); bump `@alejoamiras/aztec-accelerator` → `5.0.0-rc.2`; **switch the 8 Wonderland pins** to `@alejoamiras/aztec-standards@5.0.0-rc.2` / `@alejoamiras/aztec-fee-payment@5.0.0-rc.2` + rename the import specifiers in the 16 TS files.
4. Delete `bun.lock` → `bun install`. **Allowlist + no-mixed-set diff:** `git diff bun.lock` shows ONLY `@aztec/*`, `@alejoamiras/{aztec-accelerator,aztec-standards,aztec-fee-payment}`, and the removed `@(defi-)?wonderland/*` URL entries (+ any intended) — AND assert **zero `5.0.0-rc.1` entries remain** (`rg -c '5\.0\.0-rc\.1' bun.lock` = 0), proving no mixed set. Investigate any non-Aztec `^`-range jump before proceeding.
5. `bun run typecheck:all`.

**Validation gate** — Commands: `bun install` (patches apply, min-age holds on non-excluded) · `git diff bun.lock` allowlist check · `bun run typecheck:all`. Pass: install clean, lockfile diff Aztec-only, `typecheck:all` exit 0. **Fast-fail:** non-mechanical type churn (a removed API we consume) → `/codex` triage → escalate. Layers: install · typecheck.

### Phase 2 ✓ — Units · Noir recompile · SHIFT INVENTORY (drift expected — CONFIRMED TOTAL)

1. `bun run test:all` (units) — fix only mechanical fallout, documenting each; the 3 schema-patch guards throw here if the RPC shape moved. **The PrivateFPC tripwire test is EXPECTED to fire** under the rc.2 artifacts — re-pin its expectations to the newly-derived values as the *conscious act* its docstring demands, with the live proof owed by Phase 3's re-canary (do NOT weaken or skip the test).
2. **Noir:** bump `compile.sh`'s rc.1 CLI toolchain pin + **add `keystone` to its compile loop** (`compile.sh:23` loops only `token_minter_proxy token_bridge` — codex-final HIGH #3) + the 5 Nargo tags to `rc.2`; recompile all 3; commit the re-derived `target/*.json`.
3. **SHIFT INVENTORY** (was the drift gate): run (a) `bun run --cwd apps/faucet verify:deployments` — **expected RED** against the old live pins; (b) the full-surface class-id/address compare (one-shot script; codex-final HIGH #2): old→new for **bridge · token_minter_proxy · keystone · token · dripper · SponsoredFPC (`sponsored-fpc.ts:20`) · PrivateFPC · FeeJuice/AuthRegistry constants**. Write the complete inventory to `lessons/phase-2.md` — it is Phase 3's redeploy checklist. (If, against expectation, NOTHING shifted: skip Phase 3, note it, jump to Phase 4.)
4. `bun run lint` + the builds: `bun run build:chrome && build:firefox && build:faucet` (root) **+** `bun run --cwd apps/playground build && bun run --cwd apps/landing build`. (CI's faucet build stays red until Phase 3 re-pins — local `build:faucet` itself doesn't run `verify:deployments`.)

**Validation gate** — Commands: `test:all` · the Noir recompile · the shift-inventory script · `lint` · the 5 builds. Pass: all exit 0 (with the tripwire consciously re-pinned, not silenced) AND the old→new identity inventory is complete in lessons. Layers: unit · contract-compile · derivation-inventory · lint · build.

### Phase 3 ✓ — TESTNET REDEPLOY + re-pin + live re-canary (user-authorized at the gate)

1. **Pre-flight:** confirm the target testnet actually runs rc.2 (node info / rollup version against `chain-constants.ts`); capture the new `TESTNET_ROLLUP_VERSION` if the reset bumped it (the wallet chainId derives from it — the "No network configured for chainId" failure mode from the release runbook). Confirm deployer keys/env are funded (L1 Sepolia + L2 fee) — **surface to the user if not; do not mint/rotate credentials.**
2. **L1 (guarded fuel topology — codex-delta HIGH#3):** re-derive the rc.2 rollup's Aztec-side constants (FeeJuice, FeeJuicePortal, FeeAssetHandler — from the new registry) → update the Solidity pins → **use `DeployFuelLive.s.sol` (guarded seeding, `:83-100`) with explicit seeding flags for the live fuel/pool topology — NOT `DeployBridge.s.sol`, which seeds pools unconditionally (`:154-201`) and is not the live AZLO topology** — then pass `FUEL_ROUTER`/`FUEL_SWAP` into `deploy-bridge-testnet.ts` (`:326-339`). `verify-l1.ts` green.
3. **L2 — CANDIDATE-FIRST (codex-delta HIGH#1, the script's own design):** `deploy-bridge-testnet.ts` writes `testnet-bridge.candidate.json` (`:368-396`) — do NOT hand-promote. **First close the manifest gap (codex-delta HIGH#2): `CandidateManifest` has no `feeJuice` field (`deploy-manifest.ts:32-38`) and the writer emits only usdc/portal/token/fuel — promoting as-is would DROP the faucet's direct-Fuel config (`bridge-deployments.ts:53-63`, `useFuel.ts:75-77`). Extend the manifest+writer to carry `l1.feeJuice`.** Then: faucet `deploy.ts` (dripper + NULO/OLUN, idempotent), PrivateFPC per the fee-payment flow (`check-fpc-version.ts`).
4. **Candidate smokes → PROMOTE:** `verify-l1 --config` + `smoke-existing-testnet --config` + the fueled candidate smoke against the **candidate** manifest; only when green, promote candidate → live pins: `deployments.json`/`deployments.ts`, `bridge-deployments.ts`, `sponsored-fpc.ts` (re-derived), any Solidity/env stragglers. **ChainId cascade if the rollup version moved (codex-delta MED#1):** faucet `chain-constants.ts` + `chain-info.test.ts:7-9`, extension `network/service.ts:77-82` + `components/ui/utils.ts:5-8`. Assess the client-side storage version (account-derivation change? → bump + document-the-reset; class-ids alone → no migration).
5. **Live re-canary (post-promotion):** `bun run --cwd apps/faucet verify:deployments` **GREEN on the new pins** · `smoke-existing-testnet.ts` (public bridge settles) · the `fuel-testnet.ts` private-FPC variant (a private fueled claim SETTLES — proving the Phase-2 tripwire re-pin) · a faucet drip works.

**Validation gate** — Commands: `verify-l1.ts` · `verify:deployments` · `smoke-existing-testnet.ts` · `fuel-testnet.ts` (private variant) · a drip. Pass: all green against the LIVE rc.2 testnet — the world and the pins agree again. Layers: live-testnet deployment · derivation · live canary. **Failure here = STOP + surface** (never retry a live deploy loop blind; 5-failure hard stop per the retry policy).

### Phase 4 ✓ — Native-proving network-e2e (the protocol proof)

1. Open the PR with `e2e:network` + `e2e:smoke` labels (or `bun run e2e:agent` locally). The accelerator (`v1.0.6`) proves rc.2 via **`BB_BINARY_PATH` injected from `setup-aztec`** (which detects the SDK version from the extension package `_network-e2e.yml:193-198`, `setup-aztec/action.yml`), so bumping the extension to rc.2 makes it prove with rc.2 bb — **no accelerator bump expected.**
2. **Only if** network-e2e fails specifically on proving (the injected bb can't drive rc.2): fall back to `@alejoamiras/aztec-accelerator@5.0.0-rc.2` — fetch the tarball, re-derive the EXTRACTED-binary SHA locally, update `version` + `expected_sha256`. (Confirm the release exists first; it's ~1 day old but name-excluded from min-age.)
3. Update stale `rc.1` refs (bunfig comment, `_network-e2e.yml` comment, docs).

**Validation gate** — Commands: the PR's `network-e2e-status` (native proving, `VITE_NULO_ACCELERATOR_REQUIRED=1` → silent-WASM = hard fail) + `smoke-e2e-status` + `quality-status`, all green. Pass: network-e2e green proving rc.2 txs; no stale `rc.1` ref. Layers: e2e-live-network · smoke · quality.

## Competing outline (risk-first) — REJECTED (see ledger)

**Network-canary spike FIRST:** bump + recompile + prove ONE native canary tx before the full gate investment; stop early if the protocol mismatches. **Rejected:** type/install churn is the modal failure for a 187-commit bump (caught cheaply in Phase 1); the audits reframed the *real* early risk as **derivation drift**, which Phase 2's `verify:deployments`/PrivateFPC detectors catch *before* the expensive network-e2e — so the main plan already front-loads the true risk without a bespoke sandbox spike.

## Assumptions

**Facts** (verified):
1. `@aztec/*` is `5.0.0-rc.1` across **7 package.json** (extension 19 · faucet 15 · playground 7 · aztec-runtime 10 · bridge-core 9 · wallet-bridge 4 · wallet-crypto 1; landing + wallet-core = 0). `@aztec/viem` is `2.38.2` (independent).
2. The 2 patches touch only `package.json` (add `exports` maps) — robust to noir source churn; re-key is mechanical.
3. **network-e2e fresh-deploys contracts** — `apps/extension/tests/e2e/fixtures/aztec.ts:108-121` (`deployWithOpts().send()`, address from the instance) + `global-setup.ts:348,522`; no hardcoded live addresses as inputs. A class-id shift can't brick the *network* gate (Opus + codex confirmed).
4. **The LIVE path is a separate gate that drift DOES break** — `verify:deployments` re-derives live instances from pinned params (`verify-deployments.ts`, `bridge-deployments.ts:76`, `deployments.ts:68`) and runs in the faucet build CI (`_build-faucet.yml:36`, `audit:faucet`). The PrivateFPC bytecode tripwire (`private-fuel.test.ts:24-25`) fires on the same change class (codex Crit #1/#3).
5. The Noir contract source is **git-tag-pinned rc.1** (5 tags in 3 `Nargo.toml`) and the compile **toolchain is rc.1-pinned** (`compile.sh:4-9`); `keystone` has no committed `target/` (Opus HIGH #1/#2, codex Crit #2).
6. bb for native proving is injected via **`BB_BINARY_PATH` from `setup-aztec`** (SDK-version-detected from the extension package), NOT auto-fetched by the accelerator (`_network-e2e.yml:193-198`) — so the extension bump drives the proving version (codex High #4).
7. rc.1→rc.2 = 187 commits with `!:` breaks (checkpoint-sync RPC, `proposedCheckpoint` removal, Noir `for_each` order) — zero refs in our TS/Noir.
8. Real gates exist: `typecheck:all`, `test:all`, `lint`, `build:{chrome,firefox,faucet}` (root) + `--cwd {playground,landing} build`, `verify:deployments`, `e2e:agent`/CI `network-e2e-status`.

**Inferences** (unverified — attack these):
- rc.2 does NOT drift our contract class-ids/derivation (the breaks are node-internal). **Phase 2 tests this empirically via `verify:deployments` + the PrivateFPC tripwire; a shift → hard stop + escalate.** This is the whole pivot of the plan.
- The 2 patches still apply to rc.2 (package.json-only; rc.2 unlikely to have fixed the packaging). Phase 1 verifies.
- The `v1.0.6` accelerator + rc.2-injected bb proves rc.2 txs (Phase 3 tests; rc.2 accelerator is the fallback).
- A full `bun.lock` delete won't silently bump a non-Aztec `^` range past intent — mitigated by the Phase-1 allowlist diff (codex Med).

**Asks** (resolved — no silent assumptions):
- Network gate → **gate on native-proving network-e2e.** *User.*
- Redeploy → **out of scope in the no-drift case; a drift COUPLES it to the bump → hard stop + `deep` follow-up** (the audits showed "redeploy→follow-up" is unsound under drift; **surfaced for re-confirmation at the gate**). *User answered "redeploy→follow-up"; the drift-coupling is the audit correction.*
- Tier → **mid + hard drift-escalation.** *User: mid.*
- Breakage absorption → mechanical inline; escalate on non-mechanical churn OR any drift.

## Security & Adversarial Considerations

- **Threat surface:** a version bump of the wallet's protocol SDK + Noir toolchain. Attack surface = **supply-chain** (fresh rc.2 packages + the accelerator binary + the aztec-nr git tags) and **protocol/derivation correctness**.
- **Supply chain:** rc.2 is temporarily min-age-excluded — the exact class the gate catches. Mitigations: exact-pin every `@aztec/*` (no `^`), the **Phase-1 lockfile allowlist diff** (a full re-resolve can move non-Aztec ranges — codex Med), committed `bun.lock`, `--frozen-lockfile` CI, tracked exclude-removal. The aztec-nr git tags are pinned by tag (a moved upstream tag would change the compiled output — the committed `target/*.json` diff is the tripwire). The accelerator binary stays SHA-256-pinned on the extracted binary; a bump re-derives locally (codex notes: no provenance vs first-download compromise — accepted, it's a known binary-dep limitation per `SECURITY.md`).
- **Protocol/derivation (crypto):** we roll nothing. The native-proving network-e2e (`VITE_NULO_ACCELERATOR_REQUIRED=1`) guards a silent WASM fallback. `verify:deployments` + the PrivateFPC tripwire guard a silent derivation drift (a class-id change that would strand live funds) — Phase 2 makes them hard blockers, so no half-migrated on-chain state is created.
- **Least privilege / input validation:** unchanged; the 3 `registerToken` schema-patch guards fail-closed (throw at init) if the RPC shape moved.

## Post-implementation hardening

None scheduled. The in-arc redeploy is covered by the post-impl codex audit + the live re-canary gate (the `fuel-portal-v5-fix` precedent — no `/harden` for a scripted testnet redeploy); no new credentials or trust boundaries are created. A future *mainnet*-shaped deployment arc would warrant `/harden security`.

## Decision ledger

- **Main plan (cheap-fail-first) over risk-first canary** — type/install churn is the modal early failure; the audits reframed the true risk as derivation drift, already front-loaded by Phase 2's `verify:deployments`/PrivateFPC detectors (cheaper than a sandbox canary spike).
- **DRIFT IS A HARD BLOCKER** (codex Crit #1, verified: `verify:deployments` in `_build-faucet.yml:36` + the PrivateFPC tripwire) — reversed the original "assess + flag + continue." **Then resolved at the gate by the user the other way: the shift is EXPECTED and the redeploy is IN-ARC** ("class-ids will shift, we will need to redeploy everything — it's part of the plan"). Phase 2 = shift inventory; Phase 3 = redeploy + re-pin + live re-canary. Tier stays on the thrice-audited `mid` base + ONE focused codex pass on the redeploy delta (full `deep` fan-out would mostly re-audit hardened ground; the redeploy follows the exercised `fuel-portal-v5-fix` runbook + repo scripts).
- **Noir toolchain + tags in scope; commit re-derived artifacts** (codex Crit #2 + Opus HIGH #1/#2) — recompiling against rc.1 aztec-nr would be a false "no drift"; the `target/*.json` diff is the drift tripwire, so it's committed (compiled output, not an on-chain act).
- **Accelerator: no bump expected** — bb is `BB_BINARY_PATH`-injected from `setup-aztec` (codex High #4 corrected the "auto-fetch" fact); rc.2 accelerator is the fallback only.
- **Lockfile allowlist diff added** (codex Med) — a full re-resolve can move non-Aztec ranges.
- **`bun.lock` delete+reinstall over per-pkg `bun update`** — Bun #25305.

### Audit verdicts (Round 1)
- **Codex (`019f1d5e`): `reject`** — drift-as-follow-up unsound (verify:deployments blocks); rc.1 toolchain/artifact pins omitted; Phase 2 gates not concrete; accelerator mechanism + build commands wrong. **All folded above.** (`audit-codex.md`)
- **Fable/Opus (`a721d6e…`): `conditional approve`** — confirmed the fresh-deploy pivot (Inference/Fact 3); HIGH Nargo-tags + artifact-entanglement, MED schema-patch guards + accelerator-age, LOW count + storage-migration. **All folded above.** (`audit-fable.md`)
- **Final fresh-context codex pass (`019f1d67`): `conditional approve`** — 4 conditions, ALL folded: (HIGH#1) bump the `@alejoamiras/aztec-accelerator` **npm package** rc.1→rc.2 (it drags rc.1 `@aztec` transitives → mixed-set; `bun.lock:309`) + assert no rc.1 `@aztec/*` remains; (HIGH#2) make the drift check a **concrete full-surface class-id/address compare** (verify:deployments covers only dripper/NULO/OLUN); (HIGH#3) `compile.sh` explicitly add `keystone` to the loop; (MED) ledger the Wonderland `.tgz` pins — decision evolved at the gate: "leave-pinned" → bump via tgz/build-from-SHA → **FINAL: the user took over both packages and publishes them as `@alejoamiras/aztec-standards@5.0.0-rc.2` + `@alejoamiras/aztec-fee-payment@5.0.0-rc.2` on npm** (verified: published 2026-07-02, rc.2 peers, no hard deps). 8 pins + 16-file import rename — see Scope. Also: this re-verification round caught that two earlier greps (import surface + a Fact #7 spot-check) had used a malformed `rg --include` flag with stderr swallowed; both re-run with correct syntax — Fact #7 (zero breaking-symbol refs) **holds**, the import surface is genuinely 16 files. Codex "looks fine": drift→hard-stop is the right default; committing re-derived `target/*.json` is build-input not an on-chain act; the schema guards / lockfile allowlist / build commands / `BB_BINARY_PATH` fact are materially improved. (`audit-codex.md` Round 2)

## Seeds

(Finalized post-approval. The **scripted testnet redeploy is user-authorized at the gate** — it is NOT covered by the generic "never deploy" hard limit; that limit still bans npm/marketplace publishing, main/release merges, and anything mainnet-shaped.)

```
/loop 15m Drive implementations-plan/aztec-5.0-rc2 forward. Never idle. Each firing: read plan.md + lessons/; git status; if a PR exists gh pr view --json statusCheckRollup. Pick the next pending phase; run its gate (P1: bun install + bun.lock allowlist/no-rc.1 diff + typecheck:all; P2: test:all [PrivateFPC tripwire re-pinned consciously, never silenced] + Noir recompile [compile.sh toolchain + keystone in loop + 5 Nargo tags] + shift-inventory script + lint + 5 builds; P3: TESTNET REDEPLOY — pre-flight network=rc.2 + funded keys [missing keys → surface, don't create], forge L1 portals via DeployBridge.s.sol re-pins, L2 deploy.ts + deploy-bridge-testnet.ts + PrivateFPC, re-pin deployments.json/ts + bridge-deployments.ts + sponsored-fpc.ts + chain-constants.ts, then verify-l1 + verify:deployments + smoke-existing-testnet + fuel-testnet private variant + a drip ALL GREEN LIVE; P4: network-e2e via CI labels). Phase green → mark ✓, file lessons/phase-N.md, print LESSONS_FILE=…, advance. A LIVE deploy step failing → fix forward carefully; 5 failures on one step → STOP + surface (never blind-retry live deploys). Decisions / non-mechanical churn → /codex xhigh, log verdict, act. Hard limits: never merge to main/release; never publish npm/marketplaces; the scripted rc.2 TESTNET redeploy IS authorized; nothing mainnet-shaped; never remove the min-age exclude here; never create/rotate credentials. All phases ✓ → /code-review max --fix → commit → codex post-impl audit → address high/critical → open PR (labels e2e:network + e2e:smoke) → report + stop.
```

```
/goal All phases in implementations-plan/aztec-5.0-rc2/plan.md marked ✓ (per-phase headers), each backed by its validation gate reported passing in the transcript — including Phase 3's LIVE gates (verify-l1, verify:deployments on the NEW pins, smoke-existing-testnet, the fuel-testnet private-FPC canary, a drip) all green against the rc.2 testnet; for each phase LESSONS_FILE printed; /code-review max --fix complete + committed; codex post-impl audit complete with high/critical addressed; bun run typecheck:all, bun run test:all, bun run lint exit 0; the PR's network-e2e-status green in the transcript.
```
