# vue-router 5 + Renovate — consolidated plan

Consolidated from `plan-mine.md` + `plan-opus.md`. Folded Codex xhigh review corrections (yellow-flag → green after fixes). Follow-up to PR #95 (dep hardening), #97 (vitest 4 + vite 8 + Rolldown), #98 (puppeteer 25 + zod 4 deferred) — all merged into `dev`.

Two scopes:
- **Scope A**: deprecate the archived `unplugin-vue-router` package and bump `vue-router 4 → 5`.
- **Scope B**: stand up a Renovate config with conservative defaults; `@aztec/*` explicitly excluded; the App install is a separate user action.

---

## 1. TL;DR

**Scope A** is smaller than the headline suggests. `unplugin-vue-router` is NOT plugged into `vite.config.ts` — only `vite-plugin-pages`' `usePages` is. The plugin's only surface in our tree is the generated `src/types/typed-router.d.ts` (which our code never imports as a module — verified by exhaustive grep) and two dead lines in `auto-imports.d.ts`. All `router.push(...)` callsites use path strings, not typed routes. The deleted file's `RouteNamedMap` only enumerated 5 static routes (`/common/about`, `/popup/`, `/setup/`, `/setup/install`, `/setup/update`) — NOT the popup auth/register/`[id]` routes. So removing it widens types only for those 5 (which we access by path-string, never by `route.name`). **R17 was over-stated in early drafts and is corrected post-impl** — Codex impl review confirmed no narrowing surfaced anywhere. Migration is:

1. Drop `unplugin-vue-router` from `packages/extension/package.json` devDeps.
2. Delete `src/types/typed-router.d.ts`.
3. Regenerate `auto-imports.d.ts` with a clean rewrite (delete the file, then build). The regen drops the two `defineLoader` / `definePage` lines we cared about plus a larger cluster of stale `@vueuse/core`, `vue/macros`, and miscellaneous re-exports preserved from older configs — `unplugin-auto-import`'s d.ts writer is additive, so a stale file isn't replaced unless you delete it first. Verified via grep: nothing in `src/` consumed any of the removed entries.
4. Bump `vue-router ^4.5.1 → ^5.0.5` (gate-safe; 5.0.6/5.0.7 are inside the 7-day window).

**Scope B** refines the PR #95 draft. Headline corrections vs that draft:
- **Regex anchor bug**: `/^@aztec/` matches `@aztec-fake/x`. Use `/^@aztec\//` (escaped JSON: `"/^@aztec\\//"`). Still catches our separately-versioned `@aztec/viem`.
- **`@types/node`**: use `allowedVersions: "<25"` rather than full disable — patch/minor on 24.x is fine.
- **Aztec disable rule goes LAST** in `packageRules` (Renovate doc: "later rules override earlier" — most-important rules at the bottom).
- **Drop `unplugin-vue-router` from the routing group** since Scope A removes it.
- **Time PR 2 for ≥ 2026-05-19**: clears the puppeteer/chromium-bidi temp-excludes in `bunfig.toml`. Renovate's age gate is a separate mechanism that wouldn't honor those excludes. Note: with the Monday-only schedule, normal PRs won't open until 2026-05-25.
- **Renovate's `bun` manager bumps `package.json#packageManager`** but won't sync `.github/actions/setup-bun/action.yml`. **Existing CI does NOT catch this** — `_lint-and-typecheck.yml` runs lint + typecheck + `bun audit`, not the full `audit:vue`. Manual review on every Bun-version Renovate PR.

**Two PRs, in order**: A first (trims routing group from 3 packages to 2), then B (ships an accurate group from day one).

---

## 2. Goals and non-goals

### Goals
1. Remove the archived `unplugin-vue-router` dep (last release 0.19.2 on 2025-12-29; repo archived 2026-02-24).
2. Bump `vue-router ^4.5.1 → ^5.0.5`. Upstream frames it as a "boring release" with no breaking changes per release notes.
3. Drop `src/types/typed-router.d.ts` and the dead `vue-router/auto` / `unplugin-vue-router/runtime` lines in `auto-imports.d.ts`.
4. Add a conservative `renovate.json` at repo root: 7-day age gate (mirrors `bunfig.toml`), `@aztec/*` disabled, cluster grouping, no auto-merge.
5. Document Renovate in `CLAUDE.md` "Dependency policy" and update `SECURITY.md`.

### Non-goals
- **Migrating off `vite-plugin-pages`.** Still used via `vite.config.ts:128` `usePages`. Orthogonal — vue-router 5 absorbed `unplugin-vue-router`'s typed-routing but NOT the virtual `~pages` module pattern.
- Switching from hash to web history; popup needs hash.
- Wiring `definePage` / Data Loaders (we have zero callers).
- Auto-merging anything via Renovate.
- Bumping `@aztec/*` or `@types/node ≥ 25` via Renovate.
- Replacing `@wonderland/aztec-fee-payment` (tarball URL, not on npm — Renovate can't bump it anyway).
- Installing the Mend Renovate App (user action post-merge).
- Promoting `bun audit` to required (separate follow-up).
- Branch protection changes (deferred per stored memory `project_public_visibility_deferred`).
- Self-hosted Renovate workflow (follow-up if/when leaving the App).

---

## 3. Recon (empirically verified, 2026-05-18)

### Today's data
- **Date**: 2026-05-18 ~14:00 UTC.
- **7-day gate boundary**: 2026-05-11 ~14:00 UTC.
- **`bunfig.toml` temp excludes**: `["puppeteer", "puppeteer-core", "@puppeteer/browsers", "chromium-bidi"]` expire ~2026-05-19 16:08 UTC.

### vue-router publish ages
- 5.0.0: 2026-01-29 (~3.5 months — safe)
- 5.0.5: 2026-04-22 (26d — **safe, pin target**)
- 5.0.6: 2026-04-22 (same day — also safe in theory; same release window)
- 5.0.7: 2026-05-13 (5d — **blocked by gate**)

### unplugin-vue-router state
- 0.19.2 (2025-12-29) is the last release; repo archived 2026-02-24.
- We're on `^0.15.0`.
- **NOT wired into `vite.config.ts`** — only `usePages` from `vite-plugin-pages` is in the plugins array (line 128). Verified by grep.

### Code surface for Scope A
Files touched:
- `packages/extension/package.json` — drop devDep, bump `vue-router` version line
- `packages/extension/src/types/typed-router.d.ts` — DELETE (141 lines, all dead; `// @ts-nocheck` already)
- `packages/extension/src/types/auto-imports.d.ts` — regenerate (drops the two `defineLoader` + `definePage` lines around `:67-68`)
- `packages/extension/src/components.d.ts` — possible drift after vue-router 5 bump; regenerate via `bun run dev`

Active vue-router consumers (all using vanilla v4/v5 APIs):
- `packages/extension/src/popup/index.ts:21` — `createRouter, createWebHashHistory, RouteLocationNormalized, NavigationGuardNext`
- `packages/extension/src/popup/index.ts:50-96` — **central auth guard, critical smoke-e2e canary**
- `packages/extension/src/setup/index.ts:2,4` — `createRouter, createWebHashHistory`
- ~30 `router.push|.replace|.back|RouterLink` callsites — all path-string or untyped objects. No typed `RouteRecordNamedMap` use.

### Renovate context
- Mend Renovate hosted App is free for private repos. Apache 2.0 source.
- Draft from `implementations-plan/dependency-hardening/plan.md §13` is the base; corrections enumerated in §6.1 below.

---

## 4. Risk register

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | vue-router 5 type narrowing leaks into guard at `popup/index.ts:50-96` | Low | typecheck:all is the cheap gate; smoke e2e exercises the guard end-to-end |
| R2 | `~pages` virtual module narrowed by vue-router 5's `RouteRecordRaw` | Low | `vite-plugin-pages` is vue-router-major-independent; validate via `bun run build` |
| R3 | `RouterLink` / `RouterView` auto-import drift via `components.d.ts` | Low | `bun run dev` once after bump — `unplugin-vue-components` regenerates; commit diff |
| R4 | `typed-router.d.ts` has a non-obvious consumer | Low | exhaustive grep returned only itself; file is `// @ts-nocheck` |
| R5 | `auto-imports.d.ts` regen step is easy to forget | Med | Regenerates on Vite plugin tick, NOT on `bun install`. After A1's manifest edit, run `bun run dev` once, then commit. If forgotten: lint passes but file carries dead imports |
| R6 | Storybook cache leaks `vue-router@4.x` (`node_modules/.cache/storybook/.../_metadata.json`) | Low | local hygiene only: `rm -rf packages/extension/node_modules/.cache/storybook`. CI doesn't restore that cache |
| R7 | `dist/chrome/` bundle size shift | Low | compare before/after; vue-router 5 absorbed unplugin features so size may rise slightly; report in PR |
| R8 | Renovate floods PRs on first cycle | Med | `prConcurrentLimit: 3` + `prHourlyLimit: 2` + weekly schedule + Dependency Dashboard |
| R9 | Renovate bumps `@aztec/*` accidentally via group-rule precedence | High | Aztec disable rule FIRST in `packageRules`; regex `/^@aztec\//` (escaped); validator step locally |
| R10 | Config merged, App not installed → user thinks it's broken | Low | PR body carries install runbook |
| R11 | App installed before merge → empty-config scan opens noisy Dashboard | Low | Order documented in PR body: merge config first, then install |
| R12 | Renovate age gate (PR-creation-time) vs Bun's (install-time) semantic mismatch | Low | `vulnerabilityAlerts.minimumReleaseAge: "0 days"` aligns with the SECURITY.md CVE-on-Friday runbook |
| R13 | Renovate bumps `package.json#packageManager` but not `setup-bun/action.yml` | Med | Document in PR body. **Existing CI does NOT auto-catch** — `_lint-and-typecheck.yml` runs lint + typecheck + `bun audit`, not `audit:vue`. Manual review on every Bun PR. Potential follow-up: add a consistency check script |
| R14 | PR-2 lands before puppeteer/chromium-bidi `bunfig.toml` excludes expire | Med | Time PR-2 for ≥ 2026-05-19. Otherwise a puppeteer Renovate PR could trip the age gate at install time |
| R15 | `vite-plugin-pages` is 0.33.x — minors can be breaking by SemVer convention | Med | Run smoke e2e by hand on every routing-group Renovate PR until v1.0 |
| R16 | Routing group churn — `vue` bumps shouldn't wait on `vue-router` | Low | Routing group is `["vue-router", "vite-plugin-pages"]` only. `vue` stays individual |
| R17 | (DEPRECATED — over-stated) Deleting `typed-router.d.ts` widens `route.name` and `[id]` `route.params` types | n/a | Post-impl: Codex confirmed the deleted `RouteNamedMap` only covered 5 static routes (none of the popup auth/register/`[id]` routes). The two suspect spots (`popup/app.vue:207,283`) use `route.name` in runtime-safe patterns (`["..."].includes(route.name)`, `route.name?.includes("...")`). No narrowing was needed; typecheck stayed green |

---

## 5. Scope A — vue-router migration

**Branch**: `deps/vue-router-5`. **Base**: `dev`. **Shape**: one PR, two commits.

### A1 — `chore(deps): remove archived unplugin-vue-router`

1. `packages/extension/package.json` — delete `"unplugin-vue-router": "^0.15.0"` from devDeps.
2. `packages/extension/src/types/typed-router.d.ts` — DELETE entire file.
3. Run `bun install` to update `bun.lockb`.
4. **Regenerate `auto-imports.d.ts`**: **delete the file first**, then run `bun run --cwd packages/extension build:chrome`. `unplugin-auto-import`'s d.ts writer is additive — running the build without deleting the file leaves stale entries in place. The clean regen drops the two dead `defineLoader`/`definePage` lines AND a larger cluster of stale `@vueuse/core`, `vue/macros`, and misc re-exports from older configs. Verify via grep that no `src/` consumer references any removed entry.
5. **Same-commit obligation**: A1's regenerated `auto-imports.d.ts` lands in this commit. Loss of ambient typed-route info doesn't surface at consumer sites in practice (see R17 — the deleted `RouteNamedMap` only covered 5 static routes that we access by path-string).

**Validation**: `bun run typecheck:all && bun run lint && bun run build && bun run test`. Typecheck should stay green — confirmed empirically.

### A2 — `chore(deps): bump vue-router to ^5.0.5`

1. `packages/extension/package.json` — change `"vue-router": "^4.5.1"` → `"vue-router": "^5.0.5"`.
2. `bun install`.
3. `bun run typecheck:all`. Empirically: typecheck stays green across all 9 workspaces with no narrowing changes needed. The guard at `popup/index.ts:50-96` uses generic `RouteLocationNormalized` (fine). The two suspect spots in `popup/app.vue:207,283` use runtime-safe patterns (`["..."].includes(route.name)`, `route.name?.includes(...)`).
4. Run `bun run --cwd packages/extension build:chrome` once → `unplugin-vue-components` refreshes `components.d.ts`. Commit any drift.
5. Local hygiene: `rm -rf packages/extension/node_modules/.cache/storybook` (R6).

**Validation**:
- `bun run audit:vue` (typecheck → unit + component tests → lint → build).
- `bun run test:e2e` (smoke; the auth guard at `popup/index.ts:50-96` is THE canary).
- **Manual click-through** (~30s): `/popup/auth → /popup/general → /popup/send → /popup/settings/connected-apps/<id>`. Exercises guard + `router.push|.replace|.back` + `RouterLink` + `route.meta.showBottomNav` consumers at `app.vue:35,213,324` and `Header.vue:208`.

**Skip network e2e**: doesn't touch the Aztec wire boundary; baseline-flaky 46/66 masks signal.

### Why one PR, two commits

A1 alone is a valid intermediate state — the codebase compiles fine with vue-router 4 + no `unplugin-vue-router` (the plugin was never in the vite plugin chain). It loses ambient typed-route info for the 5 augmented routes, but those aren't accessed by `route.name` anywhere in our code. A2 layers the version bump. Two commits = clean revert points without two reviews.

---

## 6. Scope B — Renovate config

**Branch**: `infra/renovate`. **Base**: `dev`. **Shape**: one PR, one commit (config + docs together).

### 6.1 The `renovate.json` (final)

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
  "baseBranchPatterns": ["dev"],

  "rangeStrategy": "in-range",
  "minimumReleaseAge": "7 days",
  "vulnerabilityAlerts": {
    "enabled": true,
    "minimumReleaseAge": "0 days",
    "labels": ["dependencies", "security"]
  },

  "prConcurrentLimit": 3,
  "prHourlyLimit": 2,
  "dependencyDashboard": true,
  "dependencyDashboardTitle": "Dependency Dashboard",
  "labels": ["dependencies"],
  "schedule": ["* 0-5 * * 1"],
  "timezone": "America/Argentina/Buenos_Aires",

  "commitMessagePrefix": "chore(deps):",
  "commitMessageAction": "bump",
  "commitMessageTopic": "{{depName}}",
  "commitMessageExtra": "to {{newVersion}}",

  "packageRules": [
    {
      "matchPackageNames": ["vue-router", "vite-plugin-pages"],
      "groupName": "routing"
    },
    { "matchPackageNames": ["vite", "@vitejs/plugin-vue"], "groupName": "vite" },
    {
      "matchPackageNames": ["vitest", "@vitest/coverage-v8", "@vue/test-utils", "jsdom"],
      "groupName": "test-runner"
    },
    {
      "matchPackageNames": ["puppeteer", "puppeteer-core", "@puppeteer/browsers", "chromium-bidi"],
      "groupName": "puppeteer"
    },
    { "matchPackageNames": ["/^unplugin-/"], "groupName": "unplugin-*" },
    { "matchPackageNames": ["/^@codemirror/"], "groupName": "codemirror" },
    { "matchPackageNames": ["/^@commitlint/"], "groupName": "commitlint" },
    { "matchPackageNames": ["typescript", "vue-tsc"], "groupName": "typescript" },
    { "matchPackageNames": ["/^@storybook/", "storybook"], "groupName": "storybook" },
    {
      "matchPackageNames": ["webextension-polyfill", "@types/webextension-polyfill"],
      "groupName": "webextension-polyfill"
    },
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["patch", "minor"],
      "automerge": false
    },
    {
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["dependencies", "major"]
    },
    {
      "matchPackageNames": ["puppeteer", "puppeteer-core", "@puppeteer/browsers", "chromium-bidi"],
      "enabled": false,
      "description": "TEMP carve-out: mirrors bunfig.toml minimumReleaseAgeExcludes window. Re-enable on/after 2026-05-19 16:08 UTC by removing this rule + the puppeteer group entry will pick up."
    },
    {
      "matchPackageNames": ["@types/node"],
      "allowedVersions": "<25",
      "description": "Pinned to Node 24 lifecycle. Patch/minor on 24.x still bumped."
    },
    {
      "matchPackageNames": [
        "/^@aztec\\//",
        "@alejoamiras/aztec-accelerator",
        "@defi-wonderland/aztec-standards",
        "@wonderland/aztec-fee-payment"
      ],
      "enabled": false,
      "description": "Aztec line: class-id stability per SECURITY.md. Manual via Aztec milestone. LAST so no later rule re-enables."
    }
  ]
}
```

### 6.2 Corrections vs the PR #95 §13 draft

1. **Regex**: `/^@aztec\//` (escaped `"/^@aztec\\//"`). The old `/^@aztec/` matches `@aztec-fake/x`. Empirically verified.
2. **Aztec rule LAST**. Renovate docs (https://docs.renovatebot.com/configuration-options/): "later rules may override earlier ones." Put the disable at the bottom so no later group rule can re-enable an Aztec package. (In our current config no later rule does, but the principle stands.)
3. **`@types/node` upper bound**: `"allowedVersions": "<25"` — still bumps 24.x patches.
4. **Drop `unplugin-vue-router` from the routing group** (Scope A removes it).
5. **Puppeteer group added** — four packages now (we landed `^25.0.0` in PR #98).
6. **`prHourlyLimit: 2`** for Day-1 safety.
7. **Schedule timezone**: `America/Argentina/Buenos_Aires` (user TZ).
8. **`vulnerabilityAlerts.labels`** include `dependencies` + `security`. Pre-create both labels in GitHub before installing the App (rely-on-first-run label creation is flaky).
9. **`baseBranchPatterns: ["dev"]`** (added post-impl review). Repo default branch is `main`; Renovate reads config from the default branch. The config must be promoted to `main` via the standard dev→main PR before installing the Mend App, otherwise onboarding scans an empty config against `main`. With this key set, Renovate creates PRs against `dev`.
10. **Schedule switched to cron** (added post-impl review): `"* 0-5 * * 1"` instead of `"before 6am on monday"`. Renovate's `@breejs/later` text syntax is deprecated; cron also makes timing semantics easier to reason about.

### 6.3 PR body / install runbook (copy verbatim into PR description)

> **Install order**:
> 1. Merge this PR to `dev`.
> 2. Promote `dev` → `main` via the standard promotion PR — Renovate only reads its config from the default branch (`main`); without this step, install onboards against empty config.
> 3. Pre-create GitHub labels `dependencies` and `security`.
> 4. Install the hosted Mend Renovate App at https://github.com/apps/renovate, scoping to this repo.
> 5. Renovate scans against `main`, creates PRs against `dev` (per `baseBranchPatterns`).
>
> **First-cycle expectations**: with `prConcurrentLimit: 3` + `prHourlyLimit: 2`, the Dashboard lists 20-40 candidates but only 3 PRs open at a time. Mend job scheduling is 4-hourly/daily (not fixed); vulnerability PRs skip schedule entirely. ~10-15 first-cycle PRs estimated; ~5-7 weekday merges to drain.
>
> **`@aztec/*` disabled**: PRs never auto-open for the Aztec line. Manual via the Aztec milestone (SECURITY.md "Crypto-bound invariants" — class-id stability).
>
> **`@types/node` capped at <25**: stays on the Node 24 lifecycle.
>
> **CVE bypass**: `vulnerabilityAlerts.minimumReleaseAge: "0 days"` is belt-and-suspenders — Renovate already lets vulnerability alerts skip `schedule`, `prHourlyLimit`, and `prConcurrentLimit` by default. Pair with SECURITY.md "CVE-on-Friday" runbook.
>
> **`packageManager` PRs** (`bun@X.Y.Z`): when Renovate bumps `package.json#packageManager`, **manually sync** `.github/actions/setup-bun/action.yml` in the same PR. CI workflows still pass because every job uses the `setup-bun` action — they run with the action-pinned Bun, not the new `packageManager` value. There's no CI step that verifies the two pinned values match.
>
> **Routing-group PRs** (`vue-router` / `vite-plugin-pages`): run `bun run test:e2e` by hand until `vite-plugin-pages` reaches 1.0 — 0.x minors can be breaking.

### 6.4 Doc updates in the same commit

- `CLAUDE.md` "Dependency policy" section: add a paragraph linking to the Dependency Dashboard issue post-install, noting the `@aztec/*` carve-out and Bun version PR pitfall.
- `SECURITY.md` "Dependency policy" section: mirror the Renovate description; clarify Bun's `minimumReleaseAge` and Renovate's `minimumReleaseAge` are independent mechanisms (both at 7d; Renovate's `vulnerabilityAlerts` overrides to 0d).

### 6.5 Validation

- Locally: `npx --yes --package renovate@43.150.0 -- renovate-config-validator --strict --no-global renovate.json` — must succeed with "Validating renovate.json as repo config" + "Config validated successfully".
- `bunx` fails: bun 1.3.x segfaults loading the `re2` native binding that `renovate` pulls in. Use `npx`.
- Without `--no-global`, the validator treats a filename argument as global/self-hosted config — wrong mode for our repo config.
- `--strict` fails on warnings (not just errors).
- The CI step pins `renovate@43.150.0` so npx doesn't fetch arbitrary fresh code on every PR. Renovate's own routing-group PR will bump this pin going forward.
- **Caveat**: the validator catches malformed/deprecated config but NOT semantic issues like `packageRules` precedence bugs or our `packageManager` ↔ setup-bun drift. Treat it as syntax-check only.

### 6.6 PR-2 timing

**Land PR-2 ≥ 2026-05-19** (clears the puppeteer/chromium-bidi excludes in `bunfig.toml#minimumReleaseAgeExcludes`). Otherwise a first-cycle puppeteer Renovate PR could trip the age gate at install. Cleaner than a temp `packageRules` carve-out.

---

## 7. Test strategy per phase

| Phase | typecheck:all | unit + component | lint | build | smoke e2e | network e2e | extra |
|---|---|---|---|---|---|---|---|
| A1 (drop unplugin) | ✓ | ✓ | ✓ | ✓ | – | – | diff `auto-imports.d.ts` is `defineLoader`+`definePage` removal only |
| A2 (vue-router 5) | ✓ | ✓ | ✓ | ✓ | ✓ | – | 30s manual click-through; storybook cache wipe |
| B (Renovate) | – | – | – | – | – | – | `renovate-config-validator` |

---

## 8. UX copy audit

**Audit performed; no UX copy changes needed.**

- **Scope A**: vue-router 5 ships no user-visible strings. `route.meta.*` and `route.name` are wallet-owned. `pages/[...catch].vue` redirects via `router.push("/popup/general")` — no vue-router string crosses the seam.
- **Scope B**: Renovate PR titles match `.commitlintrc.json` (extends `@commitlint/config-conventional` — lowercase subject). `commitMessagePrefix: "chore(deps):"` + default `{topic} to {newVersion}` yields `chore(deps): bump vue-router to 5.0.7` — ≤100 char header, lowercase ✓, `chore` type ✓, `deps` scope ✓. `.githooks/commit-msg` runs commitlint on Renovate commits; violations fail CI before auto-rebase.

---

## 9. Decisions locked (2026-05-18)

1. **PR shape**: TWO PRs, A first then B.
2. **PR-B timing**: ship today with a temporary `packageRules` carve-out disabling the puppeteer family until 2026-05-19.
3. **Validator CI step**: add `bunx --bun renovate-config-validator renovate.json` to `_lint-and-typecheck.yml` in PR-B.
4. **Type fixups in PR-A**: prefer proper narrowing (`typeof route.name === 'string'` guards, `String(route.params.id)`) over inline casts.
5. **Pin**: `^5.0.5` (defaulted).
6. **`@types/node`**: `allowedVersions: "<25"` (defaulted).
7. **Schedule**: `before 6am on monday` BA TZ (defaulted).
8. **Install runbook**: PR-B body, not separate issue template (defaulted).

---

## 10. PR map (opinionated)

### PR 1 — `chore(deps): drop unplugin-vue-router and bump vue-router to 5`
- **Branch**: `deps/vue-router-5` off `dev`.
- **Commits**:
  1. `chore(deps): remove archived unplugin-vue-router` — delete `typed-router.d.ts`, regen `auto-imports.d.ts`, drop devDep.
  2. `chore(deps): bump vue-router to ^5.0.5` — manifest bump, `components.d.ts` regen if drift, storybook cache wipe.
- **Gates**: `bun run audit:vue` + `bun run test:e2e` + manual click-through.

### PR 2 — `chore(infra): add Renovate config`
- **Branch**: `infra/renovate` off `dev`.
- **Commit**: `chore(infra): add Renovate config with conservative defaults` — `renovate.json` + `CLAUDE.md` update + `SECURITY.md` update.
- **Gate**: `renovate-config-validator` locally. (Optional one-line CI validator step per Q4.)
- **Land**: ≥ 2026-05-19.

### Order rationale
PR 1 trims the routing group from 3 packages (`vue-router`, `vite-plugin-pages`, `unplugin-vue-router`) to 2. PR 2 ships the accurate group from the start. Reversed: PR 2 carries a stale group definition that PR 1 then amends.

---

## 11. Notable flags

1. **`unplugin-vue-router` removal is mostly devDeps cleanup.** We never used typed-routes at the runtime layer (no `definePage` / `defineLoader` callers). The ambient augmentation in the deleted `typed-router.d.ts` only covered 5 static routes (`/common/about`, `/popup/`, `/setup/`, `/setup/install`, `/setup/update`) — NOT the popup auth/register/`[id]` routes. Removing it didn't surface any narrowing because our code doesn't use `route.name` for those 5. Don't over-claim "broad typed-route surface" in the PR description.
2. **`auto-imports.d.ts` regen workflow.** The d.ts writer in `unplugin-auto-import` is ADDITIVE — running `build:chrome` against a stale file doesn't remove old entries. **Delete the file before rebuilding** for a clean regen. Our clean regen dropped 251 lines of stale entries that no source code actually consumed.
3. **Storybook cache invalidation (R6)** is local hygiene only, not CI. Mention in PR body.
4. **First-cycle Renovate Dashboard volume**: ~80 distinct npm deps × 8 workspaces. Previous dep-hardening already cleaned many minors. Estimate 10-15 first-cycle PRs; ~5-7 weekday merges to drain.
5. **`bunfig.toml#minimumReleaseAgeExcludes` ↔ Renovate timing** — different mechanisms (install-time vs PR-creation-time). PR-2 timing matters.
6. **Renovate auto-detects `package.json#packageManager`** (currently `bun@1.3.13`). Bumps it directly but doesn't sync `setup-bun/action.yml`. Document in PR body.
7. **`vite-plugin-pages` is 0.33.x** — minors can be breaking by SemVer convention. Smoke e2e by hand on routing-group PRs until 1.0.
8. **`@aztec/viem` (2.38.2)** matches `/^@aztec\//` empirically — the disable rule catches it without a carve-out.
9. **`config:recommended`** bundles `:dependencyDashboard`, `:ignoreUnstable`, `replacements:all`, and a few others — but **NOT `:prImmediately`** (Codex confirmed via Renovate's preset docs). `:semanticCommits` is only present because we add it explicitly. Our `schedule` directive applies to normal update branch creation as expected.
10. **No self-hosted Renovate workflow file** needed today. Hosted App handles scheduling. Self-hosted is a follow-up if/when leaving the App.

---

## 12. Summary recommendation

- **Scope A**: one PR, two commits, mechanical. Pin `^5.0.5`. ~1h work + gates.
- **Scope B**: one PR after A. `renovate.json` + docs. Land **on or after 2026-05-19** to clear the puppeteer age-gate window. ~30min work.
- **Resolve before PR 1**: Q1 (`^5.0.5` vs `^5`).
- **Resolve before PR 2**: Q4 (validator CI step), Q7 (timing).
- **Risks I'd watch closest**: R5 (auto-imports regen step easy to forget), R9 (Aztec rule precedence), R13 (Bun manager → setup-bun action sync), R14 (PR-2 timing).
