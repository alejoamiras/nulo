# Dependency refresh (in-range minor/patch, min-age-respected)

**Tier:** `light` · **Status:** ▶ IN PROGRESS — push-through (user, 2026-06-25): ONE consolidated PR updating everything, full suite run on it. **The 2-stage libs/tooling split proved mechanically impossible** — every Bun mechanism either pollutes root `package.json` (`bun update <list>`), only touches root (`bun update`), re-hoists and breaks under-declared deps (`rm bun.lock`), or refreshes each child's deps *broadly* (per-child). The working mechanism is per-child `(cd packages/<x> && bun update)`, which refreshes libs **and** tooling together — so Phases 1+2 collapsed into **one refresh** (✓ done + green: frozen 0, **186/186 ≥7d**, typecheck:all/lint/test:all 0). Phase 3 (builds + e2e + PR) next. · **Branch:** `deps/refresh` off `dev`

## Summary

A routine lockfile refresh — **not** a migration. The premise that triggered this (zod → v5) is moot: **zod has no v5** (latest `4.4.3`; the repo is already on it via `zod ^4`, as is `@aztec/*`). A full `ncu` sweep of every package shows the **only** major available is `@types/node` 24→26, which CLAUDE.md policy **caps at `<25`** (skip). Everything else is **minor/patch within the same major**, and **already inside the existing `^` ranges** — so `bun update` (no manifest edits) pulls them in, and bunfig's `minimumReleaseAge` automatically holds back this week's <7-day releases.

Goal: land the aged-out in-range minor/patch updates across the workspace, **libs and tooling in two separate gated commits**, fix any fallout the tooling bumps surface, with every gate green and the **full** lockfile diff audited for supply-chain age.

## Why `light`

Rubric (HIGH count): novelty LOW, blast radius **MODERATE** (dev-deps of all packages, but minor/patch only), irreversibility LOW (revert the lockfile), migration cost LOW (no majors land), external coupling LOW, security sensitivity LOW (min-age respected; no new surface). 0–1 HIGH → `light` (downgraded from the requested `mid` once research showed no zod v5 and no majors).

## Research findings (ncu, this session)

| Area | Finding |
|---|---|
| **zod** | latest `4.4.3`; repo `^4` → already `4.4.3`; `@aztec/*` also `^4`. **No-op.** |
| **@types/node** | 24→26 available but **policy cap `<25`** (SECURITY.md / renovate) → **excluded**. |
| Runtime/libs (Phase 1) | minor/patch, in-range: `vue` 3.5.38, `vue-router` 5.1.0, `pinia` 3.0.4, `viem` (gated), `luxon`, `pako`, `lean-qr`, `focus-trap`, `@codemirror/*` 6.x, `@lezer/highlight`, `codemirror`. |
| Build/test tooling (Phase 2) | `vitest` 4.1.9, `vue-tsc` 3.3.5, `@vitejs/plugin-vue` 6.0.7, `@vue/compiler-sfc` 3.5.38, `@vue/test-utils` 2.4.11, `unplugin-*`, `vite` (gated), `vite-plugin-*`, `@crxjs/vite-plugin` 2.7.0, `storybook`/`@storybook/vue3-vite` 10.4.6, `sass`, `postcss`, `puppeteer` 25.2.1, `cross-env`, `globals`, `chrome-types`, `@webext-core/fake-browser`, `@biomejs/biome` (gated), `@commitlint/*` 21.1.0. |
| **min-age-gated (<7d as of 2026-06-25; cutoff 06-18)** | `vite` 8.1.0 (06-23), `@biomejs/biome` 2.5.1 (06-23), `viem` 2.53.1 (06-20) → `bun update` lands the latest **aged-out** version of each; the newest age in over the next days, **automatic, no action**. |

All updatable refs are within existing `^` ranges → **no `package.json` edits** (only `@types/node`'s 26 is out-of-range, and excluded).

## Approach

`bun update <subset>` (no `--latest` → in-range; honors `minimumReleaseAge`) in **two stages so cause is attributable** (codex Medium-3): **(1) runtime/libs, (2) build/test tooling**, each its own commit + gate. After EACH stage, audit the **entire `bun.lock` diff — every changed resolved package entry, transitives included** (codex High): bun bug #25305 can leave a too-new *transitive* in the lock even though the gate "should" cover new resolution, so a top-level-only grep is insufficient. If the diff is unwieldy or any changed entry is <7 days, fall back to the **repo-documented bulk re-resolve** (`rm bun.lock && bun install`, which re-applies the gate to the whole tree from scratch — CLAUDE.md / SECURITY.md / bunfig.toml #25305 note).

Rejected: plain `bun update` (all) in one commit with a top-level-only diff audit — codex High (misses gated transitives) + Medium-3 (no causality). Rejected: `bun update --latest` — crosses majors (@types/node→26) and is the exact #25305 trigger. Rejected: bumping `^` floors (ncu -u) — cosmetic; ranges already permit the targets. Rejected: separate PRs for libs vs tooling — the user chose one PR; separate *commits* give the causality codex wants without the overhead.

## Phases

### Phase 1+2 (COLLAPSED) — ✓ DONE — Full in-range refresh + biome-2.5/@types fallout
The 2-stage libs/tooling split is **not achievable** in this Bun workspace (per-child `bun update` refreshes each child's libs AND tooling together; `bun update <list>` pollutes root, `rm bun.lock` re-hoists and breaks under-declared deps). So one pass: `(cd packages/<child> && bun update)` for all 11 children + root `bun update`. **No `--latest`** (in-range; honors `minimumReleaseAge`). Result: **186** changed `bun.lock` entries, **12** `package.json` `^`-floor bumps (all within-major), no root pollution, `@types/node` ≤24. Notable moves: biome 2.4.15→2.5.0, vitest 4.1.5→4.1.9, vite 8.0.11→8.0.16, vue 3.5.18→3.5.38, vue-tsc 3.0.5→3.3.5, viem 2.43→2.52.2, storybook 10.3.5→10.4.6, fake-browser 1.3.4→1.5.2, `zod ^4`→`^4.4.3` (no v5 — original trigger moot).

**Fallout fixed inline** (biome 2.5.0 promoted rules + fake-browser's `@types/webextension-polyfill` 0.12.5):
- `noSvgWithoutTitle` (now error; biome 2.5 lints standalone `.svg`) on 4 brand assets → exclude `**/*.svg` from biome `files.includes` (assets, not lint source; inline `.vue` SVGs still checked).
- `noRedundantRoles` (now error) on `landing/index.html` `<nav role="navigation">` → drop the redundant implicit role.
- `useVueMultiWordComponentNames` (now recommended-warning) on 17 intentional single-word primitives → rule `off` (deliberate design-system + wallet naming).
- `@types/webextension-polyfill` 0.12.3→0.12.5 made `Alarms.Alarm` ⊄ `chrome.alarms.Alarm` at `session-manager.test.ts:456` → cast the helper's return (matches the existing `fireAlarm` cast at :464).
- biome `$schema` 2.4.15→2.5.0.

**Validation gate — PASS**
- `bun install --frozen-lockfile` exit 0 · full-diff min-age audit **186/186 ≥7 days** (transitives incl.), 0 unverifiable · `@types/node` ≤24 (NODE-OK) · `bun run typecheck:all` 0 · `bun run lint` 0 (0 errors; 55 pre-existing non-blocking warnings) · `CI=true bun run test:all` 0 (extension 2597, faucet 413, bridge-core 127, … all suites green).
- Layers: dependency-tree + full lockfile supply-chain audit · typecheck · lint · unit (10 packages with test scripts — `@nulo/playground` has none).

### Phase 2 — FOLDED into Phase 1
The libs/tooling split is mechanically impossible here (above) — `bun update` per child refreshes both at once. The tooling bumps (biome 2.5, vue-tsc 3.3.5, vitest 4.1.9, vite 8.0.16, storybook 10.4.6, fake-browser 1.5.2, commitlint 21.0.2) landed in the single Phase-1 refresh; their fallout is fixed there. Causality is preserved via the lessons log rather than a separate commit.

### Phase 3 — Builds + e2e + PR
The vite/vue/codemirror/sass/storybook bumps affect bundling. Build every surface; run the full gate **explicitly** (NOT via `audit:vue`, which re-runs only extension test/build — codex Medium-2); open the PR (smoke + network e2e in CI).

**Validation gate**
- Commands: `bun run typecheck:all` · `bun run lint` · `CI=true bun run test:all` · `bun run build` (chrome) · `bun run build:firefox` · `bun run build:faucet` · `bun run --cwd packages/playground build` · `bun run --cwd packages/landing build` · `bun install --frozen-lockfile` · `bun run test:e2e` (smoke) · `bun run e2e:agent` (network) — smoke + network via the PR's CI.
- Pass criteria: typecheck:all + lint + test:all green (full, not extension-only); all 5 builds exit 0; smoke + network e2e green in CI; final `git diff bun.lock` reviewed.
- Layers: typecheck · unit · lint · build (all 5) · smoke e2e · network e2e.

## Security & Adversarial Considerations

- **Supply chain (primary surface).** A refresh diff is where a malicious/breaking minor-patch hides. Defenses: bunfig `minimumReleaseAge = 604800`; **the per-stage gate audits the ENTIRE `bun.lock` diff — every changed resolved entry, transitives included** (codex High; bun #25305 means the gate alone can leave a too-new transitive, so we verify publish dates ourselves); `bun install --frozen-lockfile` in CI; bun verifies `sha512` integrity per package; human review for surprise packages / cross-major jumps. Fallback for a messy/young diff: `rm bun.lock && bun install` (repo-documented bulk re-resolve — re-applies the gate to the whole tree).
- **`@types/node` cap** honored (`<25`), not bypassed.
- **Lockfile integrity**: `bun.lock` committed; the (audited) diff is the trust artifact; no `--no-frozen` anywhere.
- **No new runtime surface / least privilege**: no new deps, no CI-token/permission changes, no new network calls — minor/patch of existing deps only.
- **Not applicable:** crypto, authn/authz, smart-contract reorg/replay. `@aztec/*` exact-pinned, out of scope (separate Aztec-bump fixture).

## Assumptions

**Facts** (verified this session):
- zod latest = `4.4.3` (no v5; majors 1–4); repo `zod ^4` → `4.4.3`; `@aztec/*` require `zod ^4` (npm + `bun.lock`).
- `ncu` across root + all packages: only available major is `@types/node` 24→26; all else minor/patch within-major.
- `@types/node` policy-capped `<25` (SECURITY.md).
- All updatable refs are within current `^` ranges → no `package.json` edits.
- `test:all` = `bun run --filter '@nulo/*' --if-present test` → covers the **10** packages with a `test` script; **`@nulo/playground` has none**. `audit:vue` re-runs only **extension** test/build (+ typecheck:all + lint) — so the final gate runs `test:all` + all 5 builds explicitly, not via `audit:vue`.
- min-age (npm `time`): `vite@8.1.0` (06-23), `@biomejs/biome@2.5.1` (06-23), `viem@2.53.1` (06-20) <7 days; `vitest@4.1.9` (06-15), `vue@3.5.38` (06-11) aged out.
- bunfig `minimumReleaseAge = 604800`; bun #25305 (gate gap on bulk re-resolve) documented in CLAUDE.md/SECURITY.md.

**Inferences** (for the implementer to watch):
- The full-diff min-age audit catches any too-new transitive the gate misses. *If the diff is large, scripting the per-entry date check is the cost; the `rm bun.lock` fallback sidesteps it.*
- The tooling bumps (biome 2.5, vue-tsc 3.3) surface SOME fixable new lint/type findings. *Risk: a single bump has a real regression → pin just that one back, note it, ship the rest.*
- Minor/patch are behavior-compatible (semver). *Risk: a mislabeled minor regresses — caught by test:all + e2e.*

**Asks** (resolved): tier → **light** (user); scope → **full in-range incl. tooling, split into 2 commits** (user + codex-3); `@types/node` → **skip** (policy); gated-newest → **auto-deferred** by min-age.

## Audit verdict
- **Codex (xhigh), session `019efbad-bb8b-7180-ad8b-aced23f175dc`:** `conditional approve` — conditions: (1, High) audit/regenerate the **full** lockfile for age-gated transitives, not top-level only; (2, Med) final gate must re-run full typecheck/lint/**test:all** (audit:vue is extension-only) + fix the "11"→"10 packages" claim; (3, Med) split tooling bumps from the lib refresh. **All 3 adopted** (Approach + Phases 1–3 + Assumptions). Fact-checks (zod moot, `@types/node <25`) confirmed. **No rejected findings.**

## Post-implementation hardening
Not warranted — no trust boundary / auth / secret / CI-token / publishing surface; supply-chain covered by the per-stage full-diff min-age audit + frozen lockfile. No `/harden`.

## Seeds (DRAFT — finalized after approval)

**Recommended: `/goal`** (completion is transcript-observable).
```
/goal All phases ✓ in implementations-plan/dependency-refresh/plan.md, each backed by its gate passing in the transcript: Phase 1 (runtime/libs) — bun update done, frozen install exit 0, FULL bun.lock diff audited (every changed entry incl. transitives ≥7 days old; @types/node ≤24), typecheck:all+lint+test:all green, committed; Phase 2 (tooling, separate commit) — same full-diff audit + typecheck:all+lint+test:all green with fallout fixed; Phase 3 — typecheck:all+lint+test:all + all 5 builds + test:e2e + e2e:agent + frozen install exit 0, final diff reviewed; each phase printed LESSONS_FILE=implementations-plan/dependency-refresh/lessons/phase-N.md; `/code-review max --fix` applied + committed; codex post-impl audit done, high/critical addressed.
```

**Alternative: `/loop 15m`** (fallback; network e2e is long).
```
/loop 15m Drive implementations-plan/dependency-refresh forward. Never idle. Each firing: read plan.md + lessons/ (authoritative), `git status`, `git log --oneline -5`, any open PR `gh pr view --json statusCheckRollup`. Pick the next pending phase; after each edit run `bun run lint` + `CI=true bun run test:all`; audit the FULL bun.lock diff for <7-day entries (transitives too); when a phase's gate (as written in plan.md) passes, mark ✓, file lessons/phase-N.md, print LESSONS_FILE=…, advance. Decisions → `/codex xhigh`, log verdict, act. Same step failed 5× → reassess with codex. Hard limits: never merge to main/release, never publish/deploy, never expand scope (no cross-major bumps, no @types/node ≥25). All phases ✓ → `/code-review max --fix` → commit → codex post-impl audit → address high/critical → report + stop.
```
