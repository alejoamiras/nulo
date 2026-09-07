---
plan: dedup-p4-vue-shells
tier: light
driver: claude-code
code_review: off
eli5_mode: readme-row
worktree: .claude/worktrees/dedup-p4-vue-shells (branch worktree-dedup-p4-vue-shells, on top of worktree-dedup-p3-service-wrappers / PR #568)
ledger: implementations-plan/dedup-ledger (phase P4)
status: drafted 2026-09-07; awaiting the codex plan audit
---

# P4 — share the page shells and style partials

Eighteen ledger findings (J1 J2 J3 J4 K1 K7 K4 K5 K6 K9 K10 K11 L1 L3 N6 N9 M2 M3) are copy-pasted `<style module>`
blocks and page scaffolds in the popup, the approval windows and onboarding. This phase gives each family one home:
a CSS-module partial where only styles repeat, a small presentational component where markup repeats too. Every
`data-testid` stays verbatim, no copy changes, no service or store touches. Scope is exactly those ids; K4 is skipped
on contact and J3/J4 land partially (reasons in the decision ledger). Net ≈ −650 lines.

## Architecture & Implementation

**Mechanism for repeated styles — CSS Modules `composes:`.** A partial `<area>-shared.module.css` sits next to its
consumers; each consumer keeps its class name and replaces the body with `composes: <class> from "./<partial>"`, so
templates and testids do not change. Verified on this tree (`recon.md` § Mechanics): vitest and `build:chrome` pass,
the consumer's `$style.x` maps to its own token plus the partial's, and the partial's rule is emitted once. The
partial precedes the consumer in the cascade, so a consumer's own declarations (N9's padding deltas) still win.
First use in the repo; the partials are the pattern's documentation.

**Mechanism for repeated markup — a presentational component** with props for the values that differ and slots for
the regions that differ, testids passed through as props. New components live where the layer rules put them:
`src/components/composite/` for the popup shells (L3: no services, no stores), `src/onboarding/components/` for the
onboarding pieces (onboarding cannot import `@/popup/**`). Both directories auto-register, so `components.d.ts`
regenerates and is committed.

### Partials (Phase 1)

| Partial | Classes | Consumers |
|---|---|---|
| `popup/pages/detail-page.module.css` | `amount_fiat amount_symbol amount_value detail_key details_box detail_value_mono empty_headline empty_sub hero_meta tx_time` (J1 + J3) | `tx/[id].vue`, `received/[id].vue`, `journal/[id].vue` — `.wrapper`/`.content` stay local (journal differs) |
| `popup/components/modules/send/fee-shared.module.css` | `detail_row` (4), `fee_label` (3), `skeleton` + `@keyframes shimmer` (2; `GasBalanceCard` only if identical modulo formatting) (L1) | the six fee/gas cards |
| `popup/windows/window-shell.module.css` | `approval_wrapper`, `scroll_area` (K9); the json/logger classes (K10) — a non-class rule in that block stays local | `execute capabilities discover verify`, `json`, `logger` |
| `popup/components/popups/popup-shared.module.css` | `header`, `pre_title` (N6); `select_row` base (N9) | `ConfirmPopup`, `IncomingTrustPopup`; `SelectFpcPopup .fpc`, `SelectNetworksPopup .network`, `SelectBalanceTypePopup .card`, `ImportContactsPopup .contact` keep only their deltas |

### Popup shells (Phase 2)

- **`SettingsPageShell.vue`** (J2): `Flex.wrapper > SubPageHeader(title, backTo, #trailing → default slot) >
  Flex.content(gap) > slot`. Props `title`, `backTo`, `gap` (undefined → no gap class, as today). The 19 settings pages
  keep their route blocks, scripts and remaining CSS; only the shell markup and the two classes go.
- **`AsyncListStatus.vue`** (J4): props `loading`, `error`, `label`; emits `retry`; renders `LoadingState` while
  loading, else the `Tooltip > Banner("Try again")` error block with the error in the tooltip content. The five pages
  become `<AsyncListStatus v-if="isLoading || error" … @retry="…" />` followed by their existing `v-else-if` chain;
  contracts/notes keep their fetch code and their refetch toast (`@retry="fetchContracts(true)"`).
- **`ListStatusMessage`** (L3): a `#sub` slot rendered inside `.empty_sub` (the `sub` prop stays). `TokensView` and
  `RecentActivityView` replace their `.empty_state` block with `<ListStatusMessage headline=…>`; TokensView passes its
  "Tap … to import" line through the slot, its `.empty_link` CSS and testid unchanged.
- **`BarrierOverlay.vue`** (M2): the fixed full-screen wrapper and card with `.title/.sub/.detail`; props `testid`,
  `title`, `sub`, `subTestid`, `detail`, `detailTestid`; `#icon` slot (default: the red warning glyph) and a default
  slot after the detail (Migration's retry button). `MigrationBarrier` keeps its `Teleport`, its three-state switch,
  the degraded banner and `.retryBtn`; `AccountIntegrityBarrier` keeps its `Teleport` and copy.
- **`TransactionCardLayout`** (M3): `chip` + `chipTestid` props rendering `·` + chip in the title-trailing position;
  the four cards drop their `#title-trailing` templates and `.title_sep`/chip CSS. Gate: the four chip CSS blocks are
  diffed first; if they differ, M3 is skipped and logged (a five-line `.title_sep` alone is not worth a partial).

### Onboarding (Phase 3)

- **`OnboardingSkipLink.vue`** (K7): the `.skipLink` button (+hover/focus rules), `testid` prop, `click` emit.
- **`OnboardingExplainer.vue`** (K1): props `step`, `titleMain`, `titleSub`, `lede`, `cards`, `continueTestid`,
  `skipTestid`, `skipLabel`; emits `continue`, `skip`; owns the hero, the card grid with its container query, the
  actions row and the skip link. `learn.vue`/`fees.vue` keep route meta, cards, handlers and their comments.
- **`OnboardingProfileNameField.vue`** (K5): `modelValue` (v-model), `error`, `shake`; emits `update:modelValue`,
  `input`; owns the label, the `Input` (`data-testid="onboarding-name-input"`), the `.shake` keyframes and the
  `role="alert"` error line; exposes `focus()` so `nameInputRef` keeps working (the flow composable's use of the ref is
  checked before the page binds it to the component).
- **`OnboardingBackLink.vue`** (K6): `to`, `testid`; the chevron + slot label; `.back` CSS.
- **`installConsoleForwarding(client)`** (K11) in `wallet/logger/console-forwarding.ts`, exported from the barrel:
  installs the `on<method>` console hooks and the unhandled-rejection handler (disconnect rejections at debug) for a
  `LoggerServiceClient(client)` and returns it. `popup/index.ts` and `onboarding/index.ts` call it.
- **K4 skipped** (decision ledger).

## Phases

Each phase: implement → `bun run lint` → `bun run --cwd apps/extension typecheck` → the touched suites → commit.
Gates quote exit codes in `lessons/phase-1.md`.

### Phase 1 — partials (J1, J3, L1, K9, K10, N6, N9)

Write the four partials, replace the consumer bodies with `composes:`. Gate: `send/*.test.ts`, `windows/execute`,
`activity` and popups suites green; `build:chrome` exit 0; `dist/chrome` grep shows each partial rule once and each
consumer mapped to two tokens; `git diff --stat -- apps/extension/src/types/` empty.

### Phase 2 — popup shells (J2, J4, L3, M2, M3)

`SettingsPageShell`, `AsyncListStatus`, the LSM slot, `BarrierOverlay`, the layout chip. Tests: ≥10 cases for each
new L3 composite (props, slots, testid passthrough, emits), +2 for LSM, +2 for the layout; `MigrationBarrier`,
`AccountIntegrityBarrier`, `TokensView`, `RecentActivityView`, `TransactionCardLayout`, the four card suites and
`execute/index.test.ts` stay green. Build + `components.d.ts` committed.

### Phase 3 — onboarding + entries (K1, K7, K5, K6, K11)

The four onboarding components and their tests (≥5 cases each: props, testids, emits, `focus()`), `learn`/`fees`/
`accelerator`/`create`/`import` adopt them; `installConsoleForwarding` + a test (the hooks forward with the client tag;
a disconnect rejection logs at debug). `OnboardingPage`/`StepIndicator` suites stay green. Build + `components.d.ts`.

### Phase 4 — full local gate

`bun run lint && bun run typecheck:all && bun run test`, `build:chrome` + `git diff --exit-code --stat --
apps/extension/src/types/`, the `nulo:e2e:` marker grep on `dist/chrome`.

## Security & Adversarial Considerations

- **Threat surface unchanged.** No trust boundary moves: the phase touches presentation, an entry-file helper and
  no message, storage or service path.
- **K11** keeps the logging policy exactly: the same `consoleMethods` table, the same `getErrorData(e.reason)`
  payload, the same debug level for disconnect rejections; the helper takes only the client tag.
- **Barriers** (M2) are security screens: `AccountIntegrityBarrier` must still render no seed input, no external link
  and no delete CTA — the overlay carries only props and slots the parents fill, and the existing suites pin the
  testids and copy.
- **Onboarding fields** (K5) keep `sanitize` and `maxLength="32"` on the `Input`; the component forwards them
  verbatim rather than re-deriving.
- **Supply chain**: no dependency added or bumped.

## Assumptions

**Facts (verified in the worktree)**
1. `composes:` from a `.module.css` partial works under vitest and `build:chrome` (spike on `FeeCostReadout.vue`,
   `recon.md`).
2. `useEntityCrud`'s hooks are optional (`composables/useEntityCrud.ts:6-14`); `isLoading` starts `true`.
3. `SubPageHeader.vue` props: `title backTo showBack leadingIcon leadingIconColor`; three settings pages pass children.
4. `Flex` adds `gap--<n>` only when `gap` is truthy (`packages/design/src/core/Flex.vue:66`).
5. `.wrapper`/`.content` identical across the 19 settings pages (senders ≡ security); gap values
   none/12/16/20/24/32/40.
6. `learn.vue`/`fees.vue` differ in route title, `cards`, lede, `StepIndicator :current`, the two handlers and the
   two testid pairs; `.skipLink` ≡ across `learn fees accelerator`; `.back`/`.shake`/`.section_label` ≡ across
   `create`/`import`.
7. `TransactionCardLayout` renders `#title-trailing` inline after the title (`:124`); the four cards fill it with
   `.title_sep` (identical) + a chip span.
8. `MigrationBarrier`/`AccountIntegrityBarrier` share the first 40 style lines verbatim; Migration adds `.banner*`,
   `.retryBtn`.
9. `popup/index.ts:1-22` ≡ `onboarding/index.ts:8-28` modulo the client tag and comment wording.

**Inferences (unverified — the audit should attack these)**
- The four cards' chip CSS is identical (only `.title_sep` was diffed); the in-phase diff decides M3.
- `nameInputRef` is only ever `.focus()`ed by the flow composables, so `defineExpose({ focus })` preserves it.
- `GasBalanceCard`'s skeleton differs only in formatting.
- The K10 style block contains only class rules.

**Asks** — none open; the ledger README's owner decisions pre-answer tier, review setting, delivery and approval.

## Decision ledger

- **K4 skipped**: the seven heroes differ in padding (8/16/24), bar width (40/56), container (`Flex` vs `header`),
  alignment and a `.subhead`; a shared component needs four props and two slots to save ~30 lines. Learn/fees' heroes
  go with K1 anyway.
- **J3 folded into J1**: the pages' empty state is a borderless 12px-gap column; `ListStatusMessage.empty` is a
  dashed 32px-padded 8px-gap card. Pixel parity would need two props for −45 lines; the two classes de-duplicate
  through the partial instead.
- **J4 partial**: the template block is shared; contracts/notes stay on their own fetch code because
  `useEntityCrud` starts `isLoading=true` (the pages start `false`), resets `error` on refresh (the pages never do)
  and would drop the refetch toast — three visible-state differences for ~30 lines.
- **K10 folded into K9's partial**, templates untouched.
- **M3 conditional** on the chip CSS diff.

## Post-implementation

1. `code_review` is `off`: `/code-review` is NOT run.
2. **Codex audit** (`/codex high`, GPT-6 Astra): send the net diff `git diff worktree-dedup-p3-service-wrappers...HEAD -- . ':!implementations-plan' ':!apps/extension/src/types'`,
   this plan, `recon.md`, the ledger rows, an adversarial ask, and — verbatim — the two rules:
   *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
   configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If
   code works and is clear, leave it alone."* and *"Audit the comments for value per character. Flag any
   comment that narrates what the code visibly does, restates its line, references implementation plans /
   phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious
   invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future
   reader, human or LLM, pays to re-read: they must be few, dense, and exact."* Tell codex not to run the
   vitest e2e configs.
3. **Fix loop**: verify each claim against the tree, apply accepted fixes, commit, log the round in
   `lessons/phase-1.md`, RESUME the same codex session with the fix diff. Repeat until a round reports no
   new material findings (quote it). Still material after 3 rounds → surface and hold.
4. **Delivery** (below) — the first and only time a PR is opened for this phase.

## Delivery

Single arc = this branch, one PR, stacked on P3: `gh stack submit --auto --open` from this worktree (the stack
metadata is mirrored into this worktree's gitdir), then `gh pr edit <n>` with the ledger title
`refactor(popup): share the page shells and style partials across pages and windows` and a body listing ids
addressed, ids skipped with reasons, net LOC, the Phase 4 gate output and the codex rounds. Then `gh pr checks <n>`
watched; red = flake → re-run once, red again → fix or hold. Green → README row P4 = `open #<n> · green`,
`agent-worktree status`, print `LESSONS_FILE=implementations-plan/dedup-p4-vue-shells/lessons/phase-1.md`.
**Never merge**; the owner lands the stack bottom-up.

## Audit log

(pending — codex plan audit)

## Seeds

The session-level `/goal` in `implementations-plan/dedup-ledger/README.md` is already driving this phase and
supersedes a plan-local seed. For a fresh session picking up only this phase:

```
/goal All four phases marked ✓ in implementations-plan/dedup-p4-vue-shells/plan.md, each ✓ backed by its validation gate quoted passing; `LESSONS_FILE=implementations-plan/dedup-p4-vue-shells/lessons/phase-1.md` printed; `/code-review` NOT run; the codex fix loop converged with a resumed pass reporting no new material findings, quoted; the PR opened via `gh stack submit` on worktree-dedup-p4-vue-shells with base worktree-dedup-p3-service-wrappers only after the loop converged, `gh pr checks` all green, no merge command run.
```
