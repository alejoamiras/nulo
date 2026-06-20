# Phase 1 — Foundation / guardrails

**Status:** ✓ green. PR: `chore/design-r2-p1-guardrails` (branch off `dev`).

## What shipped
1. **Storybook rolldown fix** (`packages/extension/.storybook/main.ts`). Reproduced first — the break
   is exactly the audited cause: `viteFinal` spread the inherited **array-form** alias
   (`viteConfig.resolve.alias` from `vite.config.ts`, array-form for its regex `find` shims) into an
   **object literal**, corrupting each entry's `replacement` into an object → rolldown's `ViteAlias`
   builtin: `StringExpected … {"find":"@","replacement":"./src"}`. Fix = a clean object-form alias map
   (`@`/`~` → `../src`) instead of inheriting the array; the function-bind/WASM regex aliases are
   build-only and irrelevant to story rendering. Added `../../design/src/**/*.stories.@(ts|vue)` to the
   glob. `build-storybook` now completes (`✓ built`). No fallback descope needed — pure config fix.
2. **biome `ui`-layer rule** (`biome.json`, `packages/design/src/ui/**`): bans `@nulo/*` + `chrome` +
   `../composite/*`/`**` (ui ⊄ composite), mirroring the existing core-layer block.
3. **boundary.test.ts hardening**: added (a) no-`vue-router` import, (b) no raw-HTML sink
   (`v-html`/`innerHTML`/`domPropsInnerHTML`) tripwire, (c) a ui-layer biome-rule-exists assertion.
4. **Resolver-inventory test** (`packages/extension/scripts/design-resolver.test.ts`): pins
   `NULO_DESIGN_COMPONENTS` to EXACTLY the deleted-and-migrated set (round-1 9 names now; grows per
   phase) + asserts wrapper-backed names (Button/SubPageHeader/ToastManager) are absent. Lives in the
   extension (design can't import the extension's resolver); `scripts/**/*.test.ts` is already in the
   extension vitest include.
5. **Faucet parity guard** (`packages/faucet/src/app.css.parity.test.ts`): rule-presence check over
   `app.css ∪ @nulo/design/base.css` for the 5 round-1-restored host element-globals (the missing-rule
   class the round-1 regression exposed; token-drift tests can't see it).

## Lessons / gotchas
- **`?raw` CSS imports return EMPTY under the faucet's jsdom vitest** (the vue/css pipeline swallows
  them — all 7 parity checks failed including html/body rules that definitely exist). Then
  `createRequire(import.meta.url).resolve(...)` threw `TypeError: The URL must be of scheme file`.
  **Fix that worked:** plain `fs.readFileSync` off `dirname(fileURLToPath(import.meta.url))` + the
  monorepo-relative path `../../design/src/base.css`. (Acceptable coupling for a monorepo parity guard.)
- The `ComponentResolver` return type is a function|object union (not directly callable in TS) — cast
  to `(name) => {…} | undefined` in the test.
- `bun run lint` exits 0 with 53 pre-existing warnings (warnings don't fail `biome check`); my 5
  changed files are biome-clean.

## Validation gate — all green
- `bun run typecheck:all` → 0 (11 packages). `bun run --cwd packages/design test` → 141 passed.
  `bun run test` → 2453 passed (+resolver-inventory). `bun run test:faucet` → 343 passed (+parity).
  `bun run lint` → 0. `bun run build` → built. `bun run build:faucet` → built.
  `bun run --cwd packages/extension build-storybook` → built successfully.
