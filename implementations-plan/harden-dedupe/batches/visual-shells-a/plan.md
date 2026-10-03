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

Findings Q-22 (a, b, c) and, in the files this arc touches, Q-23 (b), from `audit/quality/2026-09-30-dedup-high/`. CSS only: three shared CSS modules that consumers `composes:`, and the hairline literals in those rules swapped for `var(--hairline-strong)`. Q-22 (d, f, i), the rest of the literal sweep and `AccountSelectRow` (see Decisions) belong to visual-shells-b.

Paths below are under `apps/extension/src/` unless they start with `packages/` or `implementations-plan/`.

## Outcome & Quality Bar

- **For whom:** whoever restyles a settings row, a record card or a toolbar button. Today that means finding and editing 2 to 5 copies.
- **Excellent:**
  - Each shell's common rules are declared once.
  - Every consumer keeps exactly today's computed styles, `::after` included, at rest, hovered, pressed and focused.
  - Pixels are unchanged in Chrome and Firefox, dark and light, proven by the zero-diff harness.
- **Good enough:** each drift between copies stays local and is listed below; no copy is aligned to another.

## Architecture & Implementation

**Why CSS modules, not components.** `composes:` from a `*.module.css` is the repo's idiom for a shared visual shell (`list-empty`, `fee-shared`, `settings-page`, `detail-page`). It leaves every template, `data-testid` and DOM node as it is. Q-22's suggested L2 `ToolbarIconButton` would add a component, its five required component tests and a `components.d.ts` regeneration, all for 14 lines of CSS inside `Dropdown` and `Tooltip` slots.

**How a composed module lands in the build** (`dist/chrome`, built at 6ec153b7). The whole shared file is copied into every CSS chunk that has a consumer, ahead of that consumer's rules: `fee-shared.module.css`'s four rules appear in both `send-*.css` and `FeeSettingsCard-*.css`. Route chunks load lazily, so a copy loaded later can land after another consumer's local rules. Today's in-file source order therefore says nothing about how a moved rule will resolve.

**The neutralising rule: disjoint declarations.** On every element, the longhands that its shared classes declare in a given state (rest, `:hover`, `:has(...)`, `:active`, `::after`) never overlap with what its local classes declare, so order cannot matter. A property declared both ways with the same value (`position: relative`) is deleted locally, not listed. There are only two exceptions, and each wins by strictly higher specificity, exactly as it does today:

1. **E1:** a local `:last-child::after` or `:last-of-type::after { display: none }` (0,2,1) over the shared `.divider::after { display: block }` (0,1,1).
2. **E2:** the shared `.card:hover` (0,2,0) and `.card:has(...)` (0,3,0) `border-color` over the local `.card { border… }` (0,1,0). Notes' inline `border-left-color` and `.card_error`'s `!important` still sit above both.

The shared files contain only plain rules and no `composes`, like the existing shared modules. A consumer that needs two classes composes both: `composes: divider row from "…"`. Each shared file opens with `/* Keep local overrides order-independent: lazy chunks can repeat these rules. */`.

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
| `components/ui/Settings/SettingItem.vue:156-204` | `divider` on `.wrapper` | everything else, including `::after` 20px insets, `:last-child::after` (E1), the size, `raw` and `disabled` modifiers, and all of `.interactive` |
| `components/ui/Settings/SettingField.vue:34-73` | `divider` on `.wrapper` | everything else, including `::after` 16px insets, `:last-of-type::after` (E1) and `disabled` |

**Equal-specificity pair that resolves by source order today:** SettingItem's `.wrapper.raw` against `.interactive:hover`, both (0,2,0). That is why SettingItem shares only the divider; the pair stays inside one file, in today's order.

### (b) `popup/components/modules/settings/record-card.module.css`

Its consumers are an L4 component and an L6 page.

**Shared classes:**

- **`card`:** `position`, `display`, `flex-direction`, `gap`, `cursor`, `transition: all`, the `:hover`/`:has` background and `border-color`, the `:has` outline and the `:active` background. It carries no `border` and no `padding`, because notes' `border-left` overlaps the `border` shorthand.
- **`header`, `type`, `kv_grid`, `kv_key`, `kv_val`, `kv_val_wrap`.** These go in that order: `kv_val_wrap` overrides `kv_val`'s `white-space` by source order. Every chunk carries the whole file, so that order holds in every copy. The one wrap-rationale comment lives on the module's rule; both local copies go.

| site | composes | keeps locally |
|---|---|---|
| `popup/components/modules/settings/authwits/AuthwitCard.vue:65-168` | all seven | on `.card`: `border`, `padding: 12px`, and `&:hover .revoke, &:focus-within .revoke` (it names the local `.revoke`); `.revoke` itself |
| `popup/pages/settings/advanced/account-state/notes/index.vue:261-392` | all seven | on `.card`: `border`, `border-left`, `padding: 12px 12px 12px 10px`, with its comment shortened to `/* The inline left-border color groups notes by contract. */`; `card_error`, `contract`, `contract_name`, `location`, `raw`, `raw_line`, `render_error*` |

### (c) `popup/pages/toolbar-button.module.css`

It sits next to `detail-page.module.css` and `tab-hero.module.css`. Its one class, `icon_btn`, holds today's whole rule.

The five sites are `popup/pages/settings/contacts/index.vue:205-222`, `popup/pages/settings/connected-apps/index.vue:298-315`, `popup/pages/settings/connected-apps/[id].vue:368-385`, `popup/pages/settings/advanced/account-state/authwits/index.vue:207-224` and `popup/pages/tokens/[id].vue:299-321`. Each local `.icon_btn` becomes `composes: icon_btn from "<relative path>"`. `tokens/[id].vue` also keeps `&:disabled` locally; its `opacity` and `pointer-events` are disjoint from the shared rule. `:focus-visible` stays absent on all five (owner call 5).

Out of scope: the other classes named `icon_btn` (`RecipientCard`, `ImportContactsPopup`, `EditFpcPopup`, `settings/networks/index.vue`). They style icons or a different 28px button, not this shell.

### Q-23 (b) in these files

The arc touches four hairline literals, all `rgba(74, 70, 63, 0.3)`: ContactRow `:92`, connected-apps `:206`, SettingItem `:180` and SettingField `:65`. All four become the single `var(--hairline-strong)` in `divider`. None of the touched files has a 0.2 literal. AccountSelectRow's `:140` waits for visual-shells-b.

The minified build already emits both the token and the literal as `#4a463f4d`, so the color bytes match too.

### Drift left for the alignment arc

None of these is unified here. Each stays local, as it is today.

1. **The last-row rule:** `:last-child` in ContactRow, connected-apps and SettingItem; `:last-of-type` in SettingField. The program already keeps it as today.
2. **Divider insets and row padding.** Insets are 16px (twins, SettingField) and 20px (SettingItem). Padding is `12px 16px`, `14px 16px`, and 12, 16 or 20 by 20 by size in SettingItem.
3. **The keyboard ring:**
   - the twins draw the `:has` outline;
   - SettingItem draws it in interactive mode only, plus its own `:focus-visible`;
   - SettingField has neither, and has no focusable target, yet it sets `cursor: pointer`, `:hover` and `:active`.
4. **Hover and cursor scope:** SettingItem's cursor, transition and hover apply only to interactive rows; every other row is always interactive-styled.
5. **Disabled treatment:** SettingItem and SettingField dim to 0.5 and drop pointer events through a `disabled` class (SettingItem also goes inert); the twin rows have no disabled state.
6. **Record cards:**
   - padding is 12px against `12px 12px 12px 10px`;
   - only notes has the 4px accent left border, and only notes has an error accent (`card_error`, red, `!important`);
   - only AuthwitCard reveals an action on hover or focus-within.
7. **Toolbar button:** a `:disabled` state exists only in `tokens/[id].vue`; no copy has `:focus-visible` (recon said two lacked it; all five do).
8. **The light-theme hairline:** the dark-hued value, kept by the program panel.

**Left for visual-shells-b with AccountSelectRow:** its 14px insets and padding, its outline-less focus background, its missing `:active` background and its `row_name` without letter-spacing.

## Security & Adversarial Considerations

None material: CSS rules move between files, and nothing touches data, input, crypto or dependencies. The adversarial risk is a cascade slip that hides an affordance, for example a row's focus ring or the Disconnect action's red hover. That slip comes from source order, which the disjointness rule removes. The pseudo-state probes under § Phases catch it. No approval window (execute, connect, sign, capabilities) is touched.

## Assumptions

**Facts** (read 2026-10-02 at 6ec153b7):

1. ContactRow `:62-100` and connected-apps/index `:176-214` are byte-identical. Their `:122-148` and `:232-258` blocks differ only in the class names `row_address` and `row_grants`.
2. In SettingItem, `.wrapper.raw` (`:201-203`) and `.interactive:hover` (`:210-214`) are both (0,2,0).
3. AuthwitCard `:100-121, 129-168` and notes `:300-321, 354-392` match apart from comments. In both, `.kv_val_wrap` overrides `.kv_val` by source order.
4. The five toolbar rules are identical; `tokens/[id].vue:317` adds `:disabled`.
5. A composed module is copied whole into each consumer chunk (`dist/chrome`, as above).
6. `--hairline-strong` is declared once, in `packages/design/src/base.css:108`'s `:root, [theme="dark"]` block, and no file redefines it. `DetailsTable.vue:137` shadows only `--hairline-soft`.
7. No touched component receives a class from its parent that declares a shared property. FpcRow's `fpc_item` sets only `min-height`, `height` and `padding`.
8. No test reads these components' CSS-module maps.
9. A `composes` in a rule that also has nested rules already compiles: `popup/components/popups/ImportContactsPopup.vue:279-286`.
10. `theme-vars.test.ts` scans `src/**/*.css`, so it checks the new modules' `var(--hairline-strong)`, which is declared.

**Asks:** none; the panel's calls are under Decisions.

## Phases

### Phase 1: settings rows

Add `settings-row.module.css` and convert the four sites. The hairline swap lands here.

- **Gate:** `bun run lint`, `bun run typecheck:all`, `bun run test`, all exit 0.

### Phase 2: record cards

Add `record-card.module.css` and convert AuthwitCard and notes. **Gate:** the same commands.

### Phase 3: toolbar button

Add `toolbar-button.module.css` and convert the five pages. **Gate:** the same commands.

### Phase 4: evidence

**Commands:** `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run audit:vue` and `bun run test:ci-gating`. Each must exit 0.

**Disjointness table** (one-off, logged in this arc's lessons file): for each consumer class that composes, what it keeps locally and which shared longhands, if any, it meets. Only E1 and E2 may appear.

**Screenshots and computed styles:** the local screenshot harness (outside the repo), run as batch `visual-shells-a` with base `<parent>` and head `<head>` on Chrome and Firefox, must report every surface identical. That covers Chrome and Firefox, dark and light, at 360×600@2x, on the real build. Each surface with a probe also writes its touched elements' full computed styles (element and `::after`) per state. The probe runs before the harness's blur and with its freeze CSS off, so transitions report real values. Base and head must match leaf for leaf. A `--stability` pass must be clean too.

**State checklist** (each proven by computed style, and the rest state by pixels too):

| state | where |
|---|---|
| rest, hover, `:active`, keyboard focus on the row target | contacts, connected apps, authwits, notes (the error card too, for E2), settings index, account state, network detail; the twins' `.row_text` and `.actions` containers are recorded with their rows |
| hover and focus on a row action | contact edit, session disconnect (with its SVG's red fill), authwit revoke (the `:focus-within` reveal) |
| the divider hidden on a true last row | every list's last row (`:last-child`), both network-detail containers included; SettingField made the last of its type by lifting its following sibling out of the DOM for the probe, since Profile renders a `div` after it |
| SettingItem sizes and disabled | account state (`large`), network detail (`small`, and the disabled "Active network" row), FPCs (`raw`) |
| toolbar rest, hover, `:active`, focus, disabled | rest, hover, `:active` and focus on all five pages, both token-detail buttons included; `disabled` set on the refresh button for the probe, since nothing disables it today |
| hover, in pixels | a contact row, an authwit card (revoke shown), the token menu button |
| late duplicate copies | settings index, contacts, authwits and token detail visited again after every other chunk has loaded |

**Data** (no Aztec sandbox; every data surface asserts its row or card count before the shot, so a failed seed cannot pass as an empty state):

- **Contacts:** two, through the Add-contact popup.
- **Connected apps:** two sessions through the background's `dapp-session` port (`addDappSession`, then `setCapabilityGrants` on one), idempotent across the theme loop. The detail page masks its "Expires" line, which is clock-derived.
- **Authwits:** three schema-valid rows under `nulo:core:auth-registry@<id>` (a `call` with wrapped values, a `message_hash`, an `intent`), scoped to the active profile, chain and account. The registry flag stays absent.
- **Notes:** an in-page stub. `chrome.runtime.connect` is wrapped so only a port named `note` gets a fake that answers `getNotes` with three notes: two contracts, one long-hex value (`kv_val_wrap`) and one with `renderError` (`card_error`). The surface asserts the stub served at least one request and that three cards rendered.
- **Token detail:** one token row, written as the activity specs write it.
- **Profile:** its random ID line is masked.

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

### Plan audit (Codex round 1: REVISE; one independent Opus panelist), 2026-10-03

**The plan's asks:**

- **Notes evidence: an in-page port stub on the real build** (both panelists). Proxy shots of the authwit cards cannot show the notes page's own cascade. If the stub had failed on either browser, all of (b) would have been deferred rather than shipping a one-consumer module.
- **AccountSelectRow: out of this arc, token swap included** (Codex wanted a harness-only story, Opus removal; removal taken). A story bundles CSS differently from the extension's lazy chunks, so it cannot prove the chunk-order risk this plan names. The gain is three small classes, and the capabilities window is an approval surface that now stays untouched.
- **Seeding** as listed under § Phases. Connected apps go through the background because storage rows are MAC-signed and a bad row is quarantine-deleted (`wallet/services/dapp-session/mac-storage.ts`). The authwit registry flag stays absent because absent means enabled, and a mis-scoped key could render the disabled state.

**Codex findings adopted:**

- The state checklist above (`:active`, the disabled toolbar button, the SettingItem variants, a true last row, row and action focus captured before the blur, transitions with the freeze off, one late revisit per module).
- The drift inventory now has the disabled treatment and notes' error accent; the AccountSelectRow entries moved to the visual-shells-b line.
- Fact 9 replaces the "no nested-composes precedent" inference.
- Comments: the notes border comment shortened, one copy of the wrap rationale, the order-independence invariant in each shared module, no plan references in CSS.

**Opus additions adopted:**

- A `position: relative` declared both in `divider` and locally is deleted locally instead of listed as an exception.
- The Storybook fallback never counts as pixel identity for a moved rule, so it is gone from the plan.
