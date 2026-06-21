# Round-2 backlog — design-system externalization

> **✓ IMPLEMENTED** in `implementations-plan/design-system-externalization-round-2/` (all 7 phases
> green). The 9 component holdouts + the `toast`/`outside` composables are externalized; the storybook
> rolldown build is fixed + primitive stories relocated; the orphaned faucet `public/fonts/` removed +
> the faucet `base.css` parity guard added. **Round 3**
> (`implementations-plan/design-system-externalization-round-3/`) closed the rest — and DECIDED the
> faucet toast stays **SEPARATE, not unified** (`AppToastRegion`/faucet `useToast` is a 4-deep queue
> with links; the extension's is a single-transient singleton — different state models, different host
> contexts; the faucet already shares the package `Toast.vue` card). Round 3 also retired the
> `AppButton` alias (migrated `DripButton` → `Button`), dropped the `dark` color name, and deleted the
> 9 round-1 local SFC shadows.

Round 1 (this plan) externalized L0 tokens + the base/theme/font takeover + L1 core (4) + the pure L2
subset (5) into `@nulo/design`, consumed by the extension via an `unplugin-vue-components` resolver.
Everything below was deliberately deferred — each item has a concrete reason recorded during round 1.

## Components held back

### Router/state holdouts (need a router/state seam, not a primitive extraction)
- **`Button`** — renders `:is="link ? RouterLink : 'button'"` (`Button.vue:78`); importing it would drag
  `vue-router` into `@nulo/design`. Externalize once the link behavior is decoupled (e.g. a `to` slot
  prop the consumer wires, or a router-free base + an extension wrapper).
- **`SubPageHeader`** — `useRouter()` + history policy (`:26`).
- **`ToastManager`** — `useToast()` app-state adapter (`:3`). The package already ships the
  presentational `Toast`; round 2 externalized the toast *state* composable + the extension's
  `ToastManager` region. **The faucet region unification was declined in round 3** (kept separate — the
  faucet's queue model is intentionally different; see the round-3 plan).

### Spinner + its dependents
- **`Spinner`** — the extension's (4s multi-rotate, `--txt-inverse`, `color` prop) diverges from the
  package's existing `Spinner` (0.75s spin, `currentColor`, no `color`). Reconcile into one canonical
  Spinner (extension API wins; faucet visually re-verified).
- **`Banner`, `LoadingState`** — both render `<Spinner color=…>`; move with the Spinner reconciliation.

### Host-DOM-coupled
- **`Tooltip`** (`teleport to #tooltip` `:185`, `--base-width` `:244`), **`Popover`** (`teleport to
  #popover` `:82`, + the impure `useOutside` composable), **`Input`** (renders `Tooltip` at `:239`).
  Externalize once the teleport-root contract is made host-agnostic (e.g. the package mounts its own
  roots, or accepts a target prop) and `useOutside` is co-migrated.

### Faucet component dedup
- The faucet still uses the package's `AppButton`/`Spinner`/`Toast`. After `Button`/`Spinner` are
  reconciled, migrate the faucet's `AppButton`→`Button` sites + dedup Spinner (the look-same + e2e
  re-verification the round-1 plan described).

## Tooling / cleanup
- **`build-storybook` is pre-broken** (independent of this work — fails identically on pre-round-1
  branches): Storybook v10 + Vite 8 rolldown `ViteAlias StringExpected` on the `{find:"@"}`
  alias-merge in `.storybook/main.ts`. Fix the alias config to a rolldown-compatible form.
- **Faucet `public/fonts/`** is now orphaned (base.css uses the package-bundled fonts) — remove.
- **Faucet base.css parity guard**: the round-1 faucet light-bg regression (five globals the
  extension's leaner base dropped vs the faucet's old package base; fixed faucet-locally in
  `packages/faucet/src/app.css` — see `lessons/phase-5.md`) was caught only by the human eye. The
  token drift tests passed because VALUES were identical; the gap was *missing rules*. Add a
  faucet-side guard (a render smoke asserting a dark computed `background-color` on `body`, or a
  parity test that the faucet's effective element globals match its pre-migration set).
- **Move primitive stories into the package** + expand the Storybook `stories` glob to
  `../../design/src/**/*.stories.*` (round 1 kept them in the extension, repointed to `@nulo/design`).
- **Round-2 visual gate**: when the base/theme/font takeover collapses further, consider real
  screenshot infra (storybook-test-runner + image snapshots, `_base.scss` NOT loaded) — round 1 used
  deterministic style-snapshot tests + the human visual gate instead.

## Pre-existing quirks preserved (bug-pinned, fix deliberately, not as a "move")
- `--gray-15` ghost (`.color--dark` → undeclared var → inherits). To fix: declare it or drop the
  `dark` color name — but that's a visible change, so it's a deliberate decision, not a silent move.
- `--nulo-error` is referenced by an `<Icon color="--nulo-error">` literal-prop bleed but is NOT
  globally dead (real CSS fallback use in `TransactionTerminalCard.vue:94`) — leave as-is.
- The pre-existing `settings-crud > manage-fpcs synthetic FPC anchor row` smoke flake (fails
  identically pre-round-1) — part of the smoke-fixture-cleanup follow-up.
