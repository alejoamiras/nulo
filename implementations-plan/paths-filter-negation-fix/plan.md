# Whole-repo CI gating from the dependency graph

**Status:** DRAFT — **5 audit rounds folded** (codex v1/v2 extension; codex + independent opus whole-repo; codex final pass). Converged on **whole-package gating for built targets** (which structurally ends the input-completeness whack-a-mole). One open user decision (the src-nested test/story over-trigger). → approval gate.
**Tier:** `mid` (was `light` — "whole-repo CI gating" raises blast radius to *all* build/test/e2e gates; novelty stays LOW [proven graph-derivation principle] and risk LOW [safe-over-gating + guard test + live validation, fully revertible], so `mid`, not `deep`).

## The problem (diagnosis), with hard proofs

Every `dorny/paths-filter` gate in the repo is a **hand-curated path list that has drifted from the dependency graph** — over-triggering (the negation footgun) AND under-triggering (missing graph packages):

- **Footgun (proven):** `dorny/paths-filter@v4` default `predicate-quantifier: some` makes a bare `!packages/x/**/*.md` match *every file that isn't that md* → the filter is effectively `**`. **16 negation patterns**, all in `pr-quick.yml` (11) + `pr-smoke-e2e.yml` (5); `pr-network-e2e.yml` + `actionlint.yml` have none. Proven on `nulo-release-rehearsal` with our *real* `smoke-surface`: irrelevant file → `smoke_buggy=true`/`smoke_fixed=false`; 40 positive sentinels all matched `smoke_fixed`.
- **Under-gates (real, live today):**
  - `extension-network` omits `packages/{wallet-core,wallet-crypto,extension-messaging}/**` → a `wallet-core` change **does not run required network e2e**.
  - `smoke-surface` positives are a curated subset of `extension/src` (omit `pages/`, `offscreen/`, …) — masked today by the footgun.
  - `pr-quick`'s `faucet` filter = `faucet + design` only → **misses `bridge-core` + `wallet-crypto` + `wallet-core`** → a `bridge-core` change doesn't rebuild the faucet.

**Root cause:** lists maintained by hand, not derived from "what is this gate's target built from."

### The full graph (verified from `package.json` workspace deps, this session)
- **extension** → `{extension, aztec-runtime, design, extension-messaging, wallet-bridge, wallet-core, wallet-crypto}` (7).
- **faucet** → `{faucet, bridge-core, design, wallet-crypto, wallet-core}` (5).
- **landing** → `{landing}` (standalone).
- `bridge-aztec`/`bridge-evm` = Solidity/foundry (no bun build/test gate today); `playground` = the network-e2e dApp harness.

### The 4 filter-using gates
| Workflow | filters | target → graph |
|---|---|---|
| `pr-smoke-e2e` | `smoke-surface` | extension (7) + smoke harness |
| `pr-network-e2e` | `extension-network` | extension (7) + playground + network harness |
| `pr-quick` | `core-foundation`/`aztec-runtime`/`wallet-bridge`/`extension` → `needs-extension-build`; `faucet` → `needs-faucet-build`; `landing` | extension (7), faucet (5), landing (1) |
| `actionlint` | `workflows`/`shell` | n/a (workflow + shell files) — **left as-is** |

## The fix — derive every gate from its target's graph, src-scoped (safe over-gating)

Positive patterns only → **no `!` → no footgun**. `src/**` per graph package + each `package.json` + per-target build/harness inputs. **Honest framing (codex + opus, corrected):** `src/**` excludes the *common* docs (package-root READMEs, top-level `*.md`, plans) but it does **NOT** cleanly exclude docs — there are **~332 src-nested `*.md`/`*.stories.ts`/`*.test.ts` files** (colocated component/unit tests + Storybook stories). So **a unit-test-only or story-only edit under `src/` will run the required smoke + the 25-min network suite.** This is the *safe* direction (over-run, never skip), but it's a real CI-cost decision — see the **Ask** below.

**⚠️ OPEN DECISION (the one genuine user trade-off):** accept the test/story over-trigger (simple, safe, but a test-only PR pays the e2e cost), OR exclude colocated tests/stories via picomatch **extglobs** (`packages/extension/src/**/!(*.test|*.spec|*.stories).{ts,vue}`-style) for a tighter gate. Extglobs are codex-claimed-supported but unverified in our dorny — I'd **prove it in `nulo-release-rehearsal` first** (same throwaway method that proved the footgun) before relying on it. Default recommendation: **accept now** (safe + simple), add the extglob refinement later only if the test/story over-trigger proves annoying.

**Two pattern shapes (the rule that ENDS the input whack-a-mole — final-pass driven):**
- **Built/tested TARGET package** (`extension`, `faucet`, `playground`) → gate on the **whole package** `packages/<target>/**`. This covers `src` + `manifest` + `public` + `scripts` + `vite.*` + **`tsconfig*`** + the e2e harness + `package.json` — every build input, present and future. It **cannot under-gate** (the dangerous direction); it can only over-trigger on the target's own `README` (rare, safe). Git-ignored dirs (`dist/`, `storybook-static/`, `wallet_data_*`) never appear in a PR diff, so they're moot.
- **Dependency LIBRARY package** (`wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge`, `design`; for faucet also `bridge-core`) → `packages/<dep>/src/**` + `packages/<dep>/package.json`. The consumer imports the dep's **`src`** (workspace), transpiled by the *consumer's* build — so the dep's own configs don't affect the consumer's bundle; `src` + `package.json` is the consumed surface, and its `README`/docs stay excluded.
- **Repo-wide build inputs** (all gates): `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, **`patches/**`**.

Applied:
- **`smoke-surface`** = `packages/extension/**` + the 6 extension-dep libs (`src/**`+`package.json`) + repo build inputs + smoke workflow files (`_smoke-e2e.yml`, `_build-extension.yml`, `pr-smoke-e2e.yml`, `.github/actions/{setup-bun,setup-puppeteer}/**`). *(The harness + `vitest.e2e*.config.ts` live inside `packages/extension/**` → covered.)*
- **`extension-network`** = `packages/extension/**` + the 6 dep libs + **`packages/playground/**`** + repo build inputs + network workflow files (`_network-e2e.yml`, `pr-network-e2e.yml`, `.github/actions/{setup-aztec,setup-accelerator-server,setup-bun,setup-puppeteer}/**`).
- **`pr-quick` `needs-extension-build`** (`core-foundation`+`aztec-runtime`+`wallet-bridge`+`extension`) = `packages/extension/**` + the 6 dep libs + repo build inputs. (Resolves the final-pass extension-build-input miss — `manifest.config.ts`/`public/`/`scripts/` are inside `packages/extension/**`.)
- **`pr-quick` `faucet`** (`needs-faucet-build`) = `packages/faucet/**` + the faucet dep libs (`bridge-core`/`wallet-crypto`/`wallet-core`/`design` `src/**`+`package.json`) + repo build inputs + `.github/workflows/_build-faucet.yml`. (`faucet/{index.html,vite.config.ts,public/**,scripts/**,tests/**,tsconfig*}` all inside `packages/faucet/**`.)
- **`landing` — DROPPED (dead filter, no consumer).** Only remove its `!packages/landing/**/*.md` negation (the no-`!` invariant); don't graph-assert it.

### Phase 1 — Re-derive the filters
Rewrite `smoke-surface`, `extension-network`, and the `pr-quick` component/build filters (`core-foundation`, `aztec-runtime`, `wallet-bridge`, `extension`, `faucet`, `landing`) from the graphs above. **Zero `!` patterns remain anywhere.**
- **Validation gate** — `bun run lint:actions` exit 0; `grep -rn "- '!" .github/workflows/` → nothing; diff is filter-only. Layers: workflow-lint.

### Phase 2 — One repo-wide guard test (anti-drift) — AND wire it into CI
`bun:test` at **`scripts/ci-cd/behavior-gating.test.ts`** (matches the existing `scripts/ci-cd/` + `scripts/release/` convention — opus #5). Parse with **`Bun.YAML.parse`, two-level** (parse the workflow, then re-parse the `with.filters` block string — it's YAML embedded in YAML; **never regex** — opus #2, zero new deps). Assert against a structured `{ target → transitive graph }` map computed from `package.json` walks, **for the REAL gated surfaces only** (extension → smoke/network/`needs-extension-build`; faucet → the `faucet` filter; **NOT landing** — dead filter, codex):
1. **Graph coverage** — every real gate contains, for each package in its target's transitive graph: the **TARGET** as `packages/<target>/**` (extension→smoke/network/`needs-extension-build`; faucet→`faucet`; playground→network), and each **dep lib** as `packages/<dep>/src/**` + `package.json`. (Whole-package for targets means the guard need not enumerate per-target input files — they can't drift out of a `**`.)
2. **No footgun ever** — **zero** `!`-prefixed patterns in ANY `changes` filter, repo-wide (incl. the dropped landing filter).
3. **Cross-cutting entries** — assert the shared must-haves: all gates → `patches/**` + root inputs (`package.json`/`bun.lock`/`bunfig.toml`/`tsconfig.json`); smoke → `_smoke-e2e.yml`/`_build-extension.yml`/`pr-smoke-e2e.yml`/`setup-{bun,puppeteer}`; network → `_network-e2e.yml`/`pr-network-e2e.yml`/`setup-{aztec,accelerator-server,bun,puppeteer}`; faucet → `_build-faucet.yml`.
4. **🚨 Wire it into CI (opus #1 — blocking):** add a root script `"test:ci-gating": "bun test scripts/ci-cd/"` and a **guarded step in `_unit-tests.yml`** mirroring the existing `test:release` step (`if [ -d scripts/ci-cd ]`). Without this the guard never runs on a PR and the whole anti-drift mechanism is hollow.
- **Validation gate** — `bun run test:ci-gating` green; deleting any required entry or adding a `!` makes it fail; **and `_unit-tests.yml` contains the `test:ci-gating` step** (assert the wiring exists, not just the test). Layers: unit + workflow-presence.

### Phase 3 — Live validation (proof on the real gates)
After Phase 1 merges to `dev`, read `Detect changes` outputs on throwaway PRs:
- **Doc/plan PR** (top-level `*.md` / `implementations-plan/**`): all gates false → all skip.
- **Extension sentinels**: each of the 7 packages' `src/` (esp. `wallet-core`/`crypto`/`messaging` → **network fires**, the live hole closed) + `extension/src/{pages,offscreen}`, `patches/x.patch`, `playground/vite.config.ts`, `tests/e2e/helpers/x.ts` → smoke+network fire.
- **Faucet sentinel**: `packages/bridge-core/src/x.ts` → `needs-faucet-build` true (the faucet hole closed); **not** smoke/network.
- **Landing sentinel**: `packages/landing/src/x.ts` → landing build only.
- **Honest over-gate check**: `packages/extension/src/wallet/services/execution/README.md` → smoke true (documented safe over-gating).
- **Package-root README**: `packages/wallet-core/README.md` → all false (common docs excluded).
- **Validation gate** — `Detect changes` shows the above per gate. Layers: live-CI.

### Phase 4 — Document the principle
`CI.md` + `.github/README.md`: the gates are derived from each target's dependency graph, src-scoped (safe over-gating); never a bare `!` (dorny `some`-footgun); the guard test enforces it.
- **Validation gate** — `bash scripts/check-no-brand.sh` clean; the note names the graph + footgun + guard. Layers: docs.

## Security & Adversarial Considerations
- **Threat model**: under-gating a **required** suite (`smoke-e2e-status`, `network-e2e-status`) — a behavior change silently skipping it. The graph-derivation + guard test mean coverage is *computed*, not hand-typed, and CI fails if a dep is added ungated. Net: strictly more honest than today (where `wallet-core` skips network e2e). Build-skip gates (extension/faucet/landing) are not required checks; their failure mode is only a missed/wasted build (safe).
- **Over-gate is the safe direction**: src-scoping/whole-harness may run a suite that wasn't strictly needed — wasteful, never unsafe.
- **Least privilege / supply chain**: workflow YAML + one test; no token/permission/secret/action-pin changes; `dorny/paths-filter@v4` unchanged.

## Assumptions
**Facts (verified):**
- 4 filter-using workflows; 16 negations in pr-quick(11)+pr-smoke(5); pr-network+actionlint clean (grep, this session).
- Graphs: extension(7), faucet(5: +bridge-core/wallet-crypto/wallet-core), landing(standalone) (package.json walk).
- Live under-gates: network omits wallet-core/crypto/messaging; `faucet` filter omits bridge-core/wallet-crypto/wallet-core (reads of the workflows).
- `dorny@v4` default `some`; `!p` matches the complement (codex + rehearsal proof).
- `smoke-e2e-status` + `network-e2e-status` required on dev+main; faucet/landing builds are NOT required checks.
**Inferences (Phase 3 settles):**
- The per-target surface (graph `src/**` + package.json + build/harness inputs + patches) covers all behavior; `src/**` is safe over-gating (common docs excluded, src-nested docs over-trigger). *Sentinels confirm.*
**Asks (resolved):** include pr-quick build filters = **yes** (user); whole-repo scope = **yes** (user); doc-handling = src-scoped safe over-gating; smoke+network stay required. *(No open Asks; tier bumped light→mid, confirm at gate.)*

## Post-implementation hardening
The Phase 2 guard test IS the hardening. No `/harden` pass.

## Decision ledger
- **Derive every gate from its target's transitive graph, positive-only.** Kills the footgun by construction; closes the network + faucet under-gates; one guard test prevents re-drift repo-wide.
- **Whole-package for built targets, `src/**` for dep libs (final-pass convergence).** Gating `extension`/`faucet`/`playground` as `packages/<target>/**` can't under-gate a build input (tsconfig/manifest/public/scripts/vite all covered) — it ended the 5-round input whack-a-mole. Deps stay `src/**`+`package.json` (only their `src` is consumed). Cost: a target's own README over-triggers (rare, safe).
- **Safe over-gating, stated honestly** — `src/**` includes src-nested docs/stories/tests; errs toward running a required suite.
- **Whole-repo (user)**: extension (smoke/network/build), faucet build, landing build — each on its own graph. `actionlint` left as-is (workflow/shell gate, no graph).
- **Supersedes "delete the negations" + "extension-only"** — the throwaway proof + graph research showed the curated lists themselves (repo-wide) were the problem.
- Folded codex v1 (6 findings: whole-harness, playground inputs, patches, safe-over-gating honesty, stronger guard, faucet under-gate) + v2 (3: setup-puppeteer, exact guard entries, ledger wording).

## Audit verdicts
- **Codex (extension scope, v1 `019f04e5`):** reject → 6 findings, all folded.
- **Codex (extension scope, v2):** conditional approve → 3 findings, all folded; "no remaining silent-skip path."
- **Codex (whole-repo re-pass):** _reject_ → (1) faucet inputs incomplete (`index.html`/`scripts/**`/`tests/e2e/**`/`public/**`/`vite.config.ts`/`_build-faucet.yml`); (2) **landing is a dead filter** (no consumer) — don't gate it; (3) guard must follow real gates only. Graphs confirmed correct. **All folded.**
- **Opus-Plan (independent, whole-repo):** _conditional approve_ → all 3 graphs independently re-verified correct; **[BLOCKING] the guard test is never run in CI** (wire `test:ci-gating` into `_unit-tests.yml`); use `Bun.YAML.parse` two-level not regex; the src-nested over-trigger is ~332 files (test/story edits run the required suites) — state honestly + decide; `scripts/ci-cd/` not `scripts/ci/`. Q2: **no remaining under-gate of a required suite** once additions land + guard wired; `main` PRs un-dodgeable. **All folded.**
- **Codex (final fresh-context pass, consolidated):** _reject_ → 3 input-completeness gaps (per-package `tsconfig.json` skips smoke/network/faucet; the guard's "exact entries" omitted inputs Phase 1 adds; `needs-extension-build` still missed `manifest.config.ts`/`public/`/`scripts/`). **Diagnosis: input whack-a-mole → resolved structurally** by gating built TARGETS on whole `packages/<target>/**` (covers tsconfig + manifest + public + scripts + every input, can't under-gate) while deps stay `src/**`+`package.json`. This dissolves all 3 findings + the per-suite-list drift; the guard simplifies to "target=`/**`, dep=`/src/**`+`package.json`". Whole-package is safe-by-construction for under-gates (only over-triggers, on a target README), so no further hostile re-audit is warranted — Phase 3 live validation + the wired guard are the empirical net.

## Seeds
*(Finalized after approval — see eli5.html.)*
