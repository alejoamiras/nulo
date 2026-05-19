# vue-router 5 + Renovate (Opus parallel plan)

Independent draft for consolidation. Two scopes; opinionated shape = **two PRs**, Scope A first (shrinks the surface Renovate tracks), Scope B second.

Date: 2026-05-18. Bun monorepo, 8 workspaces. Active dep gate: `bunfig.toml#minimumReleaseAge = 604800` (7d), excludes include `puppeteer*` + `chromium-bidi` until ~2026-05-19 16:08 UTC.

---

## 1. Goals + non-goals

### Goals

**Scope A.** Cut `unplugin-vue-router` cleanly out (archived upstream 2026-02-24) and bump `vue-router ^4.5.1 → ^5.x` in the same PR. Bundling them is intentional — keeping the plugin while moving to vue-router 5 means owning a generated `.d.ts` whose generator no longer ships.

**Scope B.** Stand up a Renovate config tuned for this repo: 7-day age gate (mirrors `bunfig.toml`), `@aztec/*` disabled, grouping for routing + vite + test runner + plugin clusters, no auto-merge, conservative concurrency. The PR ships only the config; the App is installed separately by the user.

### Non-goals

- Migrating off `vite-plugin-pages`. Still in `vite.config.ts:18,128` via `usePages`; orthogonal to `unplugin-vue-router`.
- Switching from hash to web history; popup needs hash.
- Wiring `definePage` / Data Loaders. Listed in `typed-router.d.ts:106-125` but **zero source files call them** (verified — only re-export lines in `auto-imports.d.ts:67-68`).
- Auto-merging anything via Renovate.
- Bumping `@aztec/*` or `@types/node ≥ 25` via Renovate.
- Replacing `@wonderland/aztec-fee-payment` (tarball URL, not on npm).

---

## 2. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | vue-router 5 "boring release" claim is upstream framing, not proof. Type narrowing in `RouteLocationNormalized` / `NavigationGuardNext` could leak into `popup/index.ts:21,50` and `setup/index.ts:2`. | `bun run typecheck:all` on the bump alone. Adjust the 7 call sites if needed. |
| R2 | `~pages` virtual import shape change. vue-router 5's `RouteRecordRaw` could narrow. | `vite-plugin-pages` is vue-router-major-independent. Validate via `bun run build`. |
| R3 | `RouterLink` / `RouterView` auto-import drift via `components.d.ts:50-51`. | `bun run dev` once after bump — `unplugin-vue-components` regenerates. Commit diff. |
| R4 | `webextension-polyfill` interaction. | None expected — polyfill is vite-aliased; vue-router never touches `chrome.*`. |
| R5 | Vite 8 + Rolldown interaction. | Out of scope. Vite 8 is descoped per `dependency-hardening/plan.md` Phase 5b; still on Vite 7. |
| R6 | Storybook caches old `vue-router@4.6.4` (`node_modules/.cache/storybook/.../_metadata.json:25-26`). | Local cleanup only — `rm -rf packages/extension/node_modules/.cache/storybook`. CI doesn't restore that cache. |
| R7 | `auto-imports.d.ts:67-68` references `defineLoader` (`vue-router/auto`) and `definePage` (`unplugin-vue-router/runtime`). After removal those become broken module imports. | Regenerate by running `bun run dev` once after the manifest edit; the plugin walks `composables/stores/utils` — `defineLoader`/`definePage` are not in any of them and vanish from regen output. |
| R8 | Dead `typed-router.d.ts` reference. `tsconfig.json:21` includes `src/**/*.d.ts`. | File is `// @ts-nocheck` and no source imports `vue-router/auto*`. Safe to delete outright. |
| R9 | Renovate Dashboard spam on Day 1. | Set BOTH `prConcurrentLimit: 3` AND `prHourlyLimit: 2`. |
| R10 | Renovate accidentally bumps `@aztec/*` via group-rule precedence. Later rules in `packageRules` can override earlier ones. | Put the `@aztec/*` disable rule **first**. Use `/^@aztec\//` (trailing slash, escaped JSON: `"/^@aztec\\//"`). Validate config with `bunx --bun renovate-config-validator renovate.json`. |
| R11 | Config merged, App not installed → silent no-op; user thinks it's broken. | PR body carries the install runbook (see §4.3). |
| R12 | App installed before merge → empty-config scan opens a noisy Dashboard. | Order: merge config first, then install. Documented in PR body. |
| R13 | Renovate's age gate (PR-creation-time) vs Bun's (install-time) semantic mismatch. | `vulnerabilityAlerts.minimumReleaseAge: "0 days"` aligns with SECURITY.md "CVE-on-Friday" runbook. |
| R14 | Routing group churn — bumping `vue` should not wait on `vue-router`. | Routing group is `["vue-router", "vite-plugin-pages"]` only. `vue` stays individual. |

---

## 3. Scope A — phases

### 3.1 Recon

- `unplugin-vue-router` is **not** in `vite.config.ts:108-279`. The only generated artifact is `packages/extension/src/types/typed-router.d.ts`.
- `auto-imports.d.ts:67-68` carries two dead lines (`defineLoader`, `definePage`). Grep `definePage|defineLoader` against `src/` minus generated `.d.ts` → zero matches.
- vue-router surface in `src/`: 6 imports + ~30 `router.push|.replace|.back|RouterLink` call sites. All use path strings or untyped objects (e.g., `modules/general/SplittedBalancesView.vue:58`).
- `useRoute`/`useRouter`/`onBeforeRouteLeave`/`onBeforeRouteUpdate` auto-imported via `vite.config.ts:152`; declared in `auto-imports.d.ts:122-123`.
- `vue-router@4.6.4` resolves today per the storybook cache metadata. 4.6.4 → 5.0.5 is one clean major.
- **Gate-aware pin**: vue-router 5.0.5 published 2026-04-22 (26d, safe). 5.0.6/5.0.7 inside the 7d gate today. **Pin `^5.0.5`** — caret advances as 5.0.6/5.0.7 age out under Renovate or the next manual `bun update`.

### 3.2 Phases (one PR, two commits)

**A1 — Drop the dead `unplugin-vue-router` apparatus.**

1. `packages/extension/package.json:101` — delete `"unplugin-vue-router": "^0.15.0"` from devDeps.
2. `packages/extension/src/types/typed-router.d.ts` — delete the entire file (141 lines).
3. `packages/extension/src/types/auto-imports.d.ts` — delete lines 67 (`defineLoader`) and 68 (`definePage`). Easiest path: run `bun run dev` once after the package.json edit — `unplugin-auto-import` regenerates without the dead lines. Commit the regenerated diff.
4. `bun install` → updates `bun.lockb` (still binary per `SECURITY.md:305-308`).

Validation: `bun run typecheck:all && bun run lint && bun run build && bun run test:e2e`.

**A2 — vue-router 4 → 5.**

1. `packages/extension/package.json:71` — change to `"vue-router": "^5.0.5"`.
2. `bun install`.
3. `bun run typecheck:all`. If types narrowed, fix at the 7 call sites identified in §3.1 (most likely candidate is the guard at `popup/index.ts:50`).
4. `bun run dev` once → `unplugin-vue-components` refreshes `components.d.ts:50-51`. Commit any drift.
5. Local hygiene: `rm -rf packages/extension/node_modules/.cache/storybook` (see R6).

Validation: `bun run audit:vue` + `bun run test:e2e` + manual click-through `/popup/auth → /popup/general → /popup/send → /popup/settings/connected-apps/<id>` to exercise the guard, `router.push|.replace|.back`, `RouterLink` render, and `route.meta.showBottomNav` (consumed at `app.vue:35,324`).

### 3.3 Why one PR with two commits

Both commits are mechanical-only. A1 alone is a valid state (codebase compiles fine with vue-router 4 + no `unplugin-vue-router`, since the plugin was never in the vite chain). A2 layers on. Two commits give a clean revert point for either half without two reviews.

---

## 4. Scope B — Renovate config

Base = `dependency-hardening/plan.md §13` draft, with the corrections below. File: `renovate.json` at repo root.

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],

  "rangeStrategy": "in-range",
  "minimumReleaseAge": "7 days",
  "vulnerabilityAlerts": {
    "enabled": true,
    "minimumReleaseAge": "0 days",
    "labels": ["security"]
  },

  "prConcurrentLimit": 3,
  "prHourlyLimit": 2,
  "dependencyDashboard": true,
  "labels": ["dependencies"],
  "schedule": ["before 6am on monday"],
  "timezone": "America/Argentina/Buenos_Aires",

  "commitMessagePrefix": "chore(deps):",
  "commitMessageAction": "bump",
  "commitMessageTopic": "{{depName}}",
  "commitMessageExtra": "to {{newVersion}}",

  "packageRules": [
    {
      "matchPackageNames": [
        "/^@aztec\\//",
        "@alejoamiras/aztec-accelerator",
        "@defi-wonderland/aztec-standards",
        "@wonderland/aztec-fee-payment"
      ],
      "enabled": false,
      "description": "Aztec line: class-id stability per SECURITY.md. Manual via Aztec milestone."
    },
    {
      "matchPackageNames": ["@types/node"],
      "allowedVersions": "<25",
      "description": "Pinned to Node 24 lifecycle."
    },
    {
      "matchPackageNames": ["vue-router", "vite-plugin-pages"],
      "groupName": "routing",
      "description": "Coupled file-system-router plugins."
    },
    { "matchPackageNames": ["vite", "@vitejs/plugin-vue"], "groupName": "vite" },
    { "matchPackageNames": ["vitest", "@vitest/coverage-v8", "@vue/test-utils", "jsdom"], "groupName": "test-runner" },
    { "matchPackageNames": ["puppeteer", "puppeteer-core", "@puppeteer/browsers", "chromium-bidi"], "groupName": "puppeteer" },
    { "matchPackageNames": ["/^unplugin-/"], "groupName": "unplugin-*" },
    { "matchPackageNames": ["/^@codemirror/"], "groupName": "codemirror" },
    { "matchPackageNames": ["/^@commitlint/"], "groupName": "commitlint" },
    { "matchPackageNames": ["typescript", "vue-tsc"], "groupName": "typescript" },
    { "matchPackageNames": ["/^@storybook/", "storybook"], "groupName": "storybook" },
    { "matchPackageNames": ["webextension-polyfill", "@types/webextension-polyfill"], "groupName": "webextension-polyfill" },
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["patch", "minor"],
      "automerge": false
    }
  ]
}
```

### 4.1 Corrections vs the §13 draft

1. **Regex anchor.** Draft uses `/^@aztec/` which matches `@aztec-anything` (e.g. `@aztec-fake/x`). Verified in Node: `/^@aztec/.test("@aztec-fake/x") === true`; `/^@aztec\//.test("@aztec-fake/x") === false`. Use `/^@aztec\//` (escaped in JSON: `"/^@aztec\\//"`). **Catches `@aztec/viem` (separately versioned 2.38.2 per `package.json:78`)** — confirmed by the same regex test.
2. **Drop `unplugin-vue-router` from the routing group.** Scope A removes it. Routing = `["vue-router", "vite-plugin-pages"]`.
3. **`vue` NOT in routing group.** Independent bumps.
4. **`prHourlyLimit: 2` added.** Without it, Day-1 burns review bandwidth.
5. **`@types/node` allowedVersions: "<25"** explicit upper bound. Renovate still bumps 24.x patch/minor.
6. **Puppeteer group.** The family is four packages today (`puppeteer`, `puppeteer-core`, `@puppeteer/browsers`, `chromium-bidi`) — mirrors `bunfig.toml:44`. Avoid PR-storm-of-four per release.
7. **Schedule timezone.** `before 6am on monday` is ambiguous without TZ. Buenos_Aires per user.
8. **Commit message shape.** `.commitlintrc.json` extends `@commitlint/config-conventional` (lowercase subject required). `commitMessagePrefix: "chore(deps):"` complies. Default Renovate format `chore(deps): bump foo to 1.2.3` matches the 100-char header cap.

### 4.2 What I'm intentionally NOT doing

- **No `automerge`** anywhere — wallet is security-sensitive; user is wary of bot noise.
- **No `lockFileMaintenance`** — `bun.lockb` is binary today; revisit after the text-lockfile migration.
- **No explicit `github-actions` manager rule.** Renovate auto-detects `.github/workflows/*.yml`.
- **No self-hosted Renovate workflow file.** Hosted App is free for private repos.

### 4.3 PR body / runbook copy (verbatim)

> **Install order**: merge this PR first. Then install the hosted Renovate App at https://github.com/apps/renovate, scoping to this repo. The App reads `renovate.json` from `main` after first scan; expect the Dependency Dashboard within ~15 minutes.
>
> **First-cycle expectations**: with `prConcurrentLimit: 3` + `prHourlyLimit: 2`, the Dashboard lists 20-40 candidate updates, but only 3 PRs open at a time. Merge or close at your own pace.
>
> **`@aztec/*` disabled**: PRs will never auto-open for the Aztec line. Manual bumps via the Aztec milestone (SECURITY.md "Crypto-bound invariants" — class-id stability).
>
> **CVE bypass**: `vulnerabilityAlerts.minimumReleaseAge: "0 days"` lets Renovate open a PR immediately for an advisory inside the 7-day gate window. Pair with the SECURITY.md "CVE-on-Friday" runbook.

---

## 5. Test strategy per phase

Network e2e is **skipped** in both scopes — neither touches Aztec/PXE.

| Phase | typecheck | unit + component | lint | build | smoke e2e | Extra |
|---|---|---|---|---|---|---|
| A1 (drop unplugin) | yes | yes | yes | yes | – | Diff `components.d.ts` + `auto-imports.d.ts` to confirm regen produces the same shape minus the two dead lines. |
| A2 (vue-router 5) | yes | yes — incl. `SubPageHeader.test.ts:7-8`, `Button.test.ts:60` | – | yes | yes | 30s manual click-through (see §3.2). |
| B (Renovate) | – | – | – | – | – | `bunx --bun renovate-config-validator renovate.json` locally. Optional CI step (Q4 below). |

A2's manual click-through is justified because the central guard is `popup/index.ts:50-96`. If vue-router 5 changed guard arity or `next()` semantics, smoke e2e catches it (auth fixture exercises the guard). The manual sweep covers `router.push|.replace|.back` + `RouterLink` rendering + `route.meta` consumers at `app.vue:35,213,324` and `Header.vue:208`.

---

## 6. UX copy concerns

Vue-router 5 ships **no user-visible strings**. The two strings consumed by the popup from vue-router state are `route.meta.*` (wallet-owned) and `route.name` (wallet-owned). The 404 page `pages/[...catch].vue:3` redirects via `router.push("/popup/general")` — no vue-router string crosses the seam.

Renovate PR copy must match `.commitlintrc.json` (extends `@commitlint/config-conventional`). Verified: `commitMessagePrefix: "chore(deps):"` + default `{topic} to {newVersion}` produces `chore(deps): bump vue-router to 5.0.7`. Lowercase subject ✓; `chore` type ✓; `deps` scope ✓; ≤100 chars on every realistic dep name ✓. The `.githooks/commit-msg` hook runs commitlint on Renovate commits too — a violation fails CI before auto-rebase, surfacing clearly.

---

## 7. Open questions for user

1. **A1 + A2 in one PR (rec) or split?** Both are mechanical; risk is identical.
2. **Manifest pin `^5.0.5` (rec) vs `^5`?** Concrete patch gives an audit-trail signal; clean caret is cleaner-looking. Both behave the same in practice.
3. **Renovate install runbook**: `.github/ISSUE_TEMPLATE/renovate-install-checklist.md` or just PR body? **Rec: PR body only.**
4. **Add CI step `bunx --bun renovate-config-validator renovate.json` to `_lint-and-typecheck.yml`?** Tiny step, catches typos. **Rec: yes, one-line addition.** Could defer to follow-up.
5. **Schedule**: `before 6am on monday` (BA TZ) gives a predictable Monday cadence. Acceptable, or shift looser? **Rec: keep Monday.**
6. **Group `vite-plugin-pages` with `vite-plugin-node-polyfills`?** **Rec: no** — they couple to different majors.

---

## 8. PR map (opinionated)

**Two PRs, in order**:

### PR 1 — `chore(deps): drop unplugin-vue-router and bump vue-router to 5`

Two commits:

| Commit | Subject | Diff |
|---|---|---|
| 1 | `chore(deps): remove archived unplugin-vue-router` | Delete `typed-router.d.ts`; regenerate `auto-imports.d.ts` (drops lines 67-68); drop devDep. |
| 2 | `chore(deps): bump vue-router to ^5.0.5` | Manifest bump; `components.d.ts` regenerated if drift. |

Gate: `bun run audit:vue` + `bun run test:e2e` + manual click-through.

### PR 2 — `chore(deps): add renovate config`

Single commit. Ships only `renovate.json`. Optional one-line CI validator step if Q4 is yes.

Gate: `bunx --bun renovate-config-validator renovate.json` locally.

**Order matters.** PR 1 trims the routing group from 3 packages to 2, so PR 2 ships the accurate group from the start. Reversed order means PR 2 carries a stale group definition that PR 1 then amends.

---

## 9. Notable flags

1. **`unplugin-vue-router` is devDeps-only.** Removing it is documentation cleanup, not a feature change. The "archive" headline is misleading in this repo's context — we were never on typed-routes. Watch out for the consolidated plan over-claiming user impact.

2. **`auto-imports.d.ts` regen workflow.** Regenerates on Vite plugin tick, not on `bun install`. After A1's manifest edit, run `bun run dev` once, wait for Vite's regenerate log, kill, commit. CI doesn't regenerate — if you forget, lint passes but the file carries dead imports. Note this in the PR description.

3. **Storybook cache invalidation (R6).** Local hygiene only; not a CI concern. Mention in the PR body so reviewers know `bun run --cwd packages/extension build-storybook` may need a local cache wipe.

4. **First-cycle Dependency Dashboard volume.** ~80 distinct npm deps × 8 workspaces. `dependency-hardening` already shipped many patches manually, so first-cycle Renovate volume is mostly minors/majors that were deferred. Estimate: 10-15 first-cycle PRs at `prConcurrentLimit: 3` = ~5-7 weekday merges to drain.

5. **`bunfig.toml#minimumReleaseAgeExcludes` ↔ Renovate timing.** Current excludes are `["puppeteer", "puppeteer-core", "@puppeteer/browsers", "chromium-bidi"]` — temporary, removable ~2026-05-19 16:08 UTC. Renovate's `minimumReleaseAge: "7 days"` does NOT honor those excludes (different mechanism). The first puppeteer Renovate PR could trip the age gate at install time. **Rec: time PR 2 for ≥ 2026-05-19** — cleaner than a temp `packageRules` carve-out.

6. **Renovate auto-detects `package.json#packageManager`** (currently `bun@1.3.13`). Renovate's `bun` manager bumps this field directly. **A Bun version PR opened this way is incomplete** — it doesn't sync `.github/actions/setup-bun/action.yml`'s pinned version. Easy to spot via `bun run audit:vue` CI failure. Document in the PR body that Bun version PRs need a secondary edit to `setup-bun/action.yml`.

7. **`vite-plugin-pages` is at `^0.33.1`.** Sub-major. Renovate's `in-range` strategy bumps minors automatically, but in `0.x` SemVer convention, minors can be breaking. **Run smoke e2e by hand on every routing-group PR** until `vite-plugin-pages` reaches 1.0.

8. **`@aztec/viem` (2.38.2) matches `/^@aztec\//`** — verified empirically in Node. The disabled rule catches it without a carve-out.

9. **`config:recommended` is opinionated.** It bundles `:dependencyDashboard`, `:semanticCommits`, `:ignoreUnstable` (skips alphas/betas), `:prImmediately` (we throttle via `prHourlyLimit`), and `replacements:all` (replaces deprecated packages — harmless). Our overrides tune concurrency, age gate, schedule, Aztec/types-node carve-outs.

10. **No need for a Renovate workflow file.** Hosted App handles scheduling. Self-hosted Renovate would be a follow-up if/when leaving the App.

---

## 10. Summary recommendation

- **Scope A**: one PR, two commits, mechanical. Pin `^5.0.5`. ~1h work + gates.
- **Scope B**: one PR after A. `renovate.json` only. Land **after 2026-05-19** to clear the puppeteer age-gate exception window. ~30min work.
- **Resolve before PR 1**: Q2 (`^5.0.5` vs `^5`).
- **Resolve before PR 2**: Q4 (validator CI step), Q5 (schedule).
- **Risks I'd watch closest**: R10 (rule precedence on `@aztec/*` — disable rule must be FIRST in `packageRules`), R7 (`auto-imports.d.ts` regen step is easy to forget), §9.5 timing of PR 2.
