# M3.6 — Extract `@nulo/extension-ui` (~3-5 days) — **DEFERRED**

**Status (2026-04-25)**: **deferred indefinitely**. The codex xhigh audit
of the revised plan surfaced 4 BLOCKING issues (typed-SFC type loss across
the package boundary, auto-import environment not portable, 5 false-positive
"safe to move" files with hidden `@/...` deps, missing scaffold deps). The
boundary itself is also unmotivated: there is no second UI consumer
planned (no mobile wallet, no web wallet, no SDK that embeds the auth
flow), no plan to publish the UI primitives as an open-source library,
and M3.7's dependency-cruiser can enforce the UI/services boundary at
**directory level** without a package move (e.g. `src/components/ui/**`
forbidden from importing `src/wallet/services/**`).

The "directory split that pretends to be a package" model would deliver
no structural value while incurring scaffold + workspace + version
overhead. The "real package boundary" model is 1-2 weeks of work
(explicit-import refactor on ~25-30 SFCs, vue-tsc declaration emission,
shim rework) and pays off only when the second UI arrives.

**Decision rule when revisiting**: revive M3.6 only if at least one of:
1. A second UI consumer is concretely planned within 12 months
2. Goal of publishing primitives to npm
3. M5.1 component tests benefit materially from MV3-free isolation
4. M3.7 dep-cruiser at directory level proves insufficient

The audit findings, codex transcript, and the codex `UNCLEAR` insight
("the plan needs to choose ONE of: real package boundary or directory
split") are preserved below as the historical record. **Do not execute
this plan without a fresh revision.**

---

**Status (when drafted)**: revised against master `954b4d2` (0.13.0 — post brutalist redesign)
**Prerequisite**: `cleanup/typecheck-green` shipped (`bun run typecheck:all` clean across 8 packages, blanket `*.vue` shim in place at `packages/extension/src/shims-vue.d.ts`).

## Why this revision exists

The original M3.6 plan was drafted before:
1. **Brutalist redesign arc** (40 commits) which rebuilt many components, deleted ~5 popups, promoted others to full-page routes, and added `defineSlots`-typed slots to several primitives.
2. **Typecheck cleanup** which dropped extension's typecheck error count 113 → 0 and added a blanket `declare module '*.vue'` shim that prevents the canonical M3.6 risk (`TS7016` cascade across cross-package SFC imports).

These two events change M3.6's risk profile downward (vue-tsc can now verify the move; the shim prevents the worst breakage class) but require concrete plan adjustments to match current file layout.

## Goal

Extract the **dumb UI primitives** — pure Vue + CSS + `vue` + `vue-router` deps only — into `@nulo/extension-ui`. Keep service-bound components, stores, page-level files, and entry-point screens in `@nulo/extension`. M3.6 is one of the safer extractions in M3 *as long as* purity is enforced at move time.

## Non-goals

- **No store extraction.** Pinia stores import service clients; they stay.
- **No page extraction.** `src/popup/pages/*` use stores + service clients; they stay.
- **No entry-point screen extraction.** `src/components/install.vue` + `update.vue` use `__VERSION__` / `__DISPLAY_NAME__` Vite defines; they stay in extension.
- **No `.js` composable rewrites.** `toast.js`, `notification.js`, `outside.js` are still untyped JS. Out of scope; they stay until separately rewritten as `.ts`.
- **No SCSS asset migration.** Fonts + global theme/reset stay in extension because `_base.scss` references `url("@/assets/fonts/...")` — a cross-package SCSS url() resolution rabbit hole we explicitly avoid (see Risk #4).
- **No feature changes.** Pure refactor — visual + behavior must be unchanged.

## Audit pass (ground-truth file inventory at master `954b4d2`)

### Components — SAFE TO MOVE (22 files)

Verified via `grep -rl "@/wallet/services\|@/stores\|configClient\|externalLinks\|externalImage\|managers\.\|chrome\." packages/extension/src/components/`:

| Path | Notes |
|---|---|
| `src/components/core/Flex.vue` | Layout primitive |
| `src/components/core/Icon.vue` | Wraps Material Symbols |
| `src/components/core/MaterialIcon.vue` | Material Symbols wrapper |
| `src/components/core/Text.vue` | Typography primitive |
| `src/components/Divider.vue` | uses `defineSlots` (lang=ts already) |
| `src/components/ui/Badge.vue` | |
| `src/components/ui/Banner.vue` | brutalist action button (added in 0.13.0) |
| `src/components/ui/Button.vue` | brutalist variants |
| `src/components/ui/Checkbox.vue` | brutalist (hard square, inverted on check) |
| `src/components/ui/Input.vue` | brutalist variant + error prop (0.13.0) |
| `src/components/ui/LoadingState.vue` | from M2 LoadingState unification |
| `src/components/ui/Popover.vue` | |
| `src/components/ui/Popup/PopupHeader.vue` | NB: PopupCard.vue + Popup.vue STAY (service deps) |
| `src/components/ui/SectionLabel.vue` | |
| `src/components/ui/Settings/ItemsContainer.vue` | brutalist `flat` prop (0.13.0) |
| `src/components/ui/Settings/SettingField.vue` | |
| `src/components/ui/Settings/SettingItem.vue` | |
| `src/components/ui/Settings/SettingValue.vue` | uses `defineSlots` (lang=ts already) |
| `src/components/ui/Spinner.vue` | |
| `src/components/ui/SubPageHeader.vue` | brutalist `#title` slot (0.13.0) |
| `src/components/ui/ToastManager.vue` | |
| `src/components/ui/Toggle.vue` | |
| `src/components/ui/Tooltip.vue` | uses `defineSlots` (lang=ts after typecheck cleanup) |
| `src/components/ui/Dropdown/DropdownDivider.vue` | |
| `src/components/ui/Dropdown/DropdownItem.vue` | |
| `src/components/ui/Dropdown/DropdownRoot.vue` | |
| `src/components/ui/Dropdown/DropdownTitle.vue` | |
| `src/components/ui/Dropdown/DropdownTrigger.vue` | |
| `src/components/ui/utils.ts` | helpers like `getChainName` — **verify pure first** |

**Total movable**: 28 .vue + 1 .ts = **29 files**.

### Components — STAY IN EXTENSION (8 files, all have service/store/managers/chrome deps)

| Path | Reason |
|---|---|
| `src/components/Header.vue` | imports stores |
| `src/components/install.vue` | uses `__DISPLAY_NAME__` / `__VERSION__` Vite defines |
| `src/components/update.vue` | uses `__VERSION__` Vite define |
| `src/components/ui/AddressDisplay.vue` | imports `@/stores/app.store` + `managers.contact` |
| `src/components/ui/GlobalLoader.vue` | imports stores |
| `src/components/ui/JsonViewer/JsonViewer.vue` | uses `chrome.runtime`, `chrome.windows` |
| `src/components/ui/JsonViewer/LogsViewer.vue` | imports services |
| `src/components/ui/NotificationManager.vue` | imports stores |
| `src/components/ui/Popup/Popup.vue` | uses `managers.profile?.refreshSession()` |
| `src/components/ui/Popup/PopupCard.vue` | imports stores |

### Composables

| Path | Decision | Reason |
|---|---|---|
| `src/composables/ticker.ts` | **MOVE** | Pure: `setInterval`, no service deps |
| `src/composables/configClient.ts` | STAYS | Imports `ConfigServiceClient` |
| `src/composables/externalLinks.ts` | STAYS | Imports `configClient` |
| `src/composables/externalImage.ts` | STAYS | Imports `configClient` |
| `src/composables/syncedRef.js` | STAYS | Untyped `.js` (out of scope; Phase 2 only added `.d.ts` shim) |
| `src/composables/syncedRef.d.ts` | STAYS | Companion to .js |
| `src/composables/toast.js` | STAYS | Untyped `.js`, out of scope |
| `src/composables/notification.js` | STAYS | Untyped `.js`, out of scope |
| `src/composables/outside.js` | STAYS | Untyped `.js`, out of scope |

**Total movable**: **1 file**.

### Stores

All stay in extension. `app.store.ts`, `popup.store.ts`, `cache.store.ts` all import service clients.

### Assets

| Path | Decision |
|---|---|
| `src/assets/styles/_base.scss` | **STAYS** — uses `url("@/assets/fonts/...")`, would force cross-package alias |
| `src/assets/styles/_flex.scss` | **STAYS** (loaded via `@use` chain rooted in `_base.scss`) |
| `src/assets/styles/_text.scss` | **STAYS** (same) |
| `src/assets/fonts/*` | **STAYS** (referenced from `_base.scss` via `@/`) |

Per-component `<style module>` blocks travel with each .vue file. No cross-package SCSS partials needed.

### `@assets/*` alias

Defined in `tsconfig.json`. **0 usages** across `src/` (`grep -rn "@assets" packages/extension/src/` returns empty). The alias exists but is dead. We can leave it unchanged (no harm) or delete it; not blocking M3.6.

## What `@nulo/extension-ui` actually contains (final picture)

```
packages/extension-ui/
├── package.json
├── tsconfig.json
├── vitest.config.ts        # for future M5.1 component tests
├── src/
│   ├── index.ts            # barrel: re-exports everything
│   ├── components/
│   │   ├── core/           # Flex, Icon, MaterialIcon, Text
│   │   ├── Divider.vue
│   │   └── ui/             # 24 files (19 .vue + 5 dropdown + 4 settings + utils.ts)
│   └── composables/
│       └── ticker.ts
```

## Auto-import strategy (revised — concrete diffs)

The extension's `vite.config.ts` has two scanners that need a second directory added:

### `useComponents` — components scanner

```ts
// vite.config.ts (current, around the useComponents call)
useComponents({
  dirs: ["src/components"],
  dts: "src/types/components.d.ts",
}),
```

```ts
// vite.config.ts (after M3.6)
useComponents({
  dirs: ["src/components", "../extension-ui/src/components"],
  dts: "src/types/components.d.ts",
}),
```

After config update + dev-server bounce, `src/types/components.d.ts` regenerates with both paths' components.

### `useAutoImport` — composables scanner

```ts
// vite.config.ts (current)
useAutoImport({
  imports: [/* vue, vue-router, webextension-polyfill */],
  dts: "src/types/auto-imports.d.ts",
  dirs: ["src/composables/", "src/stores/", "src/utils/"],
}),
```

```ts
// vite.config.ts (after M3.6)
useAutoImport({
  imports: [/* unchanged */],
  dts: "src/types/auto-imports.d.ts",
  dirs: ["src/composables/", "src/stores/", "src/utils/", "../extension-ui/src/composables/"],
}),
```

After regeneration, `useTicker` in `auto-imports.d.ts` should resolve from `../extension-ui/src/composables/ticker`.

### vitest.config.ts — same dirs

The extension's `vitest.config.ts` has its own copies of `useComponents` and `useAutoImport`. Add the same `../extension-ui/...` paths there too, otherwise component tests will fail to resolve the moved primitives.

## Package.json scaffold

```json
{
  "name": "@nulo/extension-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./components": "./src/components/index.ts",
    "./composables": "./src/composables/index.ts"
  },
  "scripts": {
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "vue": "^3.5.18",
    "vue-router": "^4.6.4"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.1",
    "@vue/tsconfig": "^0.7.0",
    "vue-tsc": "^3.0.3",
    "typescript": "~5.9.2",
    "vitest": "^3.2.4"
  }
}
```

**Notes**:
- No `@nulo/wallet-core` dep — components are pure UI primitives, no port consumption.
- No `pinia`, `sass`, `jsdom` listed — none are needed for movable components (pinia is store-only; sass is for SCSS partial compilation which we're not doing; jsdom is for component tests which arrive in M5.1).
- `vue-tsc` for the standalone typecheck script (matches what extension uses, keeps SFC type-emit consistent).

## tsconfig.json scaffold

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM"],
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "src/**/*.d.ts"]
}
```

No paths/aliases — internal imports use relative paths. This avoids confusion at the cross-package boundary; extension consumers reach into extension-ui via `@nulo/extension-ui/components` (subpath export).

## Step-by-step execution

### Step 0 — Create branch + scaffold (15 min)

```bash
git checkout -b m3/6-extension-ui master
mkdir -p packages/extension-ui/src/{components,composables}
```

Create:
- `packages/extension-ui/package.json` (per scaffold above)
- `packages/extension-ui/tsconfig.json` (per scaffold above)
- `packages/extension-ui/vitest.config.ts` (jsdom + vue plugin, for M5.1 readiness)
- `packages/extension-ui/src/index.ts` — empty barrel `export {}` for now
- `packages/extension-ui/src/components/index.ts` — empty barrel
- `packages/extension-ui/src/composables/index.ts` — empty barrel

Run `bun install` to wire workspace dep into the lockfile.

### Step 1 — Re-run purity grep (5 min)

```bash
grep -rl "@/wallet/services\|@/stores\|configClient\|externalLinks\|externalImage\|managers\.\|chrome\." packages/extension/src/components/
```

If the result differs from this plan's STAY list (8 files), update the plan or re-evaluate. **Do not proceed if a movable component grew a service dep since this revision was authored.**

### Step 2 — `git mv` movable files (30 min)

Use `git mv` to preserve blame. Batch in atomic groups for clean rebase:

**Group A — core primitives** (4 files):
```bash
git mv packages/extension/src/components/core/{Flex,Icon,MaterialIcon,Text}.vue packages/extension-ui/src/components/core/
```

**Group B — flat ui/ primitives** (15 files):
```bash
git mv packages/extension/src/components/ui/{Badge,Banner,Button,Checkbox,Input,LoadingState,Popover,SectionLabel,Spinner,SubPageHeader,ToastManager,Toggle,Tooltip}.vue packages/extension-ui/src/components/ui/
git mv packages/extension/src/components/ui/utils.ts packages/extension-ui/src/components/ui/
```

**Group C — Dropdown subdir** (5 files):
```bash
mkdir -p packages/extension-ui/src/components/ui/Dropdown
git mv packages/extension/src/components/ui/Dropdown/*.vue packages/extension-ui/src/components/ui/Dropdown/
```

**Group D — Popup/PopupHeader only** (1 file; Popup.vue + PopupCard.vue stay):
```bash
mkdir -p packages/extension-ui/src/components/ui/Popup
git mv packages/extension/src/components/ui/Popup/PopupHeader.vue packages/extension-ui/src/components/ui/Popup/
```

**Group E — Settings subdir** (4 files):
```bash
mkdir -p packages/extension-ui/src/components/ui/Settings
git mv packages/extension/src/components/ui/Settings/*.vue packages/extension-ui/src/components/ui/Settings/
```

**Group F — Divider** (1 file):
```bash
git mv packages/extension/src/components/Divider.vue packages/extension-ui/src/components/
```

**Group G — composable** (1 file):
```bash
git mv packages/extension/src/composables/ticker.ts packages/extension-ui/src/composables/
```

### Step 3 — Update Vite + Vitest configs (15 min)

Update `packages/extension/vite.config.ts`:
- `useComponents.dirs` += `"../extension-ui/src/components"`
- `useAutoImport.dirs` += `"../extension-ui/src/composables/"`

Update `packages/extension/vitest.config.ts` with the same two changes.

Delete the auto-generated `.d.ts` files so they regenerate fresh:
```bash
rm packages/extension/src/types/components.d.ts
rm packages/extension/src/types/auto-imports.d.ts
```

(They regenerate on first dev-server boot.)

### Step 4 — Add extension-ui as workspace dep (5 min)

```json
// packages/extension/package.json — add to dependencies
"@nulo/extension-ui": "workspace:*",
```

Run `bun install` to wire it.

### Step 5 — Internal imports inside moved files (~30 min)

Some moved files reference each other (Banner uses Button, Tooltip uses MaterialIcon, etc.). Inside `packages/extension-ui/src/`:

- Imports between sibling components in the same dir: keep as relative (e.g., `Tooltip.vue` references nothing here).
- Imports across subdirs: relative (`../ui/Button.vue`, `../core/Icon.vue`).
- Imports from extension paths: **none should remain** — if grep finds any, the file shouldn't have moved.

```bash
# Verification
grep -rE "from \"@/(wallet|stores|composables/configClient|composables/externalLinks|composables/externalImage)" packages/extension-ui/src/
# Expected: no output
```

### Step 6 — `bun run typecheck:all` (5 min)

```bash
bun run typecheck:all
# All 8 packages should still exit 0 (now 9 with extension-ui)
```

If extension-ui itself has errors, they're typically:
- Missing `vue` or `vue-router` dep (add to package.json)
- Internal relative-path imports broken (Step 5 missed something)
- `@/` alias references that pointed into extension (manually remediate — relative paths only)

### Step 7 — Build + dev-server (10 min)

```bash
bun run build  # full Vite production build
```

If build fails on missing components, the auto-import dirs config is wrong. Verify:
```bash
cat packages/extension/src/types/components.d.ts | grep -E "Tooltip|SubPageHeader|Banner"
# Should show paths into ../extension-ui/src/components/...
```

If still missing, the `useComponents` resolver doesn't see the extra dir — check the dir is relative to the vite.config location, not the src/ folder.

### Step 8 — Visual smoke (1-2 days)

Per memory `feedback_mv3_dev_reload_pitfall.md`: full uninstall + fresh install of the extension. Storage retention bites here.

QA checklist (cover the brutalist redesign surface area + classic flows):

- **Onboarding**: register page renders, fonts load (Space Grotesk + Clash Display), inputs accept text, buttons styled
- **Settings → Profile**: brutalist hero + chips
- **Settings → Security → Backup → Seed/Key/Full**: 3 brutalist export pages render
- **Settings → Security → Reset / Change-password / Import**: 3 newer full-page brutalist routes
- **Account list popup**: AccountsPopup renders (uses moved components: Button, Input, Tooltip, etc.)
- **Send flow**: AmountCard + FeeSettingsCard render; tooltip on fee info
- **dApp connect**: discover popup → capabilities popup → execute popup all render
- **Tooltip with `#content` slot**: hover any info icon, content tooltip pops (regression test for Phase 7 typing work)
- **Loading states**: Banner + LoadingState render correctly; from M2 unification arc
- **JsonViewer popup**: opens in new window (this stays in extension, but it consumes moved Tooltip + Button)

If ANY of these fails: do NOT merge; bisect.

### Step 9 — E2E (10 min)

```bash
bun run test:e2e:all
```

Should be 31/31 + 5 skipped, same as before. If a smoke test fails, the most likely cause is auto-import config not picking up the new dir.

### Step 10 — Verify standalone typecheck (5 min)

```bash
cd packages/extension-ui && bun run typecheck
```

Should exit 0 — no service-client deps, just `vue` + `vue-router` types.

### Step 11 — Commit + merge (when QA green)

```bash
git add -A
git commit -m "refactor(extension-ui): extract dumb UI primitives [M3.6]"
git push -u origin m3/6-extension-ui
# After full QA + review:
git checkout master && git merge --no-ff m3/6-extension-ui
```

Bump version (0.13.0 → 0.13.1).

## Risk register (revised)

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **Auto-import dirs ignored** by `unplugin-vue-components` / `unplugin-auto-import` due to relative-path resolution | MED | After config change, delete the generated `.d.ts` files + restart dev server. If still broken, switch to absolute paths via `fileURLToPath` |
| 2 | Component grew a service dep since this revision | LOW-MED | Step 1 grep gates the move |
| 3 | `Tooltip.vue` lost lang="ts" or `defineSlots` declaration in transit | LOW | Diff the .vue files post-move; verify `defineSlots<{...}>` block intact for Tooltip, Divider, SettingValue |
| 4 | **SCSS `url("@/assets/fonts/...")` rebreaks** if anyone moves `_base.scss` to extension-ui later | OUT OF SCOPE | Plan explicitly leaves `_base.scss` + fonts in extension. If a follow-up wants to migrate, that's a separate epic with its own plan |
| 5 | `vue-tsc` doesn't include extension-ui's SFCs in extension's typecheck pass | LOW | Extension's tsconfig still has its own `src/**/*.vue` — moved files are no longer there. Extension-ui has its own typecheck script. `bun run typecheck:all` runs both |
| 6 | `*.vue` shim from typecheck cleanup conflicts with extension-ui's own SFC typing | LOW | Shim is on extension only, doesn't affect extension-ui. Inside extension-ui, vue-tsc emits proper types for lang=ts SFCs |
| 7 | Brutalist redesign visual smoke surface area is large (~10 newly-refactored pages) | MED | Step 8 explicit checklist covers them |
| 8 | `pinia` typed as available globally somewhere in moved components | LOW | Grep moved files for `pinia`/`useStore`/`defineStore` — should be 0 hits |
| 9 | Inter-package circular dep (extension imports extension-ui imports extension) | LOW | extension-ui's package.json explicitly lists only `vue` + `vue-router` deps. Adding `@nulo/wallet-core` later is ok; never add `@nulo/extension` |
| 10 | Pre-commit biome catches new lint warnings on moved files | LOW | Run `bun run lint` before commit |

## Verification matrix (acceptance criteria)

| Check | Expected |
|---|---|
| `bun run typecheck` (extension) | 0 errors |
| `bun run typecheck:all` | 9 packages exit 0 (8 prior + new extension-ui) |
| `cd packages/extension-ui && bun run typecheck` | 0 errors standalone |
| `bun run test` | 458/458 passing |
| `bun run build` | clean, no warnings worse than current bundle-size |
| `bun run test:e2e:all` | 31/31 + 5 intentional skip |
| Manual visual smoke | All 10 checklist items pass |
| `grep "from \"@/" packages/extension-ui/src/` | 0 hits (no `@/` alias usage inside extension-ui) |
| `grep "from \"@nulo/extension/" packages/extension-ui/src/` | 0 hits (no inverse imports) |

## Size estimate (revised)

**3-5 days** (down from "~1 week" in the original):
- 0.5 day: Step 0-2 (scaffold + git mv)
- 0.5 day: Step 3-5 (config wiring + path validation)
- 0.5 day: Step 6-7 (typecheck + build)
- 1-2 days: Step 8 (visual smoke across brutalist surface)
- 0.5 day: Step 9-11 (E2E + commit + push)

The size came down because:
- Concrete file inventory (~29 movable files vs the original "all of `src/components/`")
- Pre-existing typecheck baseline of 0 + blanket `*.vue` shim mean far fewer surprises
- No SCSS partials to migrate (decision documented in Risk #4)

## Out-of-scope follow-ups (deferred, not blocking)

1. **Migrate `.js` composables to `.ts`** and move them to extension-ui (toast, notification, outside, syncedRef). Each is a small standalone refactor.
2. **Extract popup-level "almost-pure" components** like the various brutalist `*.vue` pages from `src/popup/components/` if a future rule says they don't need stores. Current grep shows 41/51 popup components have service deps; the remaining 10 may or may not be worth pulling out.
3. **Migrate global SCSS partials + fonts** to extension-ui. Requires either a cross-package SCSS asset alias or rewriting `_base.scss` to use relative paths from extension-ui. Punted.
4. **Vue component tests in M5.1** — extension-ui is the natural home, but writing them is a separate effort.
5. **`@nulo/extension-ui/composables/configClient`** if a refactor later brings the configClient into ui (would require `@nulo/extension-messaging` as a dep).

## Linkage to M3.7

After M3.6 lands, `bun run check:deps` (M3.7's dependency-cruiser gate) should add a rule:
```
extension-ui must NEVER import from extension
```
This locks the boundary. Until then, the audit is grep-based.

## Open questions for auditor

1. Should `MaterialIcon.vue` move to `core/` or `ui/`? It's in `core/` currently but is more "Material Symbols UI primitive" than "layout primitive."
2. The `ui/utils.ts` file — is it actually pure or does it import from extension paths? Verified pure today, but worth a second look during the move.
3. Is there value in declaring `peerDependencies: { vue }` instead of `dependencies` in extension-ui's package.json, to avoid potential dual-Vue-instance bugs?
4. Should we add the `bun run typecheck:all` filter pattern to also include `playground` and `landing`, or restrict to `@nulo/extension-ui` + the 7 existing packages? (Plan currently uses `@nulo/*` filter which catches all.)
5. Is there an argument for extracting `Tooltip.vue` together with its slot-typing model into a sub-namespace (`@nulo/extension-ui/tooltip`) that consumers explicitly opt into for typed slots? Probably overengineered, but flagging.
