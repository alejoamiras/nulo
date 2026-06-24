# Vitest → Vite 8 dedupe (one Vite in the tree)

**Tier:** `mid` · **Status:** revised post-dual-audit + final codex (conditional approve, folded) + user review → mechanism switched to the declarative **override** (surgical lockfile edit dropped as brittle); footgun fix folded into scope. No re-audit needed — the override + test-script fix were both already audit-endorsed; this de-risks within scope. · **Branch (planned):** `deps/vitest-vite8-dedupe` off `dev`

## Summary

After PR #166 all four apps **build** on `vite@8.0.11`, but the repo still resolves a second `vite@7.3.2`. The dual audit reshaped the fix — two causes, two *different* remedies:

1. **Vitest** (`vitest@4.1.5`, dep range `vite: ^6 || ^7 || ^8`) got a **nested `vite@7.3.2`** even though it accepts vite 8 — a bun **dedup miss**. This is the meaningful half: every test suite runs on a *different* Vite than builds use. Fix: **dedupe** (surgical lockfile edit; override fallback).
2. **Dev-only Vue devtools chain** — `vite-plugin-vue-devtools@8.1.1` (+ its transitives `vite-plugin-inspect`, `vite-dev-rpc`, `vite-hot-client`, which carry the other four `vite@7.3.2` copies). **Codex caught that this dependency is UNUSED** — it is declared in `packages/extension/package.json:106` but imported in **zero** vite configs (`vite.config.ts`, `vite.chrome.config.mts`, `vite.firefox.config.mts`); the only other reference is a stale comment in `packages/extension/src/assets/styles/_base.scss:4`. Fix: **delete the dead devDependency** — which evicts the whole chain + its `vite@7.3.2` for free. A supply-chain *reduction*, not four version bumps.

**Goal (user-set bar = BOTH):** exactly one Vite (`8.x`) physically in `node_modules` AND zero `vite@7` in `bun.lock`, AND every test suite green, AND app builds unaffected.

## Why `mid`

Rubric (HIGH count): novelty LOW, blast radius **MODERATE** (touches the test runner used by all **11** `@nulo/*` packages — 10 of which have suites; `@nulo/playground` has none), irreversibility LOW (revert manifest/lockfile), migration cost LOW, external coupling LOW, security sensitivity LOW–MODERATE (supply-chain). One MODERATE → `mid`. User confirmed `mid`.

## Root-cause evidence (verified this session)

| Item | State now | Vite range | Remedy |
|---|---|---|---|
| vitest | 4.1.5, nested `vite@7.3.2` (`bun.lock:2774`) | `^6 \|\| ^7 \|\| ^8` (accepts 8) | dedupe onto hoisted `8.0.11` |
| vite-plugin-vue-devtools | 8.1.1, **UNUSED** (no import in any vite config) | — | **delete the devDependency** |
| vite-plugin-inspect / vite-dev-rpc / vite-hot-client | pinned vite-7-only; carry 4× `vite@7.3.2` | exclude `^8` | removed transitively when devtools is deleted |

Physical `vite@7.3.2` copies (on-disk `find`): `node_modules/{vitest,vite-plugin-inspect,vite-dev-rpc,vite-hot-client}/node_modules/vite`. Hoisted `node_modules/vite` = `8.0.11`. Deleting `vite-plugin-vue-devtools` removes the last three; deduping vitest removes the first.

**Test-runner facts (audit-verified):** root `test:all` = `bun run --filter '@nulo/*' --if-present test` runs each package's own `test`. Only `@nulo/extension`'s `test` is bare `vitest` (watch mode); all others are `vitest run`. `extension/vitest.config.ts:32` *re-includes* the tests of `wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge`, so `test:all` **double-runs** those five. `vitest` only avoids the watch hang when `CI` is truthy → **Phase 1(b) fixes this** by changing extension's `test` to `vitest run`, after which `bun run test:all` is hang-free with no `CI=true` prefix.

## Chosen approach (audit-resolved)

The original "two competing outlines" (overrides pin vs re-resolve) were resolved by the dual audit — see the Decision Ledger. Net:

- **Devtools half → DELETE** `vite-plugin-vue-devtools` (it's dead). Remove the stale `_base.scss` comment too.
- **Vitest half → declarative override**: add `"overrides": { "vite": "^8.0.0" }` to root `package.json`, then `bun install`. This is a hard constraint bun honors — it pins every `vite` consumer (incl. vitest's `^6||^7||^8`) to resolve within `^8`, deterministically collapsing the nested `vite@7.3.2` onto the hoisted 8.x. Range (not exact-pin) so 8.x patches keep flowing and Renovate isn't frozen (Sonnet M3); caps at `<9` as a deliberate floor. Collateral-free: post-deletion the vite consumers are the apps (want ^8), vitest (accepts 8), and dev-only Storybook (`@storybook/vue3-vite`) + `@crxjs/vite-plugin` — all accept vite 8. (Surgical `bun.lock` hand-editing was rejected as brittle — ledger D2. Bumping vitest does NOT help: latest 4.1.9 still allows `^7`.)

## Phases

### Phase 1 — ✓ DONE — Delete the unused devtools dependency + fix the test-script footgun
(a) Remove `"vite-plugin-vue-devtools"` from `packages/extension/package.json` devDependencies (evicts the chain + 4× `vite@7.3.2`); remove the stale `_base.scss:4` comment. (b) Change `@nulo/extension`'s `test` script `vitest` → `vitest run` — it's the only watch-mode one in the workspace, the cause of the `audit:vue`/`test:all` local hang. `bun install` to update `bun.lock`.

**Validation gate**
- Commands: `bun install` → `bun install --frozen-lockfile` (exit 0) · `rg -n 'vite-plugin-vue-devtools|vite-plugin-inspect|vite-dev-rpc|vite-hot-client' bun.lock || echo CHAIN-GONE` (expect `CHAIN-GONE`) · `bun run build` (extension chrome; proves nothing depended on it) · `bun run test:all` (now hang-free — no `CI=true` crutch)
- Pass criteria: devtools chain absent from `bun.lock`; extension build exit 0; `bun run test:all` completes (no watch hang) all green; lockfile diff = removals + the `test`-script line.
- Layers: dependency-tree assertion · build · unit.

### Phase 2 — ✓ DONE — Dedupe Vitest onto Vite 8 via a declarative override
Add `"overrides": { "vite": "^8.0.0" }` to root `package.json`, then `bun install`. The override constrains every `vite` consumer (incl. vitest's `^6||^7||^8`) to `^8`, deterministically collapsing vitest's nested `vite@7.3.2` (+ its `postcss`/`rollup` subtree) onto the hoisted 8.x. It resolves to the highest aged-out 8.x (8.0.11 today; 8.1.0 only if it has aged out — the gate validates whichever; the lockfile-diff review flags any incidental app bump). Surgical `bun.lock` hand-editing was rejected as brittle (ledger D2).

**Validation gate**
- Commands: `bun install --frozen-lockfile` · `test -d node_modules/vitest/node_modules/vite && echo NESTED-STILL || echo OK` (expect `OK`) · "exactly one vite" assertion: `find node_modules -path '*/vite/package.json' -exec sh -c 'echo "$(jq -r .version "$1")  $1"' _ {} \;` then assert a SINGLE `8.x` version (prints owning paths for any stray) · `rg -n '"vite@7' bun.lock || echo NO-VITE7` AND `rg -n '"vitest/vite' bun.lock || echo NO-VITEST-VITE-SUBTREE` (expect BOTH echoes) · `bun run test:all` · `bun run typecheck:all` · `bun run lint`
- Pass criteria: no nested vite under vitest; tree shows a SINGLE `vite@8.x`; `bun.lock` has zero `vite@7` and no `vitest/vite` subtree; test:all + typecheck + lint exit 0; lockfile diff = the `overrides` line + vitest collapsing onto the shared vite (+ a reviewed app 8.x bump iff it occurred).
- Layers: dependency-tree + lockfile assertion · unit (all suites) · typecheck · lint.

### Phase 3 — Full validation + merge readiness
Run the complete gate set, review the final lockfile diff, open the PR.

**Validation gate**
- Commands (builds use real invocations — root aliases where they exist, `--cwd` otherwise):
  `bun run build` (extension chrome) · `bun run build:firefox` · `bun run build:faucet` · `bun run --cwd packages/playground build` · `bun run --cwd packages/landing build` · `bun run typecheck:all` · `bun run lint` · `bun run test:all` · `bun run test:e2e` (smoke) · `bun run e2e:agent` (network) · `bun install --frozen-lockfile` · final `git diff bun.lock package.json packages/extension/package.json` review
- Pass criteria: every command exit 0; smoke + network e2e green; lockfile diff = devtools-chain removals + the single vitest/vite dedupe (+ the `overrides` line iff the fallback was used); no unrelated transitive changes.
- Layers: typecheck · unit · lint · build (all 5 surfaces) · smoke e2e · **network e2e**.

## Security & Adversarial Considerations

- **Supply chain (primary surface).** Deleting `vite-plugin-vue-devtools` *removes* four packages from the tree (net reduction — strictly good). The vitest dedupe adds nothing (it reuses the already-present `8.0.11`). The `overrides` fallback pulls no new package either. After any step, audit the `bun.lock` diff for *unexpected* additions/changes — reject anything outside "devtools-chain removed" + "vitest points at hoisted vite". Threat: a malicious transitive smuggled in under a "dedupe" diff.
- **`overrides` blast radius (fallback only).** Bun `overrides` are **global** (no per-consumer scoping — confirmed). A root `"vite": "^8.0.0"` forces vite for every consumer incl. future-added ones, and Renovate does **not** auto-update `overrides` (it'd manage the `devDependencies` range while the override silently caps resolution). Mitigations: use a **range** (`^8.0.0`) not an exact pin (so 8.x patches still flow), apply it only if the surgical dedupe fails, and document it. Post-deletion the vite consumers are the apps (want ^8), vitest (accepts 8), and the dev-only Storybook (`@storybook/vue3-vite`) + `@crxjs/vite-plugin` (both accept vite 8), so the override is collateral-free today.
- **Lockfile integrity.** `bun install --frozen-lockfile` must stay green in CI; commit `bun.lock`; the diff is the reviewed artifact — keep it minimal and explained.
- **Least privilege / no new surface.** No runtime code, no new network calls, no CI token-scope change. Builds already run vite 8 in prod; this aligns test + (removed) dev tooling.
- **Not applicable:** crypto, authn/authz, input validation at trust boundaries, contract reorg/replay (no contract or runtime-data path touched).

## Assumptions

**Facts** (verified against the repo / npm this session, with evidence):
- `vite-plugin-vue-devtools` is declared (`packages/extension/package.json:106`) but imported in **no** vite config; only other ref is a comment (`_base.scss:4`). → safe to delete. (codex H, re-verified.)
- `vitest@4.1.5` dep range `vite: ^6 || ^7 || ^8`; nested `vite@7.3.2` edge at `bun.lock:2774`; hoisted vite `8.0.11`. Latest published vitest is **4.1.9**, and ALL vitest 4.x keep `vite: ^6 || ^7 || ^8` — **no runner version forces vite 8** (verified npm), so the fix is the override, not a vitest bump.
- Workspace has **11** `@nulo/*` packages; `@nulo/playground` has **no** `test` script; only `@nulo/extension` `test` is bare `vitest` (watch); all others `vitest run`. `extension/vitest.config.ts:32` re-includes 5 packages' tests (→ `test:all` double-runs them).
- vite-8 fact for the fallback: apps declare `vite ^8.0.11`; library packages declare no vite (rely on hoist).
- Real commands: `test:all`, `typecheck:all`, `lint`, `build`/`build:firefox`/`build:faucet` (root aliases), `bun run --cwd packages/{playground,landing} build`, `test:e2e`, `e2e:agent`.

**Inferences** (deduced, unverified — flagged for the final codex pass / impl):
- The `overrides: { "vite": "^8.0.0" }` constraint collapses vitest's nested 7.3.2 onto the hoisted 8.x. This is a hard bun constraint (deterministic) — near-Fact — but the Phase 2 gate still verifies the resulting tree + lockfile. (The surgical lockfile-edit alternative was rejected as brittle.)
- Deleting `vite-plugin-vue-devtools` breaks nothing because it is unwired. *Phase 1's extension build + test:all gate catches any hidden coupling.*
- After Phase 1(b)'s `test`→`vitest run` fix, `bun run test:all` runs every suite (double-running the 5 inlined ones, harmless) without a watch hang and without needing `CI=true`.

**Asks** (user decisions):
- Outline / mechanism — **resolved by the audit** (delete devtools; surgical-dedupe vitest with override fallback); no open user Ask.
- Footgun fix — **RESOLVED: user approved bundling it.** Extension `test` `vitest`→`vitest run` is now Phase 1(b); kills the `audit:vue`/`test:all` local watch-hang repo-wide.

## Decision ledger

- **D1 — Devtools: DELETE, don't bump.** Source: codex High (verified — dep unused). Rejected: original "bump vite-plugin-vue-devtools → 8.1.3 + cascade inspect/rpc/hot-client to vite-8 versions" — unnecessary supply-chain churn on a dead dependency; deletion removes 4 packages + 4× `vite@7.3.2`. Also moots the unverified "11.4.1 cascades vite-dev-rpc@^2" inference (codex M / Sonnet M1).
- **D2 — Vitest: declarative `overrides: { "vite": "^8.0.0" }` (primary).** Source: user pushback (lockfile surgery is brittle) + both audits (the override is the only *deterministic* mechanism for the nesting). Range, not exact-pin (Sonnet M3 — avoids the Renovate freeze; lets 8.x flow, caps `<9` as a deliberate floor). **Rejected: surgical `bun.lock` key deletion** (brittle — fights the very resolver non-determinism it relies on; user-flagged). Rejected: `bun update vitest` (latest 4.1.9 still allows `^7` → does NOT force vite 8; verified npm). Rejected: exact-pin override (Renovate split). Rejected: pin inspect/rpc/hot-client as direct devDeps (moot post-deletion).
- **D3 — Footgun fixed in-scope (user approved):** Phase 1(b) changes extension `test` `vitest`→`vitest run`, killing the `audit:vue`/`test:all` watch-hang repo-wide. Gates therefore use plain `bun run test:all` (no `CI=true` crutch). Accepts the harmless double-run of the 5 inlined suites.
- **D4 — "One vite" verified two ways:** on-disk `find` (printing owning paths) AND `rg '"vite@7' bun.lock` empty. Source: codex Low / Sonnet M5.
- **D5 — Phase-3 builds spelled out** with correct invocation (root aliases + explicit `--cwd` for playground/landing). Source: Sonnet H3.
- **D6 — Network e2e KEPT** despite being heavy for a zero-runtime-surface change (Sonnet M4) — **user explicitly requested smoke + network**. Documented as belt-and-suspenders.
- **Note (Sonnet L2):** local bun is `1.3.13`, pinned/CI is `1.3.14`; bun resolver behavior can differ by version. The surgical-delete + `overrides` fallback are resolver-version-robust; final truth is `--frozen-lockfile` on CI's 1.3.14. Consider running impl on 1.3.14 locally.
- **Unresolved disputes:** none.

## Audit verdicts

- **Codex (xhigh), session `019ef909-86c3-72f3-9186-f37490bee149`:** `reject` — blocking: (1) devtools dep unused → delete not bump; (2) B-first not deterministic for vitest; (3) `test:all` doesn't run each suite once. **All folded** (D1, D2, D3). Mediums/Lows (overrides global, dev-server smoke meaningless, pair find+lockfile, redundant test:faucet) folded into D2/D4 + gate edits.
- **Sonnet Plan subagent (fable unavailable):** `conditional approve` — 5 conditions: (1) state surgical-delete as the vitest mechanism → D2; (2) flag the extension watch-mode footgun → D3 + Ask; (3) verify 11.4.1 cascade before Outline B → mooted by D1; (4) package count 10→11 → fixed; (5) explicit playground/landing build invocations → D5. **All addressed.**
- **Final fresh-context codex pass (xhigh), session `019ef916-ccf9-7c81-a6d6-ad6333f0ff68`:** `conditional approve` — (1, Med) Phase 2 must delete/verify the **full `vitest/vite` subtree** (incl. `vitest/vite/postcss`, `vitest/vite/rollup`) and keep "reuse without re-resolving" an inference; (2, Low) override rationale must name Storybook + `@crxjs/vite-plugin` as vite-8 consumers. **Both folded** (Chosen-approach + Phase 2 gate + Security section). Codex confirmed: the devtools delete is safe (no import in any vite config, Storybook, or browser wrapper; `_base.scss` ref is stale-only), the `CI=true` gate is real, and the 5-build list matches the actual build surfaces.

## Post-implementation hardening

Not warranted — no trust boundary, auth, secret, CI-token, or publishing surface touched; the change is a net supply-chain *reduction*. Covered by per-phase lockfile-diff review + the 7-day min-age gate. No `/harden` scheduled.

## Seeds (DRAFT — finalized after approval)

**Recommended: `/goal`** (completion is transcript-observable: zero vite@7 in tree+lockfile, all suites green).
```
/goal All phases ✓ in implementations-plan/vitest-vite8-dedupe/plan.md, each backed by its validation gate reported passing in the transcript: Phase 1 — `vite-plugin-vue-devtools` deleted + extension `test`→`vitest run`, devtools chain absent from bun.lock, extension build + `bun run test:all` green (hang-free); Phase 2 — `overrides:{vite:^8.0.0}` added, no nested vite under vitest, `find` shows a single vite@8.x, `rg '"vite@7' bun.lock` empty + no `vitest/vite` subtree, test:all+typecheck:all+lint green; Phase 3 — all five builds + typecheck:all + lint + `bun run test:all` + test:e2e + e2e:agent + `bun install --frozen-lockfile` exit 0, lockfile diff reviewed (devtools removals + override + vitest dedupe); each phase printed LESSONS_FILE=implementations-plan/vitest-vite8-dedupe/lessons/phase-N.md; `/code-review max --fix` applied + committed; codex post-impl audit done with high/critical addressed.
```

**Alternative: `/loop 15m`** (fallback; network e2e is long so firings will often be "waiting on CI").
```
/loop 15m Drive implementations-plan/vitest-vite8-dedupe forward. Never idle. Each firing: read plan.md + lessons/ (authoritative), `git status`, `git log --oneline -5`, any open PR `gh pr view --json statusCheckRollup`. Pick the next pending phase; after each edit run `bun run lint` + `bun run test:all` for touched scope; when a phase's gate (as written in plan.md) passes, mark ✓, file lessons/phase-N.md, print LESSONS_FILE=…, advance. Decisions → `/codex xhigh`, log verdict, act. Same step failed 5× → reassess with codex. Hard limits: never merge to main/release, never publish/deploy, never expand scope. All phases ✓ → `/code-review max --fix` → commit → codex post-impl audit → address high/critical → report + stop.
```
