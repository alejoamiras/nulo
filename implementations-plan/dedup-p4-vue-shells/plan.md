---
plan: dedup-p4-vue-shells
tier: light
driver: claude-code
code_review: off
eli5_mode: readme-row
worktree: .claude/worktrees/dedup-p4-vue-shells (branch worktree-dedup-p4-vue-shells, on top of worktree-dedup-p3-service-wrappers / PR #568)
ledger: implementations-plan/dedup-ledger (phase P4)
status: codex plan audit conditional-approve 2026-09-07, all seven conditions adopted; approved under the ledger README's pre-approval rule; implementing
---

# P4 — share the page shells and style partials

Eighteen ledger findings (J1 J2 J3 J4 K1 K7 K4 K5 K6 K9 K10 K11 L1 L3 N6 N9 M2 M3) are copy-pasted `<style module>`
blocks and page scaffolds in the popup, the approval windows and onboarding. This phase gives each family one home:
a CSS-module partial where only styles repeat, a small presentational component where markup repeats too. Every
`data-testid` stays verbatim, no copy changes, no service or store touches. Scope is exactly those ids; K4 and M3 are
skipped on contact and J3/J4/L3 land as partials (reasons in the decision ledger). Net ≈ −550 lines.

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
| `popup/components/modules/send/fee-shared.module.css` | `detail_row` (4), `fee_label` (3), `skeleton` + `@keyframes shimmer` together (3; `GasBalanceCard`'s differs only in formatting) (L1) | the six fee/gas cards |
| `popup/windows/window-shell.module.css` | `approval_wrapper`, `scroll_area` (K9); the json/logger classes (K10) — a non-class rule in that block stays local | `execute capabilities discover verify`, `json`, `logger` |
| `popup/components/popups/popup-shared.module.css` | `header`, `pre_title` (N6); `select_row` = the shared declarations only (`border-radius cursor border transition`, `&:hover { background; border }`, `&:active { background }`) (N9) | `ConfirmPopup`, `IncomingTrustPopup`; `SelectFpcPopup .fpc`, `SelectNetworksPopup .network`, `SelectBalanceTypePopup .card`, `ImportContactsPopup .contact` compose it and keep `min-height`, `padding` and their `&:hover .icons` rules local (a nested `.icons` moved into the partial would hash to a different token) |
| `popup/pages/settings/settings-page.module.css` | `wrapper`, `content` (J2) | `SettingsPageShell` and the three pages that keep their own markup (below) |
| `popup/components/modules/general/list-empty.module.css` | `empty_state`, `empty_headline`, `empty_sub` (L3) | `TokensView`, `RecentActivityView` (`ListStatusMessage` is untouched: its `.empty_sub` adds `width:100%` and `overflow-wrap`, which these two lack) |

### Popup shells (Phase 2)

- **`SettingsPageShell.vue`** (J2): `Flex.wrapper > SubPageHeader(title, backTo, #trailing → #trailing, forwarded only
  when provided) > Flex.content(gap) > slot`, its two classes composed from `settings-page.module.css`. Props `title`,
  `backTo`, `gap` (undefined → no gap class, as today). Root attrs fall through (`accounts/index.vue`'s
  `data-testid="manage-accounts-page"`), `v-if="network"` stays on the element (`networks/[id].vue`). Sixteen pages
  adopt the shell; `about.vue` (`align="center"` on the content), `appearance.vue` (`v-if="!isLoading"` on the
  content) and `authwits/index.vue` (`wide` on the content) keep their own markup and compose the two classes from the
  partial instead of growing the shell's prop surface.
- **`AsyncListStatus.vue`** (J4): props `loading`, `error`, `label`; emits `retry`; renders `LoadingState` while
  loading, else the `Tooltip > Banner("Try again")` error block with the error in the tooltip content. The five pages
  become `<AsyncListStatus v-if="isLoading || error" … @retry="…" />` followed by their existing `v-else-if` chain;
  contracts/notes keep their fetch code and their refetch toast (`@retry="fetchContracts(true)"`).
- **L3 as a partial**: `TokensView`/`RecentActivityView` compose `empty_state`/`empty_headline`/`empty_sub` from
  `list-empty.module.css`; markup, `.empty_link` and the `tokens-empty-import-link` testid unchanged.
  `ListStatusMessage` is not adopted (box-model differences, decision ledger).
- **`BarrierOverlay.vue`** (M2): the fixed full-screen wrapper and card with `.title/.sub/.detail`; props `testid`,
  `title`, `sub`, `subTestid`, `detail`, `detailTestid`; `#icon` slot (default: the red warning glyph) and a default
  slot after the detail (Migration's retry button). The detail span renders whenever `detail` is passed, even empty
  (Migration's blocked state renders `blocked.detail` unconditionally); the updating state passes none. Both
  `Teleport`s stay in the parents; `MigrationBarrier` keeps its three-state switch, the degraded banner and
  `.retryBtn`; `AccountIntegrityBarrier` keeps its copy verbatim.
- **M3 skipped** (decision ledger): the chips are not one thing.

### Onboarding (Phase 3)

- **`OnboardingSkipLink.vue`** (K7): the `.skipLink` button (+hover/focus rules), `testid` prop, `click` emit.
- **`OnboardingExplainer.vue`** (K1): props `step`, `titleMain`, `titleSub`, `lede`, `cards`, `continueTestid`,
  `skipTestid`; emits `continue`, `skip`; owns `OnboardingPage :gap="40"`, the hero, the card grid with its container
  query, the actions row and the "Skip intro" link (both pages say exactly that). `learn.vue`/`fees.vue` keep route
  meta, cards, handlers and their comments.
- **`OnboardingProfileNameField.vue`** (K5): `modelValue` (v-model), `error`, `shake`; emits `update:modelValue`,
  `input`; owns the label, the `Input` with `type="text" placeholder="My Profile" :maxLength="32" :error :ariaInvalid
  sanitize data-testid="onboarding-name-input"` forwarded verbatim, the `.shake` keyframes and the conditional
  `role="alert"` error line; exposes `focus()` — `useProfileNameField` types the ref as `{ focus: () => void }` and
  only ever calls `.focus()`.
- **`OnboardingBackLink.vue`** (K6): `testid` only — both pages route to `/onboarding/welcome` and say "Back"; the
  chevron, the label and `.back` CSS live in the component.
- **`installConsoleForwarding(client)`** (K11) in `wallet/logger/console-forwarding.ts`, imported directly by
  `popup/index.ts` and `onboarding/index.ts` — NOT re-exported from the `wallet/logger` barrel, which
  `LoggerServiceClient` itself imports (a re-export would close a cycle). Installs the `on<method>` console hooks and
  the unhandled-rejection handler (disconnect rejections at debug) for a `LoggerServiceClient(client)` and returns it.
  The hooks are typed (`self as unknown as Record<string, (...args: unknown[]) => void>`), so the copied
  `noExplicitAny` suppression is retired rather than moved.
- **K4 skipped** (decision ledger).

## Phases

Each phase: implement → `bun run lint` → `bun run --cwd apps/extension typecheck` → the touched suites → commit.
Gates quote exit codes in `lessons/phase-1.md`.

### Phase 1 — partials (J1, J3, L1, K9, K10, N6, N9, L3, J2's classes)

Write the six partials, replace the consumer bodies with `composes:`. Gate: `send/*.test.ts`, `windows/execute`,
`general/*` and popups suites green; `build:chrome` exit 0; the emitted `dist/chrome` CSS inspected, not just counted:
each partial rule once, each consumer mapped to two tokens, the skeleton's `animation` name matching an emitted
`@keyframes`, the popups' local `:hover .icons` rules intact, the partial rule preceding its consumers (vitest processes
no CSS, so the build output is the only parity evidence); `git diff --stat -- apps/extension/src/types/` empty.

### Phase 2 — popup shells (J2, J4, M2)

`SettingsPageShell`, `AsyncListStatus`, `BarrierOverlay` and their parity matrices (ten cases each, the L3 minimum,
every case a parity claim): shell — root element and attrs fall through, header title/backTo, trailing actions forwarded
only when given, content gap present/absent, default slot, `v-if` on the element; async — loading wins over error, a
falsy error renders nothing, tooltip content is the error, retry emits once, label passthrough, loading→error→neither
transitions; barrier — exact node order and testids, escaped copy, detail present-but-empty vs absent, icon slot
replacement, default-slot placement after the detail. Tests mount the real extracted children (vitest registers no
components automatically). `MigrationBarrier`, `AccountIntegrityBarrier`, `TokensView`, `RecentActivityView` and the
five settings pages' existing suites stay green. Build + `components.d.ts` committed.

### Phase 3 — onboarding + entries (K1, K7, K5, K6, K11)

The four onboarding components and their parity tests (explainer: card copy and order, step, testids, continue/skip
emits, lede; name field: model updates, `input` emit, alert only with an error, shake class, `focus()` reaches the
input, the forwarded attrs; back link: testid, route push; skip link: testid, click emit), `learn`/`fees`/
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

**Inferences (all resolved in the audit round)**
- The four cards' chip CSS is NOT identical (Incoming is accent-coloured and non-shrinking, the settled card lacks the
  nowrap rules and renders two chips when both labels exist) → M3 skipped.
- `nameInputRef` is typed `{ focus: () => void }` and only ever `.focus()`ed (`useProfileNameField.ts:40,143,154`).
- `GasBalanceCard`'s skeleton differs only in formatting → composed.
- The K10 block has a global `body` rule → stays local; only `.wrapper`/`.json_viewer` move (as `viewer_wrapper`/`json_viewer`).

**Asks** — none open; the ledger README's owner decisions pre-answer tier, review setting, delivery and approval.

## Decision ledger

- **K4 skipped**: the seven heroes differ in padding (8/16/24), bar width (40/56), container (`Flex` vs `header`),
  alignment and a `.subhead`; a shared component needs four props and two slots to save ~30 lines. Learn/fees' heroes
  go with K1 anyway.
- **J3 folded into J1**: the pages' empty state is a borderless 12px-gap column; `ListStatusMessage.empty` is a
  dashed 32px-padded 8px-gap card. Pixel parity would need two props for −45 lines; the two classes de-duplicate
  through the partial instead.
- **J4 partial**: the template block is shared; contracts/notes stay on their own fetch code because
  `useEntityCrud` starts `isLoading=true` (the pages start `false`), the pages re-fetch on an `appStore.account` watch
  with a toast, and contracts never resets `error` (notes does, at `notes/index.vue:115`) — visible-state differences
  for ~30 lines.
- **K10 folded into K9's partial**, templates untouched.
- **M3 skipped**: the Incoming chip is accent-coloured and non-shrinking, the settled card's chip lacks the nowrap rules
  and renders two chips when both labels exist; one `chip` prop cannot preserve that.
- **L3 as a partial, not `ListStatusMessage`**: LSM's `.empty_sub` adds `width:100%` and `overflow-wrap:break-word`, so
  long symbols would wrap differently.
- **J2 exceptions keep their markup** (`about`, `appearance`, `authwits`) and compose the classes — three cases do
  not justify three shell props.

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

**Codex plan audit** (`/codex high`, GPT-6 Astra, session `01a07cb9-c178-7562-ab43-7d0f685a3e8f`): *conditional approve*. Every condition verified against the tree and adopted:

| Finding | Verified | Decision |
|---|---|---|
| J2: `SubPageHeader` forwards only named slots, so `#trailing → default` would drop the actions; four pages use `#trailing` (incl. authwits); `about` centres its content, `appearance` guards it with `v-if`, `authwits` passes `wide`; `accounts` carries a root testid | yes (`SubPageHeader.vue:57`, the four pages, `about.vue:39`, `appearance.vue:168`, `authwits/index.vue:158`, `accounts/index.vue:78`) | shell forwards `#trailing` only when given; root attrs fall through; the three exceptions keep their markup and compose the classes from a partial |
| M3: the Incoming chip is green and non-shrinking, the settled chip lacks nowrap and renders two chips when both labels exist | yes (`TransactionIncomingCard.vue:85`, `TransactionCard.vue:185-187,249`) | M3 skipped |
| L3: LSM's `.empty_sub` adds `width:100%` + `overflow-wrap` | yes (`ListStatusMessage.vue:50`) | partial instead; LSM untouched |
| N9: leave padding local; the nested `.icons` rules would re-hash if moved; keep `:active`; shimmer declarations and keyframes together; vitest processes no CSS so inspect the emitted stylesheet | yes (`SelectFpcPopup.vue:204`, `ImportContactsPopup.vue:289`, all four `:active`) | partial carries only the shared declarations; Phase 1 gate reads the emitted CSS |
| K5/M2/K1/K6 contracts: numeric `maxLength`, `ariaInvalid`, `sanitize`, conditional alert; blocked detail rendered even when empty, updating has none; `OnboardingPage :gap="40"`; no `skipLabel`; back link destination and label never vary | yes (`create.vue:123-141`, `MigrationBarrier.vue:127/141`, `learn.vue:38`, both back links push `/onboarding/welcome`) | contracts written into the component specs; `skipLabel` and `to` dropped |
| K11: a barrel re-export closes `logger/index → console-forwarding → LoggerServiceClient → logger/index`; the copied `any` suppression must not move | yes (`services/logger/client.ts:2`) | direct import from the entries; typed hooks |
| Tests: a parity matrix rather than a quota; mount the real children | yes (`vitest.config.ts` registers no components) | matrices written into Phases 2–3; the layout tests dropped with M3 |
| Notes DOES reset `error` on refetch | yes (`notes/index.vue:115`) | J4 reasoning corrected |

Rejected: none. Owner ask surfaced: none. Approval follows from the ledger README's pre-approval rule (final verdict conditional-approve, every condition adopted, scope ⊆ the phase's ids, no Tier-4 id, no user-visible change).

## Seeds

The session-level `/goal` in `implementations-plan/dedup-ledger/README.md` is already driving this phase and
supersedes a plan-local seed. For a fresh session picking up only this phase:

```
/goal All four phases marked ✓ in implementations-plan/dedup-p4-vue-shells/plan.md, each ✓ backed by its validation gate quoted passing; `LESSONS_FILE=implementations-plan/dedup-p4-vue-shells/lessons/phase-1.md` printed; `/code-review` NOT run; the codex fix loop converged with a resumed pass reporting no new material findings, quoted; the PR opened via `gh stack submit` on worktree-dedup-p4-vue-shells with base worktree-dedup-p3-service-wrappers only after the loop converged, `gh pr checks` all green, no merge command run.
```
