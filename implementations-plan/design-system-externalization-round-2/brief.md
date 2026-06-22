# Shared brief — design-system-externalization ROUND 2 (L2 holdouts + cleanup)

Factual foundation for all three parallel planners (main + codex + fable). Verify against the repo
before trusting; extend where thin. **Repo-relative paths only** (committed artifact).

Round 1 (shipped, PRs #102–#114) externalized: the single-source token contract, the
base/theme/font takeover, L1 core (`Flex`/`Icon`/`MaterialIcon`/`Text`), and the *pure* L2 subset
(`Badge`/`BrutalistTitle`/`Checkbox`/`SectionLabel`/`Toggle`). Both apps got a "no deltas" human
visual sign-off. Round 2 finishes the L2 holdouts that round 1 deliberately deferred because each is
blocked on a real seam (router, app-state, host-DOM, or a cross-app duplicate).

Authoritative round-2 scope source: `implementations-plan/design-system-externalization/round-2-backlog.md`.

## Goal

Externalize the remaining L2 ui primitives from `packages/extension/src/components/ui/` into
`@nulo/design`, behind the same `unplugin-vue-components` resolver round 1 established (zero template
churn at call sites), while keeping the package **presentational-only and dependency-pure** (no
`@nulo/*`, no `chrome.*`, no app utilities, no framework router). Reconcile the two cross-app
duplicates the faucet shares (Button, Spinner) into one canonical each. Then close the deferred
tooling/cleanup (storybook build fix, stories→package, orphaned-fonts removal, faucet parity guard).

## Locked decisions (from the user's clarifying answers — do NOT re-litigate)

1. **Scope = "Components + cleanup".** All 9 holdout components + their composables, PLUS the
   tooling/cleanup (storybook-rolldown build fix; move primitive stories into the package + widen the
   Storybook glob; remove the orphaned faucet `public/fonts/`; add the faucet `base.css` parity
   guard). The pre-existing visual-quirk *fixes* (`--gray-15` ghost, the `dark` color name) are OUT —
   they stay bug-pinned.
2. **Router seam = "Stay router-free".** `@nulo/design` must NOT take a `vue-router` dependency.
   `Button`/`SubPageHeader` ship as router-agnostic bases (polymorphic element / consumer-wired
   navigation); the extension keeps a thin wrapper that injects `RouterLink` / `useRouter`. This
   preserves the round-1 presentational-only floor.
3. **Visual gate = "Snapshots + human + parity guard".** Keep round-1's deterministic style-snapshot
   tests + human visual sign-off on BOTH apps, and ADD the faucet `base.css` parity guard. NO new
   image-screenshot infra this round.
4. **Faucet reconciliation = "Components, defer toast".** The faucet migrates its `AppButton` sites →
   the reconciled `Button` and dedups to the reconciled `Spinner`. The faucet's `AppToastRegion.vue`
   + its own `useToast` stay as-is — toast-region unification is deferred to round 3.

### Inherited round-1 locks (still binding)

- **Home:** ONE package, internal layer dirs (`tokens`/`core`/`ui`/`composite`). Not a split.
- **Styling:** migrated components carry self-contained scoped styles consuming shared CSS-var
  tokens. No dependency on the extension's global SCSS utility classes.
- **Duplicate reconciliation:** the **extension's** component API is canonical; the faucet adapts and
  is re-verified (visual + e2e).
- **Out of scope:** `@nulo/playground` (0 `.vue`), `@nulo/landing` (no Vue), the bridge-* packages
  (0 `.vue` — pure TS libs). The only Vue consumers are the extension and the faucet.

## Current verified state

| Package | Vue UI | `@nulo/design` import sites | Round-2 relevance |
|---|---|---|---|
| `@nulo/design` | core(4) + ui(10) + composite(5) + tokens + base.css | — | target |
| `@nulo/extension` | 182 `.vue` | 21 | source of all 9 holdouts |
| `@nulo/faucet` | 19 `.vue` | 9 | consumes Button(as AppButton)+Spinner+Toast+5 composites+base.css |
| playground / landing / bridge-* | 0 `.vue` | 0 | out of scope |

`@nulo/design` current exports (`packages/design/src/index.ts`): core `Flex/Icon/MaterialIcon/Text`;
ui `AppButton/Badge/BrutalistTitle/Card/Checkbox/SectionLabel/Spinner/Tag/Toast/Toggle`; composite
`AddressDisplay/BalanceRow/DisclaimerTag/DripButton/EmojiGrid`; `* from ./tokens`.

The resolver registry `packages/extension/scripts/design-resolver.ts` (`NULO_DESIGN_COMPONENTS`,
shared by `vite.config.ts` + `.storybook/main.ts`) currently lists the 9 round-1 names. Round 2 grows
it. The package's `src/mount-all.test.ts` render-smoke and `src/boundary.test.ts` floor-guard also
"grow as phases migrate."

## The 9 holdouts and their exact couplings (all under `packages/extension/src/components/ui/`)

### Router-coupled (→ router-free base + extension wrapper, per lock 2)
- **`Button.vue`** (376 lines). Polymorphic root `:is="link ? RouterLink : 'button'"`
  (`Button.vue:77`), `v-bind="{ to: link ? link : null }"`, `target` prop. Renders
  `<Spinner v-if="loading" color="currentColor">` + `<Icon>`. Variants: primary/primary_outline/
  secondary/ghost/text/cta/cta_outline/cta_destructive; sizes large/medium/small/mini/dynamic/micro/
  micro. Uses `<style module>` (CSS modules) — portable. **Faucet's only Button path is plain
  buttons (no router)** → the router-free base serves the faucet directly.
- **`SubPageHeader.vue`** (126 lines). `useRouter()` (`:26`), `router.back()`, `router.push(backTo)`,
  hardcoded fallback `router.push("/popup/general")` (`:33–37`). History policy. **Extension-only
  consumer** (faucet has no router).

### App-state-coupled
- **`ToastManager.vue`** (90 lines). `useToast()` from `@/composables/toast.js` →
  `{ toast, openToast, closeToast }` (single transient toast: `icon`/`color`/`label`). Teleports to
  `#toast`. Renders `Flex`+`Icon`+`<span>` (NOT the package's `Toast.vue`). **Extension-only.**
  ⚠ The package's existing `Toast.vue` is the *faucet's* toast (`kind`/`text`/`link`/`@dismiss`,
  driven by the faucet's own `@/composables/useToast` → `{ toasts, dismiss }`, array of toasts). The
  two toast families are unrelated. With the faucet toast deferred (lock 4), extracting ToastManager
  this round puts TWO toast families in the package — a smell planners must address (extract anyway
  for consistency? rename? or defer ToastManager too?).

### Spinner cluster (reconcile into one canonical, extension API wins)
- **`Spinner.vue`** (59 lines, extension). Props `size` (string, default "16") + `color` (string,
  default `--txt-inverse`; `--`-prefixed → `var(--…)`, else used as-is). 4s multi-rotate keyframes
  (`material-spinner`: 0→360→720→1080→1440deg). vs the package's existing `Spinner.vue`: props
  `size`(number)/`label`, `currentColor`, 0.75s single-rotate. **Reconcile to the extension's API;
  the faucet (current Spinner consumer) re-verified.**
- **`Banner.vue`** (155 lines). Renders `<Spinner v-else size="16" color="--txt-primary">` (`:32`) +
  `Icon`+`Text`. **Extension-only.** Moves with the Spinner reconciliation.
- **`LoadingState.vue`** (44 lines). Renders `<Spinner size="20" color="--txt-primary">` (`:10`).
  **Extension-only.** Moves with the Spinner reconciliation.

### Host-DOM-coupled (teleport-root contract + the `useOutside` composable)
- **`Tooltip.vue`** (267 lines). Teleports to `#tooltip`, reads a `--base-width` CSS var, position
  math via `getBoundingClientRect`. `maxWidth` prop. **Extension-only.**
- **`Popover.vue`** (123 lines). Teleports to `#popover` (`:82`), uses `useOutside` from
  `@/composables/outside` (`:5`), listens on `document` scroll/keydown. **Extension-only.**
- **`Input.vue`** (394 lines). Renders `<Tooltip position="end">` (`:239`) and imports
  `sanitizeString` from `@/utils/string` (`:6`). **Extension-only.** Both deps must travel: Tooltip
  migrates first/with it; `sanitizeString` (10-line pure regex util, no app deps) inlined or
  package-homed.

### Teleport roots (host contract)
`#tooltip`/`#popover`/`#toast` are declared in BOTH `packages/extension/src/popup/app.vue:249–252`
and `packages/extension/src/onboarding/app.vue:79–82`. The **faucet declares none** (uses
`AppToastRegion.vue`). Any teleport-based holdout that the faucet might later consume needs a
host-agnostic root contract; for THIS round the teleport holdouts are all extension-only, so the
contract can be "consumer provides the root" — but planners should still specify the contract
explicitly (the package documents the required root IDs, or the package mounts its own).

## Composables to migrate (both are untyped `.js` today → must be TS in the package)

- **`packages/extension/src/composables/toast.js`** — `TOAST_DURATION` consts + `useToast()`
  (`ref` + `setTimeout`, single transient toast). Pure (no chrome, no app deps).
- **`packages/extension/src/composables/outside.js`** — `useOutside`/`useEvent` (DOM listeners,
  `navigator.userAgent`, `document`). Pure. Used by `Popover` (and possibly elsewhere — verify
  remaining consumers before relocating vs duplicating).

The package has NO auto-import: every Vue API + composable import in migrated SFCs must be explicit.
The package's `mount-all.test.ts` exists precisely to catch a missing `import { computed }` that
`vue-tsc` + build silently pass on JS SFCs.

## Cross-app blast radius (precise)

- **Faucet-shared (must re-verify the faucet):** `Button` (via **25 `AppButton` usages across 6
  files**: `MintTestUsdc.vue`, `WalletPanel.vue`, `VerificationModal.vue`, `BridgeForm.vue`,
  `BridgeWalletPanel.vue`, `L1WalletPanel.vue`) and `Spinner`.
- **Extension-only (no faucet surface):** `SubPageHeader`, `ToastManager`, `Banner`, `LoadingState`,
  `Tooltip`, `Popover`, `Input`. The faucet uses NONE of these (verified by grep).

So the cross-app reconciliation work is narrow (Button + Spinner); the other 7 are intra-extension
relocations behind the resolver.

## Open decisions for planners to DIVERGE on (the contested forks)

1. **Router-free seam mechanism** for Button + SubPageHeader: polymorphic `as`/`is` prop the consumer
   passes (`RouterLink`)? a `to`-routed default slot? an event-emitting base (`@navigate`) with the
   extension wrapper calling `router`? How does the resolver keep call sites churn-free when the
   extension now needs a *wrapper* around the package base (the bare `<Button>` tag must still
   resolve — to the wrapper, not the package base)?
2. **ToastManager this round or defer?** Given the faucet toast is deferred and the package already
   hosts a different `Toast.vue`, is extracting the extension's ToastManager net-positive now, or
   does it create a confusing dual-toast package surface that should wait for round-3 unification?
3. **Teleport-root contract:** consumer-provides-root (documented IDs) vs package-mounts-own-root vs
   target-prop. Which, and how is it tested?
4. **`useOutside`/`toast` composable home:** move into the package (`src/composables/` or
   `src/internal/`) and TS-ify, with the extension re-importing from `@nulo/design`? Or duplicate?
   Check ALL extension consumers of each before relocating.
5. **Input's `sanitizeString`:** inline into Input vs add a package util. Behavior must be byte-identical.
6. **Spinner reconciliation order:** replace the package's existing Spinner in-place (faucet re-verify
   immediately) vs add the extension's as the canonical and migrate the faucet, then delete the old.
7. **Sequencing + PR strategy:** how to keep each phase independently shippable + green; how many
   stacked PRs (round 1 used 5); which phases bundle (e.g. Spinner+Banner+LoadingState as one).
8. **Storybook destination + rolldown fix:** move primitive stories into the package and widen the
   glob to `../../design/src/**/*.stories.*`, vs keep them in the extension. AND diagnose+fix the
   `build-storybook` rolldown break (reproduce the current error first — the backlog's `{find:"@"}`
   description may be stale; `.storybook/main.ts` currently uses object-form aliases).
9. **Faucet `base.css` parity guard mechanism:** a render smoke asserting computed `background-color`
   on `body` is dark, vs a parity test that the faucet's effective element globals match its
   pre-migration set. (Round-1 lesson: token-drift tests passed on identical VALUES but missed
   MISSING RULES — that's the gap this guard closes; see
   `implementations-plan/design-system-externalization/lessons/phase-5.md`.)

## Hard constraints (from CLAUDE.md / ARCHITECTURE.md — non-negotiable)

- **testid preservation:** every `data-testid` survives a move verbatim. e2e selects ONLY by testid.
- **Colocated tests:** `<Name>.test.ts` next to `<Name>.vue`. Coverage mins: L1/L2 ≥5 cases;
  composables ≥10 (lifecycle, error paths, dispose).
- **No `chrome.*` and no `@nulo/*` in the package** — enforced by biome `noRestrictedImports`/
  `noRestrictedGlobals` (`biome.json`) + `src/boundary.test.ts`. Round 2 must ADD a `ui`-layer biome
  rule (ui imports core OK; ui cannot import composite) mirroring the existing core-layer block.
- **SFC ordering convention** + **code-comment style** (why/invariant only, no milestone tags) apply
  to every moved file.
- **Pre-existing-quirk pinning:** preserve buggy behavior verbatim on a move; pin surprising bugs
  with a `(BUG PIN)` test. Quirk *fixes* are out of scope this round.
- **Bun** PM, **Biome** lint+format, **Conventional Commits** (lower-case subject), squash-merge to
  `dev`, signed commits, branch-up-to-date NOT required on dev.

## Real validation commands (use these VERBATIM in gates)

- `bun run typecheck:all` — vue-tsc across all `@nulo/*`.
- `bun run --cwd packages/design test` — the package's vitest (drift, boundary, mount-all, component).
- `bun run test` — extension unit + component tests.
- `bun run test:faucet` — faucet tests.
- `bun run lint` — biome, includes `noRestrictedImports` layer enforcement.
- `bun run build` — extension build · `bun run build:faucet` — faucet build.
- `bun run audit:vue` — one-shot: `typecheck:all → test → lint → build` (excludes e2e).
- `bun run test:e2e` — smoke (no Aztec sandbox).
- `bun run e2e:agent` — network suite, parallel-safe per worktree (~25 min).
- `bun run --cwd packages/extension build-storybook` — the storybook build (currently broken; a gate
  for the storybook-fix phase).

## The round-1 lesson that drives the visual gate

The faucet light-bg regression (round 1) slipped past every machine check: the token-drift tests
passed because token VALUES were byte-identical, but the extension's leaner `base.css` had DROPPED
five element-global rules the faucet relied on. Only the human visual gate caught it (fixed
faucet-locally in `packages/faucet/src/app.css`). The round-2 parity guard exists to catch
*missing-rule* regressions automatically. Style-snapshot tests + the human "no deltas" sign-off on
BOTH apps remain mandatory before final merge.
