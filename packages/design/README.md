# @nulo/design

The shared, framework-/host-agnostic design system for Nulo apps (the wallet **extension** and the
**faucet**). **Presentational only** — components take their data and any `data-testid` via props and
never import app utilities, stores, service clients, or `chrome.*`.

## Layers (low → high)

- **L0 tokens** — `src/token-contract.ts` (canonical source) → generated `src/tokens.ts`
  (+ `src/base.css` in round-1 Phase 2).
- **L1 core** — `src/core/**` primitives: `Flex`, `Icon`, `Text`, `MaterialIcon` _(round-1 Phase 3)_.
- **L2 ui** — `src/ui/**` ui primitives.
- **L3 composite** — `src/composite/**`.

A lower layer cannot import a higher one (biome enforces `core ⊄ ui`). The package **floor** bans any
`@nulo/*` import and `chrome.*` — via biome `noRestrictedImports` / `noRestrictedGlobals` (see
`biome.json`) plus `src/boundary.test.ts`, which also audits the `window.chrome` /
`globalThis["chrome"]` / `webextension-polyfill` indirections biome can't see and pins the floor so a
PR can't silently weaken it.

## Tokens (single source)

The canonical token names + scales live in **`src/token-contract.ts`**. **`src/tokens.ts` is
GENERATED** from it by `scripts/gen-tokens.ts` — never hand-edit it. After editing the contract:

```
bun run gen:tokens
```

`src/tokens.drift.test.ts` byte-pins the generated file (fails CI on divergence — modeled on the
repo's other generated-artifact pins). Per-theme VALUES (used to generate `base.css`) arrive in
round-1 Phase 2 (the base/theme/font takeover).

## Consumers compile the source

The package ships **Vue SFC + TS source** (no build step); each consumer's Vite/`vue-tsc` compiles it.
There is **no auto-import** in this package — every component, Vue API, and helper uses **explicit
imports** (consumers like the faucet have no `unplugin-auto-import`/`unplugin-vue-components`). The
extension keeps `<Tag>` templates working by mapping `@nulo/design` component names through a custom
`unplugin-vue-components` resolver, so call sites and `data-testid`s are untouched.

Import the global stylesheet once at app entry: `import "@nulo/design/base.css"`. Fonts are
package-owned (round-1 Phase 2).

## Scripts

- `bun run gen:tokens` — regenerate `src/tokens.ts` from the contract.
- `bun run typecheck` — `vue-tsc --noEmit`.
- `bun run test` — vitest (drift, boundary, component tests).

## Exports

`.` (barrel) · `./tokens` · `./base.css` · `./core/*` · `./ui/*` · `./composite/*`.
