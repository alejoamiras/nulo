# Shared brief — design-system-externalization (round 1: L0–L2 beachhead)

Factual foundation for all three parallel planners (main + codex + fable). Verify against the
repo before trusting; extend where thin. Repo-relative paths only.

## Goal

Externalize the extension's framework-pure frontend primitives into the **existing** shared
package `@nulo/design`, so both the extension and the faucet consume one canonical source.
Round 1 is a **beachhead**: tokens + the lowest two component layers only. L3 composites and
L4 feature modules are deferred to a follow-up plan.

## Locked decisions (from clarifying answers — do NOT re-litigate)

1. **Home:** grow the existing `@nulo/design` as ONE package with internal layer dirs
   (`tokens` / `core` / `ui`). Not a split into 3 packages.
2. **Scope (round 1):** L0 tokens + L1 core primitives + L2 ui primitives only.
   - L1 core (`packages/extension/src/components/core/`): `Flex`, `Icon`, `MaterialIcon`, `Text`.
   - L2 ui (`packages/extension/src/components/ui/*.vue`, top-level only): `Badge`, `Banner`,
     `BrutalistTitle`, `Button`, `Checkbox`, `Input`, `LoadingState`, `Popover`, `SectionLabel`,
     `Spinner`, `SubPageHeader`, `ToastManager`, `Toggle`, `Tooltip`.
   - L3 composites + L4 modules: OUT (follow-up plan).
3. **Styling:** migrated components carry **self-contained scoped styles** + consume shared
   CSS-var tokens. No dependency on the extension's global SCSS utility classes.
4. **Gates:** typecheck:all + lint (incl. biome layer rules) + component tests on every phase;
   build (extension + faucet) at milestone phases; smoke + network e2e before final merge.
5. **Duplicate reconciliation:** the **extension's** component API is canonical. The faucet
   adapts to it and gets re-verified (visual + e2e). Affected duplicates: extension `Button`
   vs design `AppButton`; `Spinner` (both); extension `ToastManager` vs design `Toast`;
   extension `Badge` vs design `Tag` (confirm whether truly equivalent).
6. **Out of scope:** `@nulo/playground` (vanilla TS, no Vue), `@nulo/landing` (no Vue).

## Current state (verified)

| Package | Vue UI | Consumes `@nulo/design` | Notes |
|---|---|---|---|
| `@nulo/design` | 5 `ui` + 5 `composite` + tokens + `base.css` | — | Has `exports` map + vue peer-dep. **No README.** `version 0.1.0`. |
| `@nulo/faucet` | 19 `.vue` | YES — 9 import sites | Bridge UI lives here. Only current consumer. |
| `@nulo/extension` | 182 `.vue` (~18 in core+ui top-level) | NO — 0 import sites | Mature primitives; canonical API. |
| `@nulo/playground` | 0 `.vue` (vanilla TS) | NO | Out of scope. |
| `@nulo/landing` | no vue | NO | Out of scope. |

`@nulo/design` exports map (`packages/design/package.json`):
`. -> src/index.ts`, `./tokens -> src/tokens.ts`, `./base.css`, `./ui/*`, `./composite/*`.
Existing design components: `ui/` = AppButton, Card, Spinner, Tag, Toast;
`composite/` = AddressDisplay, BalanceRow, DisclaimerTag, DripButton, EmojiGrid (all L3 — stay).

## Key facts that drive the plan

- **Tokens are an admitted fork.** `packages/design/src/tokens.ts` (83 lines) header literally says
  *"Vendored from packages/extension/src/design/tokens.ts and trimmed to the subset the faucet
  actually uses."* `packages/extension/src/design/tokens.ts` (198 lines) declares itself the
  **SINGLE SOURCE OF TRUTH** for token names. Token *values* (the `--var: value` declarations)
  live in SCSS: `packages/extension/src/assets/styles/_base.scss`,
  `packages/extension/src/popup/index.scss`, `packages/extension/src/setup/index.scss`.
  The design package separately ships `packages/design/src/base.css` with its own var
  declarations, and the faucet does `import "@nulo/design/base.css"`.
  → Token unification must decide: who owns the canonical names AND the canonical var
  declarations, and how the extension (SCSS world) and faucet (css world) both consume them
  without drift. This is the highest-blast-radius decision.

- **Styling coupling varies per component** (this sets per-component migration cost under the
  "self-contained scoped styles" rule):
  - `core/Icon.vue`, `ui/Button.vue`: already use `<style module>` (CSS modules) — portable.
  - `core/Text.vue`: NO style block; styles **entirely** via global utility classes it pushes as
    strings: `fz--${size}`, `fw--${weight}`, `lh--${height}` (declared in the extension SCSS).
    Canonical hard case — must be rewritten to scoped styles driven by tokens.
  - `core/Flex.vue`, `core/MaterialIcon.vue`: no `<style>` block (layout/wrapper; verify how
    they style — likely props + utility classes).

- **biome layer enforcement** (`biome.json`, `noRestrictedImports` overrides — 9 blocks):
  - A cross-package rule ALREADY exists: `@nulo/design` may not import any `@nulo/*`
    (*"@nulo/design is the lowest layer"*). So the package boundary already encodes design as
    the floor.
  - The extension's internal L0–L6 layer rules are **path-based** on `src/components/**`. When a
    component moves into `@nulo/design`, its old path-based rule no longer applies; the package
    needs its OWN internal `tokens < core < ui` enforcement, and the extension importing FROM
    `@nulo/design` must be constrained to the correct layer.

- **Faucet's `@nulo/design` imports** (round-1-relevant L0–L2 overlap): `AppButton`, `Spinner`,
  `Toast`, plus `@nulo/design/base.css`. (It also uses L3 `AddressDisplay`, `BalanceRow`,
  `DisclaimerTag`, `DripButton`, `EmojiGrid` — those stay as-is.)

- **Storybook** lives only in the extension: `packages/extension/.storybook/`, globbing
  `../src/components/**/*.stories.@(ts|vue)` + `../src/design/**/*.stories.@(ts|vue)`.
  Decision: do migrated primitives' stories move into `@nulo/design` (and Storybook glob it),
  or stay in the extension importing from the package?

## Hard constraints (from CLAUDE.md / ARCHITECTURE.md — non-negotiable)

- **testid preservation:** every `data-testid` survives a move verbatim. e2e selects ONLY by testid.
- **Colocated tests:** `<Name>.test.ts` next to `<Name>.vue`. Coverage mins: L1/L2 ≥5 cases.
- **SFC ordering convention** + **code-comment style** (why/invariant only) apply to moved files.
- **No `chrome.*` in the lib** (already structurally guaranteed — design can't import `@nulo/*`).
- **Bun** PM, **Biome** lint+format, **Conventional Commits** (lower-case subject), squash-merge
  to `dev`, signed commits, branch-up-to-date NOT required on dev.
- `audit:vue` = typecheck:all → test → lint → build (the one-shot pre-PR gate; excludes e2e).

## Open decisions for planners to resolve (diverge here)

1. **Token unification mechanism:** package owns canonical names + `base.css` var declarations;
   extension migrates off its SCSS-declared vars to import the package's base — OR package
   re-exports names while extension keeps SCSS declarations — OR a generated/single-source
   approach. How to prevent re-drift (a test? a generator?).
2. **SCSS → self-contained styles** without visual regression, esp. `Text.vue` (utility-class →
   scoped). How to prove no visual regression (Storybook? snapshot? manual?).
3. **Internal layer enforcement** for `@nulo/design` (`tokens < core < ui`): biome path rules?
   And how the extension consumes the package at the right layer.
4. **Sequencing:** tokens-first vs scaffold-first; how to keep each phase independently
   shippable and green; how many PRs.
5. **Faucet reconciliation** without breaking its UI when extension APIs replace
   `AppButton`/`Toast`/`Spinner`.
6. **Storybook destination** for migrated primitives.
7. **Migration mechanics:** copy-then-delete vs move; how to keep the extension green during the
   transition (re-export shim? big-bang per layer?).

## Real validation commands (use these verbatim in gates)

- `bun run typecheck:all` — vue-tsc across `@nulo/*`.
- `bun run test` (extension) · `bun run test:faucet` · `bun run --cwd packages/design test` (vitest).
- `bun run lint` — biome, includes `noRestrictedImports` layer enforcement.
- `bun run build` (extension) · `bun run build:faucet`.
- `bun run audit:vue` — one-shot: typecheck:all → test → lint → build.
- `bun run test:e2e` — smoke (no Aztec sandbox).
- `bun run e2e:agent` — network suite, parallel-safe per worktree (~25 min).
- `bun run --cwd packages/extension build-storybook`.
