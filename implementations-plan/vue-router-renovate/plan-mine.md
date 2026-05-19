# vue-router 5 + Renovate — plan (mine)

Follow-up to PRs #95 (dep hardening), #97 (vitest 4 + vite 8 + Rolldown), and #98 (puppeteer 25 + zod 4 deferred). All three merged into `dev`. This plan addresses two deferred items: deprecating `unplugin-vue-router` (archived upstream) by bumping to vue-router 5 native, and adding Renovate automation with conservative defaults and explicit Aztec exclusion.

## 1. TL;DR

**Scope A — `unplugin-vue-router` removal**: smaller than expected. The package is NOT wired into `vite.config.ts`. It only generates `src/types/typed-router.d.ts`, which has ZERO consumers in our production code. All `router.push(...)` calls are path-based strings (`"/popup/auth"`, etc.) — none use typed `RouteRecordNamedMap`. The migration is:
1. Drop `unplugin-vue-router` from `packages/extension/package.json` devDeps.
2. Delete `src/types/typed-router.d.ts` (dead types).
3. Regenerate `auto-imports.d.ts` (drops one dead `defineLoader` line at `:67`).
4. Bump `vue-router 4.5.1 → 5.0.5` (gate-safe; 5.0.6/7 are inside the 7-day window).

**Scope B — Renovate**: refine the draft from `implementations-plan/dependency-hardening/plan.md §13`, drop `renovate.json` at root, document the policy in `CLAUDE.md` and `SECURITY.md`. The Mend Renovate GitHub App install is a separate user action — the config sits dormant until installed.

**Two PRs, not one stacked**: different blast radii. PR-1 (vue-router) touches the popup router which is exercised in every smoke e2e test. PR-2 (Renovate) is pure config with no runtime impact.

## 2. Goals & non-goals

**Goals**
1. Remove the archived `unplugin-vue-router` dep before it becomes a security/compat liability (no more upstream patches).
2. Bump `vue-router 4.5.1 → 5.0.5`. vue-router 5 is officially backward-compatible per the upstream release notes.
3. Drop `src/types/typed-router.d.ts` and the dead `vue-router/auto` reference in `auto-imports.d.ts`.
4. Add a conservative Renovate config that explicitly excludes `@aztec/*` (and adjacent packages) from automated PRs.
5. Document Renovate in `CLAUDE.md` "Dependency policy" so contributors know the cadence.

**Non-goals**
- Replacing `vite-plugin-pages` (separate concern; vue-router 5's native file-based routing is additive, not a forced migration).
- Installing the Mend Renovate App (separate user action).
- Automating Aztec bumps (explicitly disabled).
- Other dep bumps in PR-1 (e.g., we don't touch puppeteer, vitest, etc.).
- Branch protection changes (still deferred per stored memory).
- `bun audit` promotion to required gate (separate follow-up).

## 3. Recon (verified empirically)

### Today's data
- 2026-05-18 ~14:00 UTC. 7-day gate boundary: 2026-05-11 ~14:00 UTC.

### vue-router publish dates
- 5.0.0: 2026-01-29 (3.5 months ago)
- 5.0.5: 2026-04-22 (26 days, **gate-safe**)
- 5.0.6: 2026-04-22 (same day; also gate-safe)
- 5.0.7: 2026-05-13 (5 days; blocked)

### unplugin-vue-router state
- 0.19.2 (2025-12-29) is the last release; repo archived 2026-02-24 ([github.com/posva/unplugin-vue-router](https://github.com/posva/unplugin-vue-router)).
- We're on `^0.15.0` (per `packages/extension/package.json`).
- **NOT plugged into `vite.config.ts`** — verified by grep. Only `usePages` from `vite-plugin-pages` is in the plugins array (line 128).

### Code surface for vue-router migration
Files touched by the change:
- `packages/extension/package.json` — drop devDep, bump `vue-router`
- `packages/extension/src/types/typed-router.d.ts` — DELETE (dead)
- `packages/extension/src/types/auto-imports.d.ts` — regenerate (drops 1 line)
- That's it. No `.ts`/`.vue` code changes needed.

Active vue-router consumers (all using vanilla v4/v5 APIs):
- `packages/extension/src/popup/index.ts:21` — `createRouter, createWebHashHistory, RouteLocationNormalized, NavigationGuardNext`
- `packages/extension/src/popup/index.ts:50-96` — auth guard (central failure surface for smoke e2e)
- `packages/extension/src/setup/index.ts:2` — `createRouter, createWebHashHistory`
- `packages/extension/src/setup/app.vue:3` — `useRoute`
- 9 other files calling `router.push(string)` or `router.push({ path, query })` — all path-based, no typed routes.

### Renovate
- Mend Renovate GitHub App is free for private repos ([mend.io/renovate](https://www.mend.io/renovate/)).
- Renovate itself is open source (Apache 2.0).
- Our draft config from `implementations-plan/dependency-hardening/plan.md §13` covers Aztec exclusion + grouping + scheduling. Needs minor refinements (puppeteer family group, drop `unplugin-vue-router` from routing group since we're removing it, add `prHourlyLimit` for first cycle).

## 4. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Hidden vue-router 5 typing break we miss | Low | upstream claims backward-compat; smoke e2e is the canary (router everywhere); typecheck:all is the cheap gate |
| R2 | `auto-imports.d.ts` regen produces unexpected diff | Low | run regen, diff visually before commit; should only lose the `defineLoader` line |
| R3 | `typed-router.d.ts` has a non-obvious consumer | Low | exhaustive grep returned only the file itself; verify pre-merge |
| R4 | `useRoute()` route-name typing changes | Low | we use `route.path`, not `route.name === "typed-name"`; flag in PR if anything in `appStore.network`, `popup/app.vue:207` (`route.name`-checking code) breaks |
| R5 | vue-router 5 + vite-plugin-pages compatibility | Med | both authored by the same Vue ecosystem maintainers; vue-router 5 release notes don't deprecate vite-plugin-pages. Verify by running the build |
| R6 | Renovate floods PRs on first cycle | Med | `prConcurrentLimit: 3`, `prHourlyLimit: 2`, weekly schedule, `automerge: false` |
| R7 | Renovate bumps `@aztec/*` accidentally | High | `enabled: false` on `matchPackageNames: ["/^@aztec/", "@alejoamiras/aztec-accelerator", "@defi-wonderland/aztec-standards", "@wonderland/aztec-fee-payment"]`. Verify regex matches `@aztec/viem` (separate version line) |
| R8 | User installs Renovate App before config lands | Low | document in CLAUDE.md and PR description that App install comes AFTER config merge |
| R9 | `dist/chrome/` bundle size change | Low | compare before/after; vue-router 5 absorbed unplugin features so size may go up slightly; report in PR |
| R10 | Renovate's first dashboard issue overwhelms | Low | the Dependency Dashboard is a single issue; user reviews on their schedule |

## 5. PR 1 — vue-router 5 migration

Branch: `deps/vue-router-5`. Base: `dev`. Three commits, each green:

### Commit 1 — `chore(deps): drop archived unplugin-vue-router`
- Remove `"unplugin-vue-router": "^0.15.0"` from `packages/extension/package.json` devDeps.
- Delete `packages/extension/src/types/typed-router.d.ts`.
- Run `bun install` to update lockfile.
- Run a build (or just `bun run typecheck:all`) to trigger `unplugin-auto-import` regeneration of `auto-imports.d.ts`. Verify the dead `defineLoader: typeof import("vue-router/auto")["defineLoader"]` line (~line 67) is gone.
- If regen doesn't pick it up automatically, run `bun run --cwd packages/extension dev` for a few seconds then ctrl-C.

**Validation**: `bun ci`, `bun run typecheck:all` (must stay 0 errors), `bun run test`, `bun run lint`, `bun run build`.

### Commit 2 — `chore(deps): bump vue-router 4 → 5`
- Edit `packages/extension/package.json`: `"vue-router": "^4.5.1"` → `"vue-router": "^5.0.5"`.
- Pin to `^5.0.5` exact-floor: 5.0.6 was published same day so resolves there; 5.0.7 (5d old) is inside the 7-day gate so blocked at install. Avoids needing a temp-exclude.
- `bun install`.

**Validation**: `bun run audit:vue` (typecheck + tests + lint + build). `bun run test:e2e` (smoke; auth guard at `popup/index.ts:50-96` is the critical canary; entry to every popup test).

### Commit 3 (optional) — `docs(claude): note vue-router 5 + unplugin-vue-router removal`
- Update `CLAUDE.md` if it mentions unplugin-vue-router anywhere (grep'd — it doesn't, so this commit may be unnecessary).

## 6. PR 2 — Renovate config

Branch: `infra/renovate`. Base: `dev`. One commit (split possible if user prefers):

### Commit — `chore(infra): add Renovate config with conservative defaults`

Drop `renovate.json` at repo root:

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
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
  "dependencyDashboardTitle": "📦 Dependency Dashboard",
  "labels": ["dependencies"],
  "schedule": ["before 6am on monday"],
  "commitMessagePrefix": "chore(deps):",
  "commitMessageAction": "bump",
  "packageRules": [
    {
      "matchPackageNames": [
        "/^@aztec/",
        "@alejoamiras/aztec-accelerator",
        "@defi-wonderland/aztec-standards",
        "@wonderland/aztec-fee-payment"
      ],
      "enabled": false,
      "description": "Aztec line: bumped manually with class-id checks (SECURITY.md). Includes @aztec/viem via /^@aztec/ regex."
    },
    {
      "matchPackageNames": ["@types/node"],
      "enabled": false,
      "description": "Stays on v24 to match Aztec's Node 24 baseline. Re-enable when Aztec moves to Node 25."
    },
    {
      "matchPackageNames": ["puppeteer", "puppeteer-core", "@puppeteer/browsers", "chromium-bidi"],
      "groupName": "puppeteer"
    },
    {
      "matchPackageNames": ["vite", "@vitejs/plugin-vue"],
      "groupName": "vite"
    },
    {
      "matchPackageNames": ["vitest", "@vitest/coverage-v8", "@vue/test-utils", "jsdom"],
      "groupName": "test runner"
    },
    {
      "matchPackageNames": ["vue", "vue-router", "vite-plugin-pages"],
      "groupName": "vue + routing"
    },
    {
      "matchPackageNames": ["/^unplugin-/"],
      "groupName": "unplugin-*"
    },
    {
      "matchPackageNames": ["/^@codemirror/"],
      "groupName": "codemirror"
    },
    {
      "matchPackageNames": ["/^@commitlint/"],
      "groupName": "commitlint"
    },
    {
      "matchPackageNames": ["typescript", "vue-tsc"],
      "groupName": "typescript"
    },
    {
      "matchPackageNames": ["/^@storybook/", "storybook"],
      "groupName": "storybook"
    },
    {
      "matchPackageNames": ["webextension-polyfill", "@types/webextension-polyfill"],
      "groupName": "webextension-polyfill"
    },
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["patch", "minor"],
      "automerge": false,
      "description": "Manual review — wallet is security-sensitive."
    },
    {
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["dependencies", "major"]
    }
  ]
}
```

Changes vs the PR #95 draft:
1. **Added `@types/node` disabled** — matches our explicit "stay on v24" policy.
2. **Added puppeteer family group** — we now have it at 25.x with temp-exclude.
3. **Routing group no longer includes `unplugin-vue-router`** — we're removing it.
4. **`prHourlyLimit: 2`** — extra safety for first cycle.
5. **`vulnerabilityAlerts.labels`** — auto-tag CVE bumps for visibility.
6. **Dashboard emoji** — UX nicety.

Also in this commit:
- Update `CLAUDE.md` "Dependency policy" subsection to note Renovate is active, point at the Dependency Dashboard issue, and document the App install path.
- Update `SECURITY.md` "Dependency policy" with the same note + the CVE bypass mechanism (mirror of `bunfig.toml#minimumReleaseAgeExcludes`).

**Validation**: `bunx --bun renovate-config-validator renovate.json` must succeed. No other test gates (config-only PR).

### Operational follow-up (user action after merge)
1. Install Mend Renovate App at https://github.com/apps/renovate, grant access to the repo.
2. Wait for the first Dependency Dashboard issue (~24-48h).
3. Review before letting it auto-open PRs. Adjust `prConcurrentLimit` down to 2 if first cycle feels noisy.

## 7. Test strategy per phase

| Phase | typecheck:all | test:all | lint | build | smoke e2e | network e2e | extra |
|---|---|---|---|---|---|---|---|
| PR-1 commit 1 (drop unplugin) | ✓ | ✓ | ✓ | ✓ | – | – | diff `auto-imports.d.ts` |
| PR-1 commit 2 (vue-router 5) | ✓ | ✓ | ✓ | ✓ | ✓ | – | manual: auth guard click-through |
| PR-2 (Renovate config) | – | – | – | – | – | – | `renovate-config-validator` |

**Skip network e2e** for PR-1: vue-router doesn't touch the Aztec wire boundary; baseline-flaky 46/66 masks signal.

**Why smoke e2e and not unit tests for vue-router**: smoke loads every popup route via puppeteer, exercising the router end-to-end. Unit tests have lower router coverage. The auth guard logic at `popup/index.ts:50-96` is THE critical surface.

## 8. UX copy

**Audit performed.** Neither change touches user-visible strings:
- vue-router migration: zero string changes; route paths preserved verbatim.
- Renovate PRs will use `chore(deps): bump X to Y` titles (matches `.commitlintrc.json`'s `subject-case: ["lower-case"]` rule).
- Renovate Dependency Dashboard issue title: `📦 Dependency Dashboard` (the emoji is a small UX nicety; user can override).

No copy work needed.

## 9. Open questions for user

1. **vue-router pin**: `^5.0.5` (gate-safe, 26d old) or `^5.0.7` with temp-exclude (~2d wait until 5.0.7 ages out)? **Recommend `^5.0.5`** — no exclude churn.
2. **Drop `vite-plugin-pages` too?** vue-router 5 absorbed `unplugin-vue-router`'s typed-routing but NOT `vite-plugin-pages`'s runtime virtual-module pattern. Investigation needed if you want to drop it; out-of-scope for this PR. **Recommend keep `vite-plugin-pages`**.
3. **`prConcurrentLimit`**: 3 (current draft) or 2 (tighter for noise-paranoia)? **Recommend 3** for the first cycle; tune to 2 after observation.
4. **One PR or two?** Different blast radii. **Recommend two**.
5. **Disable `@types/node` in Renovate?** I added this rule. Confirm — do we want Renovate to also stay on `^24`? **Recommend yes** (matches our explicit policy).
6. **Renovate App install timing**: ship config now, install App immediately after merge, or wait a few days? **Recommend install immediately** — config does nothing until App is on.
7. **automerge for patches on dev?** **Recommend no** — wallet is security-sensitive; manual review even on patches.

## 10. PR map

- **PR 1**: `chore(deps): drop unplugin-vue-router + bump vue-router 4 → 5` (3 commits: drop, bump, optional docs)
- **PR 2**: `chore(infra): add Renovate config with conservative defaults` (1 commit)

Commit prefixes per `.commitlintrc.json`: lowercase subject.

## 11. Notable flags

1. **`unplugin-vue-router` archived → security risk over time.** If a vulnerability surfaces in 0.x, there's no upstream patch path. Removing it pre-empts that.
2. **vue-router 5 + vite 8 (Rolldown) + vitest 4 stack** — all merged in the last week. The vue-router migration should be the last forward bump of this stack for a while.
3. **`vite-plugin-pages` is also in a maintenance state** (per its npm/GitHub activity) but not yet archived. Worth re-evaluating in 3-6 months whether to migrate to vue-router 5's native file-routing.
4. **Renovate Mend hosted vs self-hosted**: hosted is free for private repos today. If pricing changes, self-host (free Docker container / GitHub Action) is the fallback. Either way, our `renovate.json` is the source of truth.
5. **1Password agent flakiness** — use `--no-gpg-sign` per existing user authorization; re-sign sweep at end.

---

*Drafted as a parallel independent plan for consolidation. Read-only investigation against `dev` at commit `4f466e28`.*
