---
plan: harden-dedupe / visual-shells-a (arc 3 of 25)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/03-visual-shells-a, stacked on hd/02-design-tokens
---

# visual-shells-a: settings rows, record cards, toolbar button

Findings Q-22 (a, b, c) and, in the files this arc touches, Q-23 (b), from `audit/quality/2026-09-30-dedup-high/`. CSS only: three shared CSS modules that consumers `composes:`, and the hairline literals in those rules swapped for `var(--hairline-strong)`. Q-22 (d, f, i) and the rest of the literal sweep belong to visual-shells-b.

Paths below are under `apps/extension/src/` unless they start with `packages/` or `implementations-plan/`.

## Outcome & Quality Bar

- **For whom:** whoever restyles a settings row, a record card or a toolbar button. Today that means finding and editing 2 to 5 copies.
- **Excellent:**
  - Each shell's common rules are declared once.
  - Every consumer keeps exactly today's computed styles, `::after` included, at rest, hovered and focused.
  - Pixels are unchanged in Chrome and Firefox, dark and light, proven by the zero-diff harness.
- **Good enough:** each drift between copies stays local and is listed below; no copy is aligned to another.

## Architecture & Implementation

**Why CSS modules, not components.** `composes:` from a `*.module.css` is the repo's idiom for a shared visual shell (`list-empty`, `fee-shared`, `settings-page`, `detail-page`). It leaves every template, `data-testid` and DOM node as it is. Q-22's suggested L2 `ToolbarIconButton` would add a component, its five required component tests and a `components.d.ts` regeneration, all for 14 lines of CSS inside `Dropdown` and `Tooltip` slots.

**How a composed module lands in the build** (`dist/chrome`, built at 6ec153b7). The whole shared file is copied into every CSS chunk that has a consumer, ahead of that consumer's rules: `fee-shared.module.css`'s four rules appear in both `send-*.css` and `FeeSettingsCard-*.css`. Route chunks load lazily, so a copy loaded later can land after another consumer's local rules. Today's in-file source order therefore says nothing about how a moved rule will resolve.

**The neutralising rule: disjoint declarations.** On every element, the longhands that its shared classes declare in a given state (rest, `:hover`, `:has(...)`, `:active`, `::after`) never overlap with what its local classes declare, so order cannot matter. There are only two exceptions, and each wins by strictly higher specificity, exactly as it does today:

1. **E1:** a local `:last-child::after` or `:last-of-type::after { display: none }` (0,2,1) over the shared `.divider::after { display: block }` (0,1,1).
2. **E2:** the shared `.card:hover` (0,2,0) and `.card:has(...)` (0,3,0) `border-color` over the local `.card { border… }` (0,1,0). Notes' inline `border-left-color` and `.card_error`'s `!important` still sit above both.

The shared files contain only plain rules and no `composes`, like the existing shared modules. A consumer that needs two classes composes both: `composes: divider row from "…"`.

### (a) `components/ui/Settings/settings-row.module.css`

It sits at L2, its lowest consumer's layer.

**Shared classes:**

- **`divider`:** `position: relative`, plus `::after { position: absolute; bottom: 0; display: block; height: 1px; background: var(--hairline-strong); content: " " }`. It carries no insets and no last-row rule.
- **`row`:** the full twin shell: padding `12px 16px`, `cursor`, `background`, `transition`, the `:hover`/`:has(> [data-row-target]:focus-visible)` background, the `:has` outline, the `:active` background, `::after { left: 16px; right: 16px }` and `:last-child::after { display: none }`.
- **`row_text`, `row_name`, `row_sub`, `row_actions`:** the text, name, mono sub-line and actions blocks.

| site | composes | keeps locally |
|---|---|---|
| `popup/components/modules/settings/contacts/ContactRow.vue:62-100, 122-148, 174-176` | `divider row`; `row_text`, `row_name`; `row_sub` (`.row_address`); `row_actions` (`.actions`) | avatar, `sender_chip` (its 0.25 and 0.45 literals are not token values) |
| `popup/pages/settings/connected-apps/index.vue:176-214, 232-262` | the same; `row_sub` on `.row_grants` | logo, `action_danger`, empty state |
| `popup/windows/capabilities/AccountSelectRow.vue:114-148, 172-174, 188-197` | `divider` on `.row`; `row_text`; `row_sub` (`.row_address`) | everything else on `.row`: flex column, gap, padding `12px 14px`, `cursor`, `background`, `transition`, `:hover`/`:has`, `::after` 14px insets, `:last-child::after` (E1); `row_name` (it has no letter-spacing); `row_disabled`, `row_locked` |
| `components/ui/Settings/SettingItem.vue:156-204` | `divider` on `.wrapper` | everything else, including `::after` 20px insets, `:last-child::after` (E1), the size, `raw` and `disabled` modifiers, and all of `.interactive` |
| `components/ui/Settings/SettingField.vue:34-73` | `divider` on `.wrapper` | everything else, including `::after` 16px insets and `:last-of-type::after` (E1) |

**Equal-specificity pairs that resolve by source order today.** This is why those properties stay local:

- AccountSelectRow: `.row_disabled` and `.row_locked` set `cursor: default`, and `.row_locked:hover` sets the background, all against `.row`.
- SettingItem: `.wrapper.raw` against `.interactive:hover`, both (0,2,0).

Each pair stays inside one file, in today's order.

### (b) `popup/components/modules/settings/record-card.module.css`

Its consumers are an L4 component and an L6 page.

**Shared classes:**

- **`card`:** `position`, `display`, `flex-direction`, `gap`, `cursor`, `transition: all`, the `:hover`/`:has` background and `border-color`, the `:has` outline and the `:active` background. It carries no `border` and no `padding`, because notes' `border-left` overlaps the `border` shorthand.
- **`header`, `type`, `kv_grid`, `kv_key`, `kv_val`, `kv_val_wrap`.** These go in that order: `kv_val_wrap` overrides `kv_val`'s `white-space` by source order. Every chunk carries the whole file, so that order holds in every copy. Of the two near-identical comments on the wrap rule, one moves to the module.

| site | composes | keeps locally |
|---|---|---|
| `popup/components/modules/settings/authwits/AuthwitCard.vue:65-168` | all seven | on `.card`: `border`, `padding: 12px`, and `&:hover .revoke, &:focus-within .revoke` (it names the local `.revoke`); `.revoke` itself |
| `popup/pages/settings/advanced/account-state/notes/index.vue:261-392` | all seven | on `.card`: `border`, `border-left`, `padding: 12px 12px 12px 10px` and its comment; `card_error`, `contract`, `contract_name`, `location`, `raw`, `raw_line`, `render_error*` |

### (c) `popup/pages/toolbar-button.module.css`

It sits next to `detail-page.module.css` and `tab-hero.module.css`. Its one class, `icon_btn`, holds today's whole rule.

The five sites are `popup/pages/settings/contacts/index.vue:205-222`, `popup/pages/settings/connected-apps/index.vue:298-315`, `popup/pages/settings/connected-apps/[id].vue:368-385`, `popup/pages/settings/advanced/account-state/authwits/index.vue:207-224` and `popup/pages/tokens/[id].vue:299-321`. Each local `.icon_btn` becomes `composes: icon_btn from "<relative path>"`. `tokens/[id].vue` also keeps `&:disabled` locally; its `opacity` and `pointer-events` are disjoint from the shared rule. `:focus-visible` stays absent on all five (owner call 5).

Out of scope: the other classes named `icon_btn` (`RecipientCard`, `ImportContactsPopup`, `EditFpcPopup`, `settings/networks/index.vue`). They style icons or a different 28px button, not this shell.

### Q-23 (b) in these files

The arc touches five hairline literals, all `rgba(74, 70, 63, 0.3)`: ContactRow `:92`, connected-apps `:206`, AccountSelectRow `:140`, SettingItem `:180` and SettingField `:65`. All five become the single `var(--hairline-strong)` in `divider`. None of the touched files has a 0.2 literal.

The minified build already emits both the token and the literal as `#4a463f4d`, so the color bytes match too.

### Drift left for the alignment arc

None of these is unified here. Each stays local, as it is today.

1. **The last-row rule:** `:last-child` in ContactRow, connected-apps, AccountSelectRow and SettingItem; `:last-of-type` in SettingField. The program already keeps it as today.
2. **Divider insets and row padding.** Insets are 16px (twins, SettingField), 14px (AccountSelectRow) and 20px (SettingItem). Padding is `12px 16px`, `12px 14px`, `14px 16px`, and 12, 16 or 20 by 20 by size in SettingItem.
3. **The keyboard ring:**
   - the twins draw the `:has` outline;
   - SettingItem draws it in interactive mode only, plus its own `:focus-visible`;
   - AccountSelectRow changes the background but draws no outline;
   - SettingField has neither, and has no focusable target, yet it sets `cursor: pointer`, `:hover` and `:active`.
4. **`:active` background:** absent in AccountSelectRow only.
5. **Name letter-spacing (`0.01em`):** absent in AccountSelectRow's `row_name`.
6. **Hover and cursor scope:** SettingItem's cursor, transition and hover apply only to interactive rows; every other row is always interactive-styled.
7. **Record cards:** padding is 12px against `12px 12px 12px 10px`; only notes has the 4px accent left border; only AuthwitCard reveals an action on hover or focus-within.
8. **Toolbar button:** a `:disabled` state exists only in `tokens/[id].vue`; no copy has `:focus-visible` (recon said two lacked it; all five do).
9. **The light-theme hairline:** the dark-hued value, kept by the program panel.

## Security & Adversarial Considerations

None material: CSS rules move between files, and nothing touches data, input, crypto or dependencies. The adversarial risk is a cascade slip that hides an affordance, for example a row's focus ring or the Disconnect action's red hover. That slip comes from source order, which the disjointness rule removes. The pseudo-state captures under § Phases catch it. No approval window (execute, connect, sign) is touched.

## Assumptions

**Facts** (read 2026-10-02 at 6ec153b7):

1. ContactRow `:62-100` and connected-apps/index `:176-214` are byte-identical. Their `:122-148` and `:232-258` blocks differ only in the class names `row_address` and `row_grants`.
2. AccountSelectRow `:150-166` overrides `cursor` and `:hover` background at the same specificity as `.row`, by source order.
3. In SettingItem, `.wrapper.raw` (`:201-203`) and `.interactive:hover` (`:210-214`) are both (0,2,0).
4. AuthwitCard `:100-121, 129-168` and notes `:300-321, 354-392` match apart from comments. In both, `.kv_val_wrap` overrides `.kv_val` by source order.
5. The five toolbar rules are identical; `tokens/[id].vue:317` adds `:disabled`.
6. A composed module is copied whole into each consumer chunk (`dist/chrome`, as above).
7. `--hairline-strong` is declared once, in `packages/design/src/base.css:108`'s `:root, [theme="dark"]` block, and no file redefines it. `DetailsTable.vue:137` shadows only `--hairline-soft`.
8. No touched component receives a class from its parent that declares a shared property. FpcRow's `fpc_item` sets only `min-height`, `height` and `padding`.
9. No test reads these components' CSS-module maps. `AccountSelectRow.test.ts:148` matches `row_disabled` as a substring, which still passes.

**Inferences:**

- `theme-vars.test.ts` scans `src/**/*.css`, so it will check the new modules' `var(--hairline-strong)`, which is declared.
- A `composes` in a rule that also has nested rules (SettingItem, AccountSelectRow) compiles. No existing site does this, so the build plus the harness confirm it.

**Asks** (for the driver):

- The capabilities window needs a dApp request, and the notes page needs PXE notes. See § Phases for each fallback. Accept the fallback evidence, or move AccountSelectRow to visual-shells-b.

## Phases

### Phase 1: settings rows

Add `settings-row.module.css` and convert the five sites. The hairline swap lands here. Commit.

- **Gate:** `bun run lint`, `bun run typecheck:all`, `bun run test` (`ContactRow`, `AccountSelectRow`, `Settings` and the capabilities window tests), all exit 0.

### Phase 2: record cards

Add `record-card.module.css` and convert AuthwitCard and notes. Commit. **Gate:** the same commands as phase 1.

### Phase 3: toolbar button

Add `toolbar-button.module.css` and convert the five pages. Commit. **Gate:** the same commands.

### Phase 4: evidence

**Commands:** `bun run audit:vue`, `bun run test:all`, `bun run test:ci-gating`, `bun run --cwd apps/extension build-storybook` (`Settings.stories.ts` renders SettingItem and SettingField), and `bun run build`. Each must exit 0.

**Disjointness proof** (one-off, in a scratch directory). For each element that carries a shared class, flatten nesting and expand shorthands to longhands, then list the (state, longhand) pairs from its shared classes and from its local classes. The sets must be disjoint apart from E1 and E2. Log the table in this arc's lessons file.

**Screenshots:** `bun ~/.cache/hd-shots/run.ts --batch visual-shells-a --base 6ec153b7 --head <head>` must report every surface identical. That covers Chrome and Firefox, dark and light, at 360×600@2x. Alongside the pixels, each surface dumps `getComputedStyle` for its touched elements and their `::after`, at rest, hovered, and focused by Tab (the shot itself blurs, and `cursor` is invisible to pixels). Base and head must match.

| surface | route and state | exercises |
|---|---|---|
| settings-index | `#/popup/settings`; hover one nav row | SettingItem link rows, `:last-child` per group |
| settings-fpcs | `#/popup/settings/fpcs` (default FPCs, no seed) | SettingItem `raw` via FpcRow |
| accounts-popup | Home's account switcher open | SettingItem click rows in a popup |
| profile | `#/popup/settings/profile` | SettingField, `:last-of-type` |
| contacts | `#/popup/settings/contacts` with 2 or more contacts (added through `contacts-new-btn`, as `contacts.test.ts` does, or seeded); hover row 1; hover the toolbar button | ContactRow, `:last-child`, toolbar |
| connected-apps | `#/popup/settings/connected-apps` with 2 or more seeded dApp-session rows, one with capability grants; hover row 1 | twin row, `row_sub`, toolbar |
| connected-app-detail | `#/popup/settings/connected-apps/<seeded id>` | toolbar |
| authwits | `#/popup/settings/advanced/account-state/authwits` with the registry flag and 2 or more seeded authwits (a `call` with wrapped values and a `message_hash`, under the `nulo:core:auth-registry*` keys that `fixtures/journal.ts:181-182` reads); hover card 1 | AuthwitCard, revoke reveal, toolbar |
| notes | `#/popup/settings/advanced/account-state/notes` with 2 or more notes, one long-hex value | notes card, `kv_val_wrap` |
| token-detail | `#/popup/tokens/<id>` from a Home token row, idle; hover the menu button | two toolbar buttons |
| capabilities | the permission window with 2 or more accounts, one locked | AccountSelectRow |
| revisit | settings-index and contacts again, last, after every other chunk has loaded | late duplicate copies of the shared rules |

**Data the harness may lack** (it has no Aztec sandbox):

- Connected apps and authwits need seeded storage rows. Without them, only the empty state and the toolbar render, and the arc is not done.
- **Notes come from the PXE.** Use the canonical seed's notes on the live network the harness reaches, if it has any. Otherwise the evidence is the authwits shots of the same shared rules, the disjointness proof, and a note in lessons.
- **The capabilities window needs a dApp.** The fallback is a harness-only story mounting AccountSelectRow (a selected row, a locked row and a disabled row), dropped identically into both runner trees and shot from each tree's Storybook build.

**Layers:** lint, typecheck, unit, visual.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks.
   - Include the no-over-engineering rule verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Include the comment-quality rule verbatim: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
   - Ask specifically for any equal-specificity pair the disjointness table missed.
2. **Fix loop:** triage each finding, fix, commit, log the round in `implementations-plan/harden-dedupe/lessons/` (this arc's file) and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against `hd/02-design-tokens` (gh stack on base `harden-dedupe`), then add both e2e labels. When the program gates are green, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/03-visual-shells-a`, stacked on `hd/02-design-tokens`. Code review: off.

## UI impact

None by design. The surfaces in § Phases must be pixel-identical and computed-style identical, proven by the zero-diff harness.

## Decisions (delegated)
