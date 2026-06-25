# Phase 1+2 (collapsed) — Full in-range refresh + fallout

## The mechanism saga (why the libs/tooling split was abandoned)

The plan wanted two attributable stages (libs, then tooling) via `bun update <subset>`. Every Bun mechanism tried broke a different way:

1. `bun update <list>` → writes the listed packages into the **root** `package.json` (pollution), even run from root with workspace deps.
2. `bun update` (root, no list) → only re-resolves **root**'s own deps; children untouched.
3. `rm bun.lock && bun install` → full re-hoist; surfaced latent **under-declarations** (playground imports `zod` without declaring it; design needs `@types/node`; a faucet test broke) because the re-hoist changed which transitive satisfied them.
4. `bun --cwd packages/<x> update` → `Script not found "update"` (`--cwd` is parsed as a script-runner flag, not a dir).
5. **WORKS:** `(cd packages/<x> && bun update)` per child + `bun update` at root. No root pollution; preserves hoisting (so the under-declarations in #3 stay satisfied and do NOT break); refreshes each child's **whole** in-range set.

**Consequence:** #5 refreshes each child's libs AND tooling in one shot — the libs/tooling split is illusory. Collapsed Phases 1+2 into one refresh (user approved push-through). 11 children + root, **186** `bun.lock` entries, **12** `package.json` `^`-floor bumps, all within-major, no root pollution.

## min-age gate held

`bun update` (no `--latest`) respects bunfig `minimumReleaseAge`: full-diff audit of all **186** changed entries (top-level + transitive) = **186/186 ≥7 days**, 0 unverifiable. The week's fresh publishes (vite 8.1.0 06-23, biome 2.5.1 06-23, viem 2.53.1 06-20) were correctly held back — we landed vite 8.0.16, biome 2.5.0, viem 2.52.2. `@types/node` stayed ≤24 (24.2.1→24.13.2).

## Fallout (all from tooling bumps, fixed inline)

biome **2.4.15→2.5.0** promoted three rules + extended SVG linting:
- `noSvgWithoutTitle` → **error**, and 2.5 lints standalone `.svg` files. Hit 4 brand assets (extension logo ×2, faucet + landing favicons). Fix: exclude `**/*.svg` from biome `files.includes` — brand assets are not lint source, and inline `.vue` `<svg>` is still checked.
- `noRedundantRoles` → **error**. Hit `landing/index.html` `<nav role="navigation">` (nav's implicit role). Fix: drop the role.
- `useVueMultiWordComponentNames` → recommended **warning**. Hit 17 intentional single-word primitives (Flex/Icon/Text/Badge/… + Header/Divider). Fix: rule `off` — the single-word naming is the design-system + wallet's deliberate API; renaming 17 components is absurd.

`@webext-core/fake-browser` **1.3.4→1.5.2** pulled `@types/webextension-polyfill` 0.12.3→0.12.5, whose `Alarms.Alarm` is no longer assignable to `chrome.alarms.Alarm` → TS2322 at `session-manager.test.ts:456`. Fix: cast the `getAlarm` helper's return `as Promise<chrome.alarms.Alarm | undefined>`, matching the existing `fireAlarm` cast at :464.

Also bumped biome `$schema` 2.4.15→2.5.0 to match.

## Gate — PASS

`bun install --frozen-lockfile` 0 · audit 186/186 ≥7d · `@types/node` ≤24 · `typecheck:all` 0 · `lint` 0 (0 errors; 55 pre-existing non-blocking warnings: useArrowFunction ×16, noUnusedVariables ×2, useNodejsImportProtocol ×1, …) · `CI=true test:all` 0 (extension 2597, faucet 413, bridge-core 127, all suites green).
