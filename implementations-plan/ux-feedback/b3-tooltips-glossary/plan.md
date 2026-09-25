---
plan: ux-feedback/b3-tooltips-glossary
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: fable Plan subagent (model fable, fallback opus)
eli5_mode: artifact
program: implementations-plan/ux-feedback/plan.md (batch 3, arc 3 of 6)
arc_branch: feat/ux-3-tooltips-glossary
design: implementations-plan/ux-feedback/design/spec.md (items 2 and 9, the tooltip map, U8, U9)
artifact: https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF
eli5: https://claude.ai/artifact/HtXnDzds12RLSFpS5L8paW
---

# Batch 3 · Tooltips and glossary

Arc 3 of the UX program's six-PR stack, on top of batch 2 (window placement). It covers:

- Item 2, the fixed `Tooltip.vue`.
- Item 9: the glossary module, the Glossary page, the dotted term and the CLAUDE.md rule.
- From the tooltip map: the two dotted fee definitions, the two balance-split icon labels, and the
  two rule-6 texts (round 5, U8 and U9).

The permission window's two dotted terms and the Alias ⓘ removal ship with its redesign in batch
5, on the component and keys this batch adds.

**The design is the artifact**, <https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF>, quoted by
[`../design/spec.md`](../design/spec.md) § Item 2, § Item 9, § Tooltip map, § Undrawn states.
Shots: `02-tooltip`, `09-home-dotted`, `09-glossary`, `09-definitions`, `09-claude-md-rule`,
`tips-map`, `tips-icon-labels`, `tips-host-U8`, `tips-phrase-U9`. Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the program)

Recorded from `implementations-plan/ux-feedback/plan.md` § "Phase 0, answered for every batch";
no clarifying questions were asked.

- **Success**: items 2, 9 and the batch's part of the map built exactly as the spec says; parity
  evidence published; every gate below green on Chrome and Firefox.
- **Who and what excellent looks like**: the program's Outcome & Quality Bar, plus this batch's
  line (below).
- **Scope**: the batch's items only. Out:
  - the permission window's dotted terms and the Alias ⓘ (batch 5);
  - scroll-following for open tooltips;
  - keyboard focus for the icon-only triggers that have none today;
  - `Popover.vue`;
  - the 15 browser `title` tooltips;
  - the shared sub-page header's height and letter-spacing, which differ from the mocks on every
    sub-page (listed in parity, not changed);
  - the `@aztec/*` line. (`apps/tools` and `packages/bridge-core` left this repo with dev's #691;
    the worktree's untracked leftovers of them are not touched.)
- **Constraints**: pre-production, no migrations; Bun 1.4.2; the account freeze untouched;
  complexity budgets hold with no new acceptance; no new dependency (item 2: "one primitive, no
  new dependency"); `base.css` untouched (hash-pinned).
- **Quality bar**: production.
- **Validation layers**:
  - typecheck and lint, unit, component;
  - smoke e2e on Chrome and Firefox;
  - the network specs that open each dApp window, on Chrome and Firefox (the identity block
    and tooltips render there);
  - the Storybook build (stories change).
- **Surface vs delegate**: UI decisions come from the spec, the owner's picks and round 5;
  technical decisions go to `/codex high` and are logged.
- **`/code-review`**: off. **`/harden`**: not scheduled.

## Outcome & Quality Bar

For whom: someone reading a Nulo screen for the first time, with a mouse, a keyboard or a screen
reader.

Excellent means:

1. **A tooltip is never cut off sideways.** It stays 8px inside the window, flips above when
   there is no room below, is at most 272px wide, wraps any unbroken string, and can be read by
   moving the pointer onto it.
2. **Words have one meaning everywhere.** A dotted term shows the glossary's sentence, the
   Glossary page shows the same sentence, and a test fails if the two could drift.
3. **Warnings are never hidden.** The suspicious-hostname warning and the recovery-phrase note
   are text on the screen, not behind a hover.
4. **Keyboard and screen reader get the same**: a dotted term is a Tab stop and announces its
   definition; Esc closes the tooltip before anything under it.

Good enough: the other 30 tooltips keep their text, triggers and alignment and only gain the fixed
placement.

## Round-5 picks

Read 2026-09-24 17:4x from the artifact's `picks` store (22 documents): `tipsb` (U8) and `tipsc`
(U9) have no pick, so both are built as drawn (the recommended option) and listed **sign-off
pending**. Re-read before P3 started (2026-09-25): unchanged, 22 documents, no `tipsb` or `tipsc`.

## UI impact

| # | Surface | Before → after | Shot | Sign-off |
|---|---|---|---|---|
| 1 | Every `<Tooltip>` (33 in the extension, 1 in `Input.vue`) | Placed once, unclamped, text capped at 320px, 8px from its trigger, closes when the pointer leaves the trigger, Esc does nothing, fades in and out over 0.12s → 6px from its trigger as drawn, stays 8px inside the window, flips above/below, bubble at most `min(272px, window − 16px)` wide, long strings wrap, the pointer can move onto it, Esc closes it, pressing a button or link inside its trigger closes it; enters with a 2px rise over 0.12s ease-out and disappears at once, as the artifact's live tooltip does (`nulo.css:467-468`, `page.js:487`) | `02-tooltip` | i2 "A only" (owner); the motion **sign-off pending**, Ask U-7; the press closing it **sign-off pending**, Ask U-8 |
| 8 | Capabilities window, the Alias ⓘ | bubble starts at the ⓘ's left edge (`position="start"`) → centred on the ⓘ, then kept 8px inside the window, as option A draws it (`design/mocks/src/parts/02-tooltip.html:71`, `data-tip-mode="clamp"`) | `02-tooltip` | **sign-off pending**, Ask U-6 (batch 5 removes the ⓘ) |
| 2 | Home fee labels | "Public Fee Juice" / "Private Fee Juice" plain → dotted terms, Tab stops, left-aligned definitions "Paying a fee with it shows your address." / "Paying a fee with it keeps your address hidden." | `09-home-dotted` | i9 dotted, i9b shorter definitions (owner) |
| 3 | Balance split (padlock and globe) | no tooltip → padlock "Private balance: only you can see it", globe "Public balance: anyone can see it", left-aligned; no underline, no Tab stop | `tips-icon-labels` | tips "All of it" (owner); **sign-off pending** on where: see Ask U-1 |
| 4 | Settings → App | new row "Glossary", "What Nulo's words mean", `menu_book`, between Proving and Advanced | round 2's i9 Settings panel (not redrawn in round 3) | i9 "likes the glossary page (C)"; **sign-off pending** for the row itself |
| 5 | Glossary page (new) | back arrow, "Glossary", four sections, nine entries (term, definition, where it appears) | `09-glossary` | i9, i9b, i9c "Authorizations" (owner) |
| 6 | dApp identity block (connect, permissions, execute, emoji check) | warning icon with the sentence on hover → one orange line under the host, icon first, top-aligned, today's sentence | `tips-host-U8` | round 5 U8, as drawn, **sign-off pending** |
| 7 | Import, recovery phrase (onboarding and popup) | ⓘ with the sentence on hover → the sentence between the label and the field, 8px from each as drawn; the ⓘ goes | `tips-phrase-U9` | round 5 U9, as drawn, **sign-off pending** |

Keyboard: Home gains two Tab stops, the dotted terms (the mock gives them `tabindex="0"`).

### UI asks for the owner (built as recommended, sign-off pending)

- **U-1 · Where the icon labels go.** The tooltip map puts them on "the Home balance split", and
  the mocks draw Home with a single-token hero and a padlock/globe split. The real Home shows the
  aggregate total with no split: the split renders only on a token's page (`BalanceView.vue:291`
  shows it only with `tokenBalance`; `popup/pages/general.vue:51` passes none,
  `tokens/[id].vue:271` does). Recommended and built: the labels on the split where it exists,
  the token page. Alternatives: drop them, or draw a split for Home.
- **U-2 · Keyboard for the icon labels.** The map says tooltips open "on hover and focus"; the
  mock gives the glyphs no `tabindex`, so no key reaches them. Recommended and built: as drawn,
  no Tab stop; screen readers get the label as the icon's accessible name.
- **U-3 · Open delay for the icon labels.** No mock times them. Recommended and built: 300ms, the
  dotted terms' delay (`page.js:518`); existing icon buttons use 350 or 0.
- **U-4 · Tooltip text colour.** The mocks draw every bubble's text `--nulo-secondary`
  (`nulo.css:181`): on the bubble 3.98:1 dark and 4.09:1 light, both under WCAG AA's 4.5:1 for
  12px. Nine of today's 33 tooltips wrap their text in `<Text color="secondary">`, which is
  `--txt-secondary` (`utilities.css:141-143`): the mock's colour in the dark theme (`#999187`
  both, `base.css:99`, `:102`), not in light (`rgba(0, 0, 0, 60%)`, 5.14:1, against `#6b655c`,
  `base.css:145`, `:154`). 24 pass bare text, which renders `--txt-primary` (10.8:1 dark).
  Recommended and built: the new tooltips as drawn, `--nulo-secondary` in both themes (the token
  `base.css` already defines for each); the 33 unchanged. Alternative: `color="secondary"`, which
  matches the nine in both themes and passes AA in light only.
- **U-5 · A tooltip taller than the window.** Long error text is the likely case; a short enough
  window makes any bubble too tall. No drawing covers it. Recommended and built: it pins to the
  top 8px inset and runs past the bottom edge.
- **U-6 · The Alias tooltip's alignment.** Option A's panel draws it centred on the ⓘ and clamped
  to the 8px left inset (`design/mocks/src/parts/02-tooltip.html:71`); its note says "Same tooltip, same component"
  and "Fixes all three start-aligned tooltips", which reads as keeping `position="start"`
  (`AccountSelectRow.vue:82`), where the fixed primitive leaves it at the ⓘ's x, about 90px right
  of the drawing. Recommended and built: as drawn, `position="center"` on that one tooltip. The
  other start-aligned tooltips keep `start` (none is drawn).
- **U-7 · Tooltip motion.** The artifact's live tooltip enters with `n-tip-in 0.12s ease-out`
  (opacity 0 → 1 and a 2px rise, `nulo.css:467-468`) and is removed at once on close
  (`page.js:487`); today's primitive fades opacity in and out over 0.12s `ease`
  (`Tooltip.vue:240-250`). Recommended and built: as drawn, for every tooltip, since item 2 says
  every tooltip uses the fixed primitive. Alternative: keep today's fade.
- **U-8 · Pressing a control inside a tooltip's trigger.** Neither the spec (`spec.md:42-43`:
  hover and focus open it, Esc closes it) nor the mock (`page.js:479-529` handles no press;
  `design/mocks/src/parts/02-tooltip.html:80`, "Clicks — Unchanged") defines it. Today the "Delete profile" tooltip
  stays open under the popup its button opens (`auth.vue:307-313`). Recommended and built: the
  press (a click, Enter or Space on a `button`, `a` or `[role="button"]` in the trigger) closes
  the tooltip, and it stays closed until the pointer arrives or leaves again or focus leaves,
  as Radix's tooltip trigger does (it closes on `pointerdown` and ignores the focus that
  follows), and the reason the popup the press opens gets the first Esc. Alternative: leave it
  open, and the popup's first Esc goes to the tooltip. The rule covers the controls a press can
  focus. About 20 triggers are a bare `<Icon @click>` or `<div @click>` with no `tabindex`
  (under `apps/extension/src/popup/`: `pages/settings/accounts/index.vue:150`,
  `pages/settings/tokens/index.vue:95`,
  `pages/settings/advanced/account-state/senders/index.vue:132`,
  `modules/settings/fpcs/FpcRow.vue:71`, …): only a mouse presses them, no `focusin` follows, and
  the popup a press opens lays a full-window overlay (`Popup.vue:115-121`, `.wrapper` at 0 on
  all four sides) under the resting pointer; both browsers update hover after that layout
  change, so the leave rule closes the tooltip, after 150ms where today it closes at once. They
  need nothing.
- **U9's position in the spec's text.** `spec.md:277` says "One line under the field"; the
  drawing and its note put it between the label and the field (`gen_r5.py:284-291`). Built as
  drawn; the spec line needs the owner's correction.
- The Settings row (row 4), U8 and U9, as listed above.

## Architecture & Implementation

### Tooltip (`packages/design/src/ui/Tooltip.vue`, item 2)

- **Geometry in a pure helper**, `packages/design/src/ui/tooltip-placement.ts`:
  - `placeTooltip({ trigger, bubble, viewport, side, position }) → { x, y }`: rects in, a point
    out.
  - It keeps today's `side`/`position` arithmetic, including the invalid-position fallback, with
    the trigger gap at 6px, the mocks' value (`page.js:398`); today's code uses 8.
  - `top` and `bottom` flip to the other side when the bubble overflows `viewport.height − 8` (or
    `8`) there and fits on the other side.
  - Both coordinates are then clamped into `[8, viewport − 8 − size]`, the "8px inside both window
    edges" rule. When the bubble is larger than that interval (only height can be, U-5), it takes
    the start inset, 8.
  - `left` and `right` get the clamp and no flip, since the spec names only above and below. No
    production tooltip uses them (`LogsToolbar.vue:41` is a `Popover`); the package API and its
    stories keep them.
  - `viewport` is `window.innerWidth`/`innerHeight`, the window the spec names.
  - The mock never flips its `start`-mode tips (`page.js:403`); the spec's "flips above/below
    when it doesn't fit" governs, so every top/bottom tooltip flips.
  - The component calls the helper where it builds `translate3d` today.
- **Width and wrapping**: `.content { max-width: min(272px, calc(100vw - 16px)) }`, with the
  bubble `border-box`, so the cap includes padding and border. `.text` drops the
  `calc(var(--base-width) - 40px)` clamp and gains `overflow-wrap: anywhere`, so an unbroken
  string (an address or a hash in an error) wraps inside the cap. The host-DOM comment drops its
  `--base-width` requirement. `maxWidth` still narrows the text (`auth.vue:307`, 220px).
- **Inline layout**: a new `inline` boolean prop makes the wrapper and trigger `inline-flex`
  with baseline alignment, so a dotted term can sit inside a sentence (batch 5's
  "authorizations"). The default keeps today's `flex`.
- **Pointer onto the bubble**:
  - Leaving the trigger (`mouseleave`, `touchend`) cancels a pending open at once and closes
    after 150ms. Entering the trigger or the bubble cancels that close, and leaving the bubble
    starts it again. These are the mock's timings (`page.js:507-523`).
  - `focusout` still closes at once (the mock's blur).
- **Timers**: at most one pending open and one pending close.
  - An immediate open (focus) cancels both a pending open and a pending close, so
    hover → leave → focus leaves the focused tooltip open (the mock's single timer, cleared in
    `show()`, `page.js:492-493`).
  - A dismissal (Esc, a press) and a close cancel both timers, so a hover timer cannot reopen a
    dismissed tooltip.
  - Unmount clears both timers and the Esc listener.
- **Esc**: while open, a `keydown` listener on `window` in the capture phase closes the tooltip
  on Escape and calls `preventDefault()` and `stopPropagation()`. It is removed on close and on
  unmount.
  - Window capture runs before every other Escape consumer: focus-trap's handler, for both the
    popup's trap and a menu's (`document`, bubble phase, `focus-trap` 8.2.2,
    `focus-trap.esm.js:882-886`); `DropdownRoot.vue:224` and `Popover.vue:57` (`document`);
    `PasskeyCeremonyDialog.vue:50` (`window`, bubble). So a tooltip open inside a popup closes
    first and the popup stays, as a menu inside a popup does (CLAUDE.md § Keyboard & focus order).
  - `stopPropagation()`, not a `defaultPrevented` check in each consumer: a menu's trap keeps
    focus-trap's default `escapeDeactivates` (`DropdownRoot.vue:161-164`), which deactivates on
    any Escape whether or not it was handled, and a consumer added later would have to remember
    the check. Stopping the event fails closed for both.
  - `preventDefault()` keeps Chrome's toolbar popup open, as CLAUDE.md requires of anything
    acting on Escape.
  - Two tooltips open at once (one hovered, one focused) both close, since `stopPropagation`
    does not stop listeners on the same target.
- **Pressing a control inside the trigger closes it** (U-8, sign-off pending): a
  `pointerdown`, or an Enter or Space `keydown`, whose target sits in a `button`, `a` or
  `[role="button"]` inside the trigger closes the tooltip, cancels its timers and sets a
  dismissed latch. Neither key is `preventDefault`ed: cancelling a Space `keydown` on a native
  button suppresses its click, and `auth-reset` acts only in `@click` (`auth.vue:308`).
  - The latch blocks every open path (hover, touch, focus) and clears when a mouse or pen
    arrives (`pointerenter` with `pointerType !== "touch"`), on `mouseleave` and on `focusout`,
    never on `touchend`, which today shares the leave handler (`Tooltip.vue:155`) and which a
    tap fires before its focus.
    A press focuses the button, and without the latch its `focusin` would reopen what the press
    closed, so the popup the press opens (`auth.vue:307-313`, "Delete profile";
    `Popup.vue:21-25` keeps focus on the opener) would lose its first Esc to the tooltip.
  - Why a non-touch `pointerenter` and not `mouseenter`: a mouse or pen press has no arrival
    between its `pointerdown` and its `focusin` (a pen's `pointerenter` and compatibility
    `mouseenter` both precede its `pointerdown`), but a touch tap fires a compatibility
    `mouseenter` in that gap (`pointerdown`, `touchstart`, `touchend`, `mouseenter`, `mousedown`, focus), which would
    clear the latch just before the focus it exists to block. Without the arrival rule, the first
    hover after a keyboard press would be dead until the pointer left once.
  - Esc does not set the latch: it cancels the timers, and nothing reopens without a fresh
    arrival or `focusin`, as in the mock, where a later `pointerenter` shows it again after
    300ms (`page.js:517-531`).
  - A press on a dotted term (a focusable `span`) is not a control press: it focuses the term
    and shows the definition, and Enter does nothing, as the mock does (`page.js:526`, no key
    handler but Esc).
- **Semantics**: the bubble gets `role="tooltip"` and `data-testid="tooltip-bubble"`, its text
  box `data-testid="tooltip-text"`. Nothing inside is clickable: content stays text, and
  `@click.stop` stays, so a click on a bubble never reaches what it covers.
- **A press on the bubble keeps focus where it is** (`@mousedown.prevent` on the bubble). A press
  on non-focusable content blurs the focused trigger, whose `focusout` would close the bubble
  before the click, and the click would then land on what the bubble covered. The cost: bubble
  text cannot be drag-selected, which it cannot be today either (the bubble is unreachable).
- **Motion (U-7, as drawn)**: the enter transition animates `opacity` 0 → 1 and the independent
  CSS `translate` property `0 -2px` → `0` over 0.12s `ease-out` (`nulo.css:467-468`); `translate`
  composes with the inline `transform` placement instead of fighting it. The leave transition
  goes, since the mock removes the bubble at once (`page.js:487`).
- Props, slots, defaults (`textAlign` stays `center`), teleport target and the delay parsing
  are unchanged, so all 34 call sites keep compiling and rendering their own content.
- **Comments**:
  - The helper's one-line contract (both edges, flip only on the vertical sides, the start inset
    when too large).
  - The window-capture listener's reason in one sentence, with the actual order.
  - The focus comment (`Tooltip.vue:142-143`) states the latch's invariant in one sentence: a
    press focuses the control, and that `focusin` must not reopen what the press closed, until
    a mouse or pen arrives or the pointer or focus leaves. The arrival listener carries one
    sentence: it listens for `pointerenter`, not `mouseenter`, because a tap's compatibility
    `mouseenter` falls between its `pointerdown` and its focus, and it skips touch, which has no
    hover.
  - The `maxWidth` prop doc is rewritten, because its "clamp to the popup viewport" becomes
    false.
  - The fade comment shrinks to its one invariant (the inline `transform` is the placement, so
    the rise animates `translate`).
  - The comments that restate the placement switch (`Tooltip.vue:64-67`, `:77-80`) go.
  - `Tooltip.test.ts:115-118`'s block (fixture narration, extraction history, the old 8px gap)
    goes; the table and the named fixtures explain the test.

### Glossary (`apps/extension/src/utils/glossary.ts`, item 9)

- `GLOSSARY`: a `Record` keyed by id of `{ term, definition, where }`, `as const satisfies`, so
  `GlossaryKey` is a literal union. It holds the nine entries of spec § Item 9, word for word:
  `private-balance`, `public-balance`, `fee-juice`, `public-fee-juice`, `private-fee-juice`,
  `sponsored`, `authorization`, `name-for-this-app`, `proving`.
- `GLOSSARY_SECTIONS`: `Balances`, `Fees`, `Apps`, `Transactions` with their keys in the spec's
  order.
- Tests in `glossary.test.ts`:
  - every key sits in exactly one section, and the sections cover every key;
  - the nine entries equal the spec's strings.
- `DottedTerm.scan.test.ts`, added in P2 with the first consumers (P1 has none, so its count
  assertion could not pass there), a source scan over `apps/extension/src/**/*.vue` in the
  `call-sites.test.ts` style:
  - every `<DottedTerm` occurrence must carry a static `term="…"` naming an existing key;
  - a bound `:term`, a missing `term` or an unknown key fails, so nothing is skipped silently;
  - the scan's count of occurrences is asserted to be at least one, so it cannot pass vacuously;
  - every key a dotted term uses has a one-sentence definition of at most 100 characters (map
    rule 5; Proving, two sentences and 123 characters, is only in the glossary).

### Dotted term (`apps/extension/src/components/composite/DottedTerm.vue`, L3)

- Props `term: GlossaryKey` (a validator warns on an unknown key) and `position`, default
  `center`. The visible text is the slot, so batch 5 can underline "authorizations" mid-sentence
  with the `authorization` entry.
- Renders `<Tooltip inline :position textAlign="left" delay="300">`, the mock's hover delay and
  left-aligned text:
  - the trigger is `<span tabindex="0" :aria-describedby>`;
  - the content is a plain `<span>` with `display: block`, `line-height: 1.2` and
    `color: var(--nulo-secondary)` local, as `.n-tip-text` draws it (a block `div`,
    `design/mocks/src/parts/02-tooltip.html:71`; `nulo.css:181`; U-4). `display: block` is what
    lets the 1.2 hold: an inline span's line box never drops below its block's strut, and
    `.text` (`Tooltip.vue:227-233`) and `body` (`base.css:284-292`) set no line-height, so the
    strut is InterVariable's `normal`, about 1.21. Tooltip's `.text` already supplies its 12px/600
    (`Tooltip.vue:230-231`), and `--nulo-secondary` is the mock's value in both themes
    (`base.css:99`, `:145` = `nulo.css:23`, `:63`), where `<Text color="secondary">`
    (`--txt-secondary`) is it only in dark.
- **Style** (the mock's `.n-term`, `nulo.css:422-423`, `:462-464`):
  - `text-decoration: underline dotted 1px`, color `--nulo-outline`, `text-underline-offset: 3px`,
    `cursor: help`;
  - on hover the underline turns `--txt-primary`;
  - `:focus-visible` adds a 1px `--txt-primary` outline at offset 2px and turns the underline
    `--txt-primary`.
- **Screen reader**: `aria-describedby` points at a `hidden` span holding the definition, always
  mounted next to the term (`useId()`). The accessible-description computation includes a hidden
  node that is referenced directly. The teleported bubble exists only while open, and a
  description created after focus is not reliably announced; this one sentence of why is the
  component's one comment. The evidence is the computed description (Chrome's accessibility
  tree, Firefox's DOM); no screen-reader announcement is recorded, so the PR claims no more.
- `testid` passes through to the term span.

### Fee labels and the balance split (`GasBalanceCard.vue`, `BalanceView.vue`)

- Fee labels: `<span :class="$style.label"><DottedTerm term="public-fee-juice" testid="gas-label-public">Public Fee Juice</DottedTerm></span>`,
  the same for private. The label keeps its font and color; the dotted term adds the underline;
  both take the default `center` placement, clamped, as the shot's `clamp` mode.
- Balance split (U-1: the token page, where it renders):
  - Each group is wrapped in `<Tooltip textAlign="left" delay="300">` whose content is the same
    plain `<span>` as the dotted term's (`display: block`, `line-height: 1.2`, `--nulo-secondary`,
    local), holding
    "Private balance: only you can see it" or "Public balance: anyone can see it". No underline
    and no `tabindex` (U-2).
  - `aria-label` with the same string goes on the `<Icon>` itself. `Icon` already renders
    `<svg role="img">` with attribute fallthrough (`Icon.vue:57-63`), so no wrapper is needed.
    The prohibited `aria-label` on the generic group span goes.
  - One constant per string, used for both.
  - Testids `private-balance-value` and `public-balance-value` stay.
  - The comment's workflow provenance ("owner call, post-approval", `BalanceView.vue:289`) goes.
    What stays is why the pair has no words.

### Glossary page and the Settings row

- `popup/pages/settings/glossary.vue`:
  - `<route>` `isAuthRequired`, and
    `<SettingsPageShell title="Glossary" backTo="/popup/settings">`, as `proving.vue` does.
  - Per section: a title styled as `ItemsContainer`'s `.title` (the same values as the mock's
    `n-setsec-t`). Later titles get `padding: 18px 0 2px` as drawn. The first gets
    `padding-top: 6px`, because the shell already supplies 16px
    (`settings-page.module.css:9`) where the mock's list supplies 4px, so it lands where the
    shot puts it.
  - Entries use page-local markup with the shot's values (`nulo.css:498-502`). The separator is
    `rgba(74, 70, 63, 0.2)`, the literal the fee card's rule already uses, since `base.css` has
    no hairline token and stays untouched.
  - Testids `glossary-section-<title>`, `glossary-entry-<key>`, `glossary-term-<key>`,
    `glossary-definition-<key>`, `glossary-where-<key>`. It renders `GLOSSARY_SECTIONS` in
    order.
- `settings/index.vue`: a `SettingItem` with:
  - `to="/popup/settings/glossary"`, `title="Glossary"`, `description="What Nulo's words mean"`;
  - `materialIcon="menu_book"` (the bundled Material Symbols font has the ligature; checked with
    fontTools);
  - `chevron`, `data-testid="setting-nav-glossary"`;
  - placed between Proving and Advanced (round 2's drawing).
- `SubPageHeaderBase.vue`: the back button gains `data-testid="subpage-back"`. It is additive and
  lets the e2e press the real control (CLAUDE.md, testids before tests).

### Rule-6 texts (round 5 U8, U9)

- `DappIdentityBlock.vue` (U8):
  - When `hostnameSuspicious`, the host row is followed by
    `<Flex align="start" gap="6" data-testid="dapp-hostname-warning">`. It holds the warning
    icon (12px, orange, `aria-hidden="true"`, 1px down) and today's sentence in a plain `<span>`
    carrying `.n-warnline`'s declarations locally (`nulo.css:588-589`): 12px/500, line-height
    1.3, `--orange`. Not a `<Text>`, which always emits `lh--<height>` (default `100`,
    `Text.vue:17-21`) and would fight the local line-height on cascade order.
  - The block aligns its logo to the top in that state, as drawn, and centers it otherwise, as
    today.
  - The Tooltip and its hover icon go.
  - The header comment keeps only the sanitization invariant and loses its milestone tag. The
    `hostnameSuspicious` prop doc says what it now shows.
- `ImportSecretForm.vue` (U9):
  - The ⓘ Tooltip goes. The sentence sits between the label and the input as `.n-fnote` draws
    it (`nulo.css:591`), a plain `<span>` with the four declarations local: 12px/500,
    `line-height: 1.35` (no utility has it), `--txt-tertiary`; `data-testid="import-seed-note"`.
  - The recovery-phrase section's gap becomes 8px, the mock's (`nulo.css:390`), from the shared
    12px (`import-shared.module.css:4`). The change is local to `ImportSecretForm.vue`'s
    `.section` (`:128-130`, used only by the recovery-phrase `div`, `:32`); the shared module,
    `ImportFullBackupForm.vue` (which composes the same rule, `:157-158`, and no shot draws) and
    the New Password section (`section_last`, 12px) are untouched. That `.section` stops
    composing and declares the shared rule's other three values locally (`display: flex`,
    `flex-direction: column`, `padding: 20px 0`) with `gap: 8px`, rather than overriding `gap`
    after the `composes`: Vite prepends a copy of the composed file into every composing
    module's CSS (`vite/dist/node/chunks/build.js:5456-5457`, vite 8.2.1), so the backup form's
    copy of the shared `.section`, at equal specificity, wins or loses on bundle order. One
    comment states that reason.
  - Both import pages get it.
  - The header comment's narration goes, and so does the `.hint_row` comment
    (`ImportSecretForm.vue:150-152`, a false "left margin" over a `margin-top` rule).
- `AccountSelectRow.vue` (U-6): the Alias tooltip's `position="start"` becomes `center`.

### CLAUDE.md

A new section, `## Tooltips and the glossary`, after "UI changes need explicit owner sign-off".
It holds the four bullets of shot `09-claude-md-rule` word for word, except that "(proposed:
`…/glossary.ts`)" loses "proposed:", since the file exists after this PR. The procedure is the
`update-docs` skill, read before the edit.

### Tooltip count

`<Tooltip>` source tags in the extension go from 33 to 34:

- +2 for the balance split;
- −2 for the rule-6 texts;
- +1 inside `DottedTerm`, which renders two dotted terms on Home.

Rendered tooltip call sites (the spec's unit, not runtime instances in repeated or conditional
components) go from 33 to 35. Batch 5's two dotted terms and the Alias removal bring them to the
spec's 36.

## Security & Adversarial Considerations

- **Phishing defense improves, never regresses.** The homograph warning becomes visible without
  interaction in all four dApp windows. It sits on its own line, so a long host that ellipsizes
  cannot push it out of view. Its text is a constant; the host stays text-interpolated (no
  `v-html`); the dApp's `name` keeps `sanitizeWireString`. The raw-URL fallback in
  `useDappHostname.ts:14-15` now shows the line for a non-ASCII raw string too, which only adds
  warnings.
- **Tooltip content: constants in this batch, not in general.** The new content is glossary
  constants and fixed labels. Existing tooltips do render externally influenced text: the execute
  window shows `getErrorMessage(error)` through `DappApprovalFooter.vue:37`, and errors can carry
  dApp-supplied names (`tx-request-builder.ts:595`). That content stays Vue text interpolation (no
  `v-html`); it is neither Unicode-sanitized nor length-bounded, which this batch does not
  change. The primitive now wraps unbroken strings (browser-measured) and pins an oversized
  bubble to the top inset (U-5, helper-, component- and browser-tested).
- **Overlay and clickjacking.** The bubble now takes pointer events (to be reachable). It is text
  only and keeps `@click.stop`, so a real click that lands on a bubble is taken by the bubble,
  never by what it covers: fail-closed. The browser test proves it at one measured
  point: a click there with the bubble closed lands on the page under it, and with it open (by
  focus and by hover) lands inside the bubble, which is teleported under `#tooltip` and so is
  never inside what it covers. No
  dApp can open or position a Nulo tooltip. The only tooltip beside approve/reject is
  `DappApprovalFooter.vue:30`, `side="top"`, above the buttons. A bubble covering what it
  overlaps for 150ms after the pointer leaves is the trade WCAG 1.4.13 asks for.
- **Escape.** The window-capture listener exists only while its tooltip is open and is removed on
  close and unmount (tested). Escape never approves or rejects a dApp request, before or after
  this batch. dApp windows do have Escape consumers: the execute window's fee-method menu
  (`OperationCard.vue:298` → `FeeSettingsCard.vue:750` → `DropdownRoot.vue:224`) and the passkey
  window's ceremony dialog (`PasskeyCeremonyDialog.vue:50`). An open tooltip takes the first
  Esc from each, as it does from a popup; the next Esc reaches them. Pressing a control inside a
  tooltip's trigger closes the tooltip and latches it closed, so a popup that control opens gets
  the first Esc; the press's own activation is never cancelled (browser-tested with Space on
  `auth-reset`).
- **Logging**: none added. **Storage**: none. **Dependencies**: none. **Permissions**: none.

## Assumptions

### Facts (verified in recon, by both audits, or by reading the file)

1. Tooltip placement is computed once per open, with no clamp, flip or Esc, and the bubble cannot
   be reached (`Tooltip.vue:55-147`).
2. focus-trap handles Escape on `document` in the bubble phase (`focus-trap.esm.js:882-886`); a
   `window` capture listener runs first.
3. Nine of the 33 extension tooltips wrap their text in `<Text>`; the mocks draw every bubble's
   text `--nulo-secondary` (`nulo.css:181`) and left-aligned (no `text-align`, `nulo.css:46`).
   `<Text color="secondary">` is `--txt-secondary` (`utilities.css:141-143`), equal to
   `--nulo-secondary` only in the dark theme (`base.css:99`, `:102`; light `:145`, `:154`).
4. The 12 pinned geometry cases resolve inside jsdom's 1024×768 window, so the clamp leaves them
   in place. Their trigger-gap coordinate moves from 8 to 6, and the invalid-position fallback
   moves from x = 0 to x = 8, both the spec's values.
5. The Glossary row is drawn only in round 2's i9 Settings panel (`mocks/src/r2/i9.html:26`); the
   bundled icon font has `menu_book`.
6. `DappIdentityBlock` is mounted by the discover, capabilities, execute and verify windows,
   each passing `hostnameHasNonAscii`, which flags any `xn--` label (`useDappHostname.ts:24`).
7. No production code has a dotted term or a glossary; no e2e hovers a tooltip.
8. The balance split renders only with `tokenBalance`, which only the token page passes (U-1).
9. The extension's Storybook builds the design package's stories (`.storybook/main.ts:26`).
10. `openPopup` opens the popup document in a tab, so no e2e can observe Chrome's toolbar popup
    closing; the `preventDefault` component assertion is the guard for that.
11. The e2e Escape probe `pressEscape` (`tests/e2e/helpers/pointer-probes.ts:68-88`) reads
    `defaultPrevented` from a `window` bubble listener, which a capture-phase
    `stopPropagation()` skips; `passkey-backup.test.ts` and `network/popup-escape-layered.test.ts`
    use it.
12. A menu's focus trap keeps focus-trap's default `escapeDeactivates: true`
    (`DropdownRoot.vue:161-164`), which deactivates on any Escape and reads no
    `defaultPrevented`.
13. Clicking the "Delete profile" `<button>` (`auth.vue:307-313`) fires `pointerdown`, then
    `focusin` on the tooltip wrapper, then the click that opens a `Popup` whose trap leaves focus
    on the opener (`initialFocus: false`, `Popup.vue:21-25`), so no `focusout` follows.
14. The smoke suite has no Aztec node, and Home's gas card keeps `gas-skeleton-*` until a read
    resolves (`GasBalanceCard.vue:65-66`); a failed or timed-out read keeps the undefined
    `display` (`balances.store.ts:190`, `:506-512`). No smoke spec waits on `gas-balance-*`. The
    two labels render in every state (`GasBalanceCard.vue:161`, `:170`).
15. `coveredAt` returns the direct hit's own testid or tag (`pointer-probes.ts:16-18`), so a hit
    on the bubble's text reads `SPAN` or `tooltip-text`, not `tooltip-bubble`.

### Asks → codex (decided in the plan audit)

1. The pure `placeTooltip` helper: **approved** (both legs), with component-level integration
   coverage.
2. Esc in window capture: **amended** twice. Round 1: the phase claim corrected; the timer,
   press and popup cases added. Round 2: `stopPropagation()` is kept over `preventDefault()` plus
   a `defaultPrevented` guard in each consumer, because a menu's trap deactivates on any Escape
   (Fact 12) and a later consumer would have to remember the guard; the e2e probe, which the
   stop starves (Fact 11), instead reads the flag once dispatch has finished. A press latch keeps
   a pressed trigger's tooltip closed (Fact 13). Round 3: the press cancels no key's default
   (Space's would suppress the button's click); Esc no longer sets the latch; a mouse
   `pointerenter` clears it, which touch's compatibility `mouseenter` cannot. Round 4: a pen's
   `pointerenter` clears it too (`pointerType !== "touch"`).
3. The 150ms close grace everywhere: **approved** (item 2 says "the pointer can move onto it" of
   every tooltip), with timer cancellation and real pointer coverage.
4. `delay="300"`: **amended**. It is the mock's value for dotted terms; for icon labels it is an
   owner ask (U-3).
5. The hidden always-mounted description: **approved**. A `hidden` span is enough.
6. The balance split's name: **amended** to `aria-label` on the `<Icon>`, which is already
   `role="img"`, with no wrapper.
7. `innerWidth`/`innerHeight`: **approved**; the scrollbar reasoning was unnecessary and is
   gone from the plan.
8. The glossary scan: **amended** to be non-vacuous (every occurrence counted; bound, missing or
   unknown keys fail).

### Plan audit ledger

Round 1 ran in parallel, both legs seeing both outlines.

- `/codex high` (GPT-6 Astra, session `01a0d491-5aab-7b01-be77-ba79237dd716`): **conditional
  approve, confidence high**.
- Fable (same-family leg): **conditional approve, confidence high**; moderate only on the icon
  font, since verified.

Both chose the main outline on every structural point except the e2e files. Fable preferred one
smoke file to halve the flake bar; codex preferred two. One file with two tests is adopted:
failures still separate by test, and the flake bar costs half. On U8 evidence, codex's rule wins:
the extension browser first, with Storybook only as a recorded exception.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | The balance split exists only on the token page; Home has none | Owner ask U-1; built on the token page, sign-off pending |
| 2 | codex | major | Existing tooltips render externally influenced error text; the clamp interval can invert; unbroken strings overflow | Security section corrected; `overflow-wrap: anywhere`; start inset when too large (U-5); long and tall text tests |
| 3 | codex, fable | major | focus-trap's Escape is in the document bubble phase, not capture; mixed timer and popup cases uncovered | Claim corrected; timer rules; a press on the trigger closes; hover → focus → Esc, popup-from-trigger, tooltip-in-popup and unmount tests |
| 4 | codex, fable | major | Tests that pass without the behavior (pure helper only, the jsdom style check, "Home stays"); no testids on the bubble and back control; wrapper teardown | Component cases forcing flip and shift; the style check dropped; `tooltip-bubble` and `subpage-back` testids; `enableAutoUnmount`; browser checks for width, bounds, pointer travel, a swallowed click; the toolbar claim moved to the component assertion |
| 5 | codex, fable | minor | 6px gap, left alignment, the focus underline, the shell's padding, inline terms | 6px gap; `textAlign="left"` on the new tooltips; focus underline; first title 6px; `inline` prop |
| 6 | codex | major | Keyboard for icon labels conflicts with the map | Owner ask U-2, as drawn |
| 7 | codex, fable | minor | Recon errors: `LogsToolbar` is a Popover; Storybook includes package stories; 9 of 33, not most; Proving is 123 characters; `public-events-capability` opens no window; the shot's glossary leads with Balances | Recon and plan corrected; `cap-request-basic` replaces it; capture the page top |
| 8 | codex, fable | minor | Stale comments in touched files (`DappIdentityBlock`, `ImportSecretForm`, `BalanceView`, `Tooltip`); "proposed:" in the CLAUDE.md text | All listed in the sections above |
| 9 | fable | minor | U8 line needs top alignment; U9's 1.35 has no utility and the section gap is 12 vs 8 | `align="start"`; local line-height; 8px gap as drawn |
| 10 | fable | minor | `menu_book` may be missing from the font | Verified present (fontTools: 3,972 glyphs, ligature resolves) |
| 11 | fable | minor | The Alias capture cannot show the clamp (`position="start"`) | Item 2's parity leads with Home's right label, where the clamp fires; the Alias capture is kept with its difference stated |
| 12 | fable | info | `DottedTerm.test.ts` needs the real components registered; two consumer tests will warn | `global.components` in the new test; stubs in the consumer tests |

#### Round 2

Both legs read the consolidated plan and the round-1 ledger.

- `/codex high` (GPT-6 Astra, session `01a0d4c5-8dd8-7083-bc09-026f3790c07b`): **conditional
  approve, confidence high**. Conditions: its findings 1-5.
- Fable (same-family leg): **conditional approve, confidence high**. Conditions: its findings 1
  (press latch and the popup-from-trigger test), 2 (the probe conflict, logged in Ask 2) and 6
  (a non-vacuous bubble click). It found every round-1 condition met except the Alias capture,
  now row 8 below.

Each finding was checked against the code before it was applied.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex, fable | major | `pointerdown` closes, but the press's `focusin` reopens at once; the "Delete profile" popup then loses its first Esc to the tooltip, a regression; no phase lists the popup-from-trigger test | Confirmed (Fact 13). A dismissed latch set by a control press and by Esc, cleared on `mouseleave`/`focusout`, blocking every open path; P1.2 "press then focusin stays closed"; P1.3 the real sequence on a `<button>` trigger |
| 2 | codex | major | Leaving must cancel a pending open at once, and a focus open must cancel a pending close, or hover → leave → focus closes the focused tooltip after 150ms | Confirmed against the mock's single timer (`page.js:492-493`); both rules written into Timers and tested in P1.2 |
| 3 | fable | major | `stopPropagation()` in window capture starves `pressEscape`'s window bubble reader; proposed `preventDefault()` only plus a `defaultPrevented` guard in four consumers | Conflict confirmed (Fact 11); **fix rejected**: the menu's trap deactivates on any Escape and reads no flag (Fact 12), so the guards fail open for it and for any later consumer. Kept `stopPropagation()`; `pressEscape`'s reader moves to `window` capture and reads `defaultPrevented` after dispatch (`setTimeout(0)`), still after every listener; P3.7 asserts it returns `true`; P4.3 adds `popup-escape-layered`. Logged in Ask 2 |
| 4 | codex | major | P1's gate cannot pass: the non-vacuous scan's count assertion runs before any `<DottedTerm>` exists | Confirmed. The scan moves to `DottedTerm.scan.test.ts` in P2; the count assertion stays |
| 5 | codex, fable | major/minor | Browser guarantees without a test that can fail: wrapping, vertical bounds, the swallowed click (nothing clickable may sit under the bubble), the Tab order | Confirmed. P3.7 (the smoke spec) adds: a 200-character unbroken string set into `tooltip-text` (new testid), width ≤ 272 and no horizontal overflow; vertical bounds; `coveredAt` on a named covered element returns `tooltip-bubble` and the recorded click target is the bubble; `tabAround` shows `gas-label-public` then `gas-label-private` |
| 6 | codex | major | jsdom has no layout, so "renders `inline-flex`" and "stays inline" are class checks | Confirmed. Renamed to class checks; the in-sentence layout is measured in the browser in batch 5, where the first in-sentence term ships (noted in P2.1). No surface in this batch puts a term inside a sentence, so no browser measurement is possible here |
| 7 | codex | minor | Chrome's accessibility tree and Firefox's DOM do not prove an announcement | Qualified in Dotted term § Screen reader |
| 8 | fable | minor | The Alias shot draws the bubble centred and clamped; the plan kept `start` and misdescribed today as centred | Confirmed (`02-tooltip.html:71`, `AccountSelectRow.vue:82`, today placed at the trigger's left). Ask U-6, built as drawn (`center`); P4.1's sentence corrected; UI impact row 8 |
| 9 | codex, fable | minor | The Escape inventory omits `PasskeyCeremonyDialog.vue:50`, and "nothing in a dApp window acts on Escape" is false (the execute window's fee menu) | Confirmed. Inventory and Security corrected; "Escape never approves or rejects a dApp request" kept as the claim that holds |
| 10 | fable | minor | Enter/Space closing a dotted term is a state the mock does not draw, and Space would scroll | Confirmed (`page.js:526-527`). A press counts only on a `button`, `a` or `[role="button"]` inside the trigger; Space is prevented only when handled; P2.1 tests click-shows and Enter-keeps-open on a term |
| 11 | fable | minor | `<Text>` always emits `lh--100`, which fights a local line-height | Confirmed (`Text.vue:17-21`). U9's note and U8's line are plain spans with the mock's declarations local |
| 12 | fable | minor | The artifact's live bubble rises 2px on entry (0.12s ease-out) and is removed at once; the primitive only fades, in and out | Confirmed (`nulo.css:467-468`, `page.js:487`, `Tooltip.vue:240-250`). Ask U-7, built as drawn through the independent `translate` property |
| 13 | fable | minor | The glossary separator uses the dark `--hairline-soft` in both themes; the mock's light value is `rgba(124, 116, 104, 0.2)` | Confirmed (`nulo.css:30`, `:71`); matches the 10 files that already ship the dark literal. Listed as a parity difference in P4.1 |
| 14 | codex | minor | Touched comments missed: `Tooltip.test.ts:115-118`'s narration; the `.hint_row` comment should go, not be rewritten | Confirmed; both removed. The focus comment states the latch's invariant; the `viewport` bullet's scrollbar sentence is gone (Ask 7) |
| 15 | codex | minor | "Only long error text" can exceed the window is false for short windows; "33 to 35" counts call sites | Both qualified (U-5, Tooltip count); no implementation change |
| 16 | codex | info | `spec.md:277` says U9 goes "under the field"; the drawing puts it between the label and the field | Built as drawn; listed for the owner under the asks (the spec is not edited here) |
| 17 | fable | info | P1.3 must mock only `@/utils/core`, keep the real focus-trap, and click a `<button>` trigger | Adopted in P1.3 |
| 18 | fable | info | The mock never flips `start`-mode tips | Noted in the helper bullet; the spec's flip rule governs |
| 19 | driver | major | Found while making row 5's click test fail-able: with the term focused, a press on the bubble blurs it, `focusout` closes the bubble before the click, and the click lands on what it covered, against the Security claim | `@mousedown.prevent` on the bubble; P1.2 asserts it; P3.7 clicks with the bubble opened by focus and by hover |

#### Round 3

Both legs read the round-2 revision and its ledger.

- `/codex high` (GPT-6 Astra, session `01a0d4c5-8dd8-7083-bc09-026f3790c07b`): **conditional
  approve, confidence high**. Its round-2 conditions 1, 2, 4 and 5 met, 3 partly. Conditions:
  its findings 1 and 2.
- Fable (same-family leg): **conditional approve, confidence high**. Every round-2 condition
  met, C3's precondition unverified. Conditions: its findings 1-3.

Each finding was checked against the code before it was applied.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | Space is `preventDefault`ed when a press is handled, which suppresses a native button's click; `auth-reset` acts only in `@click` (`auth.vue:308`) | Confirmed. The press cancels no key's default; P1.2 asserts neither `keydown` is prevented; P3.7's third test presses Space on `auth-reset` in the browser: exactly one forgot-password popup, the bubble gone, the first Esc closes the popup, focus back on the button |
| 2 | codex | major | `coveredAt` returns the direct hit, so a hit on the bubble's text reads `SPAN` or `tooltip-text`; the covered balance span has no action, so an unchanged route proves nothing | Confirmed (Fact 15). Hits and click targets count by `closest('[data-testid="tooltip-bubble"]')`. **Mechanism changed**: no production control reliably sits under the bubble, and a real one's action (navigation) would change the page under test. Instead the same point P is clicked with the bubble closed (the window-capture recorder sees a target outside any bubble, so the point is live page) and then open by focus and by hover (the target is inside the bubble). Since the bubble is teleported under `#tooltip`, a target inside it has nothing it covers on its propagation path |
| 3 | codex | major | Condition 3's remainder: no browser check of a tall bubble while placement is measured | Confirmed. P3.7 shrinks the viewport to the bubble's height + 4 and reopens by focus: top 8, bottom past the window (U-5, as built; its sign-off stays pending) |
| 4 | fable | major | P3.7 probes `gas-balance-private` and P4.1 captures Home in the smoke suite, which has no node: the card keeps its skeletons (or settles to "—" after 20s) | Confirmed (Fact 14; recon corrected). The tooltip test touches only the labels and the bubble, which render in every state, and no longer names a covered balance (row 2); the smoke card's observed state goes into `lessons/phase-3.md`. The Home parity capture moves to the network suite on the `feeJuiceImported` wallet |
| 5 | fable | minor | Esc sets the latch, so after Esc with the pointer on the bubble the first re-hover is dead | Confirmed. Esc no longer sets the latch. The proposed "clear on `mouseenter`" is **rejected**: a touch tap fires a compatibility `mouseenter` between `pointerdown` and focus, which would clear the latch just before the focus it blocks. The latch clears on a mouse `pointerenter` instead, which also revives the first hover after a keyboard press, and never on `touchend` (found while checking the tap sequence: today it shares the leave handler). P1.2 gains the Esc-on-bubble, keyboard-press and touch cases |
| 6 | fable | minor | Press-to-close is visible and neither the spec nor the mock defines it | Confirmed (`spec.md:42-43`, `02-tooltip.html:80`, `page.js:479-531`). Owner ask U-8, built as recommended, sign-off pending, in the PR's pending list and UI impact row 1 |
| 7 | fable | info | The bubble's cap is 272 here and 270 in the mock | Confirmed (`page.js:392`, `nulo.css:180`); kept at the spec's 272 and listed as a parity difference in P4.1 |
| 8 | fable | info | P1.3's second Esc needs the harness to close the popup on `onClose` and flush focus-trap's return timer | Adopted in P1.3 |
| 9 | fable | info | Comments: `pressEscape`'s new sentence replaces its second one; the latch sentence names arrival and departure, not events | Adopted in P3.6 and the Comments list |

#### Round 4

Both legs read the round-3 revision and its ledger. The stack had been rebased onto dev
`9f11de70`; every file:line this plan cites was re-read against the rebased worktree.

- `/codex high` (GPT-6 Astra, session `01a0d4c5-8dd8-7083-bc09-026f3790c07b`): **approve,
  confidence high**. Every round-3 condition met; no new finding, so no codex condition is open.
- Fable (same-family leg): **conditional approve, confidence high**. Every round-3 condition
  met. Conditions: its findings 1-3.

Each finding was checked against the code before it was applied.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | fable | minor | The arrival rule (`pointerType === "mouse"`) leaves a pen's first hover after a keyboard press dead, the case the rule exists for | Confirmed: a pen's `pointerenter` and compatibility `mouseenter` both precede its `pointerdown`, so it cannot clear the latch mid-press. The rule is `pointerType !== "touch"` in the Latch bullet, the Comments list and Ask 2; P1.2 runs the arrival case for `mouse` and `pen` |
| 2 | fable | minor | P3.7's rect assertions can read the bubble before `nextTick` places it (`Tooltip.vue:55-59`) or during the 2px, 0.12s rise | Confirmed. **Amended**: polling each assertion until it holds, as proposed, could pass on a rising frame (a top that settles wrong passes 8 on the way). Every rect read first waits, bounded, for computed `opacity` `"1"` and an empty `getAnimations()`, then reads once |
| 3 | fable | minor | The new bubbles' `<Text color="secondary">` is `--txt-secondary`, the mock's `--nulo-secondary` only in dark; light is `rgba(0, 0, 0, 60%)` against `#6b655c` | Confirmed (`utilities.css:141-143`; `base.css:99`, `:102`, `:145`, `:154`). `base.css` already defines `--nulo-secondary` for both themes, so the drawn value is built: the dotted term's and the icon labels' content is a plain span with `line-height: 1.2` and `--nulo-secondary` local (12px/600 come from `.text`). U-4 now gives both themes' figures (drawn: 3.98:1 dark, 4.09:1 light; `color="secondary"` in light: 5.14:1) and the alternative; Fact 3 and recon corrected |
| 4 | fable | info | The press rule sees `button`, `a`, `[role="button"]`; ~20 triggers are `<Icon @click>` or `<div @click>` | Confirmed (`accounts/index.vue:150`, `settings/tokens/index.vue:95`, `senders/index.vue:132`, `FpcRow.vue:71`). Not focusable, so no `focusin` follows a press, and a popup's full-window overlay (`Popup.vue:115-121`) comes under the pointer, whose leave closes the tooltip. One sentence in U-8; no build change |
| 5 | fable | info | `02-tooltip.html` is `design/mocks/src/parts/02-tooltip.html` | Paths corrected in UI impact row 8, U-6 and U-8; the lines were right |
| 6 | driver | info | Base drift: `apps/tools` and `packages/bridge-core` left the repo with #691, yet the scope's out list named them | The out list now says they left; no cited line in the files the rebase touched (the design package's comments) moved |

#### Round 5

Both legs read the round-4 revision and its ledger; every file:line the revision newly cites was
re-read against the rebased worktree (dev `9f11de70`).

- `/codex high` (GPT-6 Astra, session `01a0d4c5-8dd8-7083-bc09-026f3790c07b`): **approve,
  confidence high**. Its earlier conditions and the same-family leg's round-4 conditions met; no
  new finding.
- Fable (same-family leg): **conditional approve, confidence high**. Every round-4 condition met.
  Conditions: its findings 1-3.

Each finding was checked against the code before it was applied.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | fable | minor | The `line-height: 1.2` on the two new inline content spans is dead: `.text` and `body` set no line-height, so the block's strut is InterVariable's `normal` (~1.21) and an inline child cannot go below it | Confirmed (`Tooltip.vue:227-233`, `base.css:284-292`; the teleport target `#tooltip`, `popup/app.vue:408`, sets none either). The spans take `display: block`, which is also what the mock draws (`.n-tip-text` is a `div`, `design/mocks/src/parts/02-tooltip.html:71`), so the drawn 1.2 holds; the Dotted term and Balance split bullets say so. Round 4's row 3 is left as recorded |
| 2 | fable | minor | P3.7 step 4 clicks a P measured before the reload; the smoke Home can settle between loads and move the bubble | Confirmed (Fact 14). Step 4 re-measures P from the bubble's settled rect after the hover opens it |
| 3 | fable | minor | The 8px gap's location is unstated; the 12px lives in `import-shared.module.css:4`, which `ImportFullBackupForm.vue` also composes | Confirmed (`ImportSecretForm.vue:128-130`, `ImportFullBackupForm.vue:157-158`; both forms mount on both import pages). The change is local to `ImportSecretForm.vue`'s `.section`. **Mechanism amended**: the proposed override after the `composes` relies on bundle order, because Vite prepends a copy of the composed file into every composing module (`vite/dist/node/chunks/build.js:5456-5457`), so the backup form's copy can follow the override at equal specificity. That `.section` stops composing and declares the four values locally with `gap: 8px`, one comment saying why |
| 4 | fable | info | The tall case's 33px viewport may be clamped by Firefox's BiDi `setViewport` | Adopted: `innerHeight` is read after the resize, a precondition asserts it is below the bubble's height + 16 (so a clamp fails loudly), and the bottom is checked against the read value; each browser's minimum goes into `lessons/phase-3.md` |
| 5 | driver | info | Fact 11 and recon cite `pointer-probes.ts:70-88`; the doc comment starts at `:68` and the function at `:71` | Corrected to `:68-88` in the plan and recon |

#### Round 6

Both legs read the round-5 revision and its ledger.

- `/codex high` (GPT-6 Astra, session `01a0d4c5-8dd8-7083-bc09-026f3790c07b`): **approve,
  confidence high**.
- Fable (same-family leg): **approve, confidence high**, on the round-5 conditions as applied.

Results by round (codex / fable): 1 conditional approve / conditional approve; 2 conditional
approve / conditional approve; 3 conditional approve / conditional approve; 4 approve /
conditional approve; 5 approve / conditional approve; 6 approve / approve, all at confidence
high. The audit closed at round 6.

## Approval

Recorded under the program's standing approval (implementations-plan/ux-feedback/plan.md
§ Standing approval), 2026-09-24.

1. **Met.** Phase 0 is the program's pre-answers (§ Phase 0 above, recorded from the program's
   "Phase 0, answered for every batch"; no clarifying questions were asked).
2. **Met.** Codex's final verdict, round 6, session `01a0d4c5-8dd8-7083-bc09-026f3790c07b`:
   "VERDICT: approve — confidence: high". Its path went through conditional approves in rounds
   1-3; each round's conditions were applied and confirmed by the resumed pass that followed
   (round 4: "every round-3 condition met"), and it approved in rounds 4, 5 and 6.
3. **Met.** Fable's final verdict, round 6: "approve (high)". Its round-5 conditional approve
   (findings 1-3) was applied and confirmed by the round-6 pass.
4. **Met.** No Ask is open: the eight technical Asks are decided with codex and logged
   (§ Asks → codex); the UI asks U-1 to U-8, the Settings row, U8, U9 and the U9 spec wording
   are listed as **sign-off pending** for the PR (§ UI asks for the owner, § Delivery).
5. **Met.** UI impact lists only spec surfaces (item 2, item 9, the tooltip map), round-5
   surfaces built as drawn with no pick (U8, U9) and sign-off-pending items (rows 1, 3, 4, 6, 7,
   8).
6. **Met.** Nothing outside the batch's scope: items 2 and 9 and the batch's part of the tooltip
   map; the permission window's dotted terms and the Alias ⓘ removal stay in batch 5, and the
   Phase 0 out list holds.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/ux-feedback/b3-tooltips-glossary/lessons/phase-N.md`.

### P1 · The tooltip primitive and the glossary module ✓

1. `tooltip-placement.ts` + `tooltip-placement.test.ts` (table tests):
   - flip at the bottom edge and at the top;
   - no flip when neither side fits (clamped instead);
   - clamp at the left and right edges, for `center`, `start` and `end`;
   - a bubble taller than the window takes the top inset;
   - negative trigger coordinates;
   - the invalid-position fallback.
2. `Tooltip.vue` + `Tooltip.test.ts`:
   - `enableAutoUnmount(afterEach)`, so no test leaks a listener.
   - The 12 geometry cases stay, with the 6px gap.
   - New component cases with a mocked `innerWidth`/`innerHeight` force a flip, a right-edge
     shift and a left-edge shift through the real component, so the helper is proven wired.
   - The invalid-position pin moves to x = 8, with the reason.
   - Leaving the trigger keeps it open 150ms; entering the bubble or the trigger again keeps it
     open; leaving the bubble closes it after 150ms; `focusout` closes it at once.
   - Hover with a delay → leave before it fires: it never opens.
   - Hover → leave → focus → all timers advanced: it stays open.
   - Hover → focus → Esc → all timers advanced: it stays closed.
   - Esc closes it, calls `preventDefault`, and a spy on a `document` bubble-phase listener never
     sees the event.
   - A press on a `<button>` in the trigger (`pointerdown`, Enter, Space) closes it and cancels a
     pending open, and neither key's `keydown` is default-prevented. `pointerdown` then `focusin`
     stays closed until `focusout`, and a later `focusin` opens it.
   - Latch clearing: after an Enter press, a `pointerenter` then `mouseenter` opens it after the
     delay, once with `pointerType: "mouse"` and once with `"pen"`; after a `pointerdown` with `pointerType: "touch"`, a `touchend`,
     a `mouseenter`, then `focusin` stays closed.
   - Hover → `mouseleave` → `mouseenter` on the bubble → Esc → `mouseenter` on the trigger: it
     opens after the delay (Esc sets no latch).
   - A `pointerdown` on a plain focusable `span` does not dismiss, and Space on it is not
     prevented.
   - Unmount while an open is pending, while a close is pending, and while open: no timer fires,
     and no listener remains.
   - `role="tooltip"`, the `tooltip-bubble` and `tooltip-text` testids; a `mousedown` on the
     bubble is default-prevented.
   - `inline` applies the inline class (a class check: jsdom has no layout).
   - A long unbroken string and a tall text render (width, wrapping and the tall bubble's top
     inset are measured in P3.7).
3. Popup integration, `apps/extension/src/components/Popup/Popup.tooltip.test.ts`, with the real
   `Popup`, the real focus-trap and `Tooltip`; only `@/utils/core` is mocked (`Popup.vue:47`
   calls `managers.profile?.refreshSession()`), unlike `Popup.test.ts:16-33`:
   - a tooltip open inside an open popup closes on the first Esc while the popup stays, and the
     second Esc closes the popup and returns focus to its opener (the harness sets `show` false
     on `onClose`, since `Popup` only emits it, `Popup.vue:35-39`, and flushes timers, since
     focus-trap returns focus on a timeout);
   - popup from trigger: a `<button>` inside a tooltip's trigger gets `pointerdown`, `focusin`,
     then the click that opens the popup; the first Esc closes the popup and focus is on the
     button.
4. `Tooltip.stories.ts`: a trigger at the right edge, one at the bottom, and an inline term in a
   sentence.
5. `glossary.ts` + `glossary.test.ts` (above; the scan comes in P2).

Gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.

### P2 · The dotted term, the fee labels and the balance split ✓

1. `DottedTerm.vue` + `DottedTerm.test.ts`, with `Tooltip` and `Text` registered through
   `global.components`; the L3 minimum of 10:
   - renders the slot, not the entry's term;
   - the definition comes from the key;
   - an unknown key warns;
   - `tabindex="0"`;
   - `aria-describedby` names a `hidden` span that holds the definition;
   - focus opens with no delay and hover waits 300ms;
   - a click on the term (`pointerdown`, then focus) shows the definition, and Enter leaves it
     open, as the mock does;
   - `position` passes through;
   - the bubble text is left-aligned;
   - the testid lands on the span;
   - two instances get distinct ids;
   - the Tooltip gets `inline` (a class check; the in-sentence layout is measured in the browser
     by batch 5, which ships the first term inside a sentence).
2. `GasBalanceCard.vue` + its test: two dotted terms with the fee keys and testids.
   `DottedTerm.scan.test.ts` (Glossary § scan) lands here, with its first occurrences.
3. `BalanceView.vue` + its test, with a wire-shaped `tokenBalance`:
   - the icon labels' text and each `<Icon>`'s `aria-label`;
   - no `aria-label` on the group spans;
   - no split and no label without `tokenBalance`.
4. Consumer suites that stub `Tooltip` keep passing; `BalanceView.test.ts` and
   `GasBalanceCard.test.ts` gain `Tooltip`/`DottedTerm` stubs.

Gate: lint, `typecheck:all`, `test:all` exit 0.

### P3 · Glossary page, Settings row, rule-6 texts, CLAUDE.md, the smoke spec ✓

1. `glossary.vue` + a component test: four sections in order and nine entries with the exact
   strings (strings are asserted here, not in e2e).
2. The Settings row and the `subpage-back` testid.
3. `DappIdentityBlock.vue`:
   - Its two `[data-tooltip]` tests are rewritten, per the spec, to assert the visible line (text,
     icon, testid, `aria-hidden` icon) for a wire-shaped host (`xn--tls-seda.nulo.sh`).
   - A safe host renders no line.
   - The logo alignment follows the state.
4. `ImportSecretForm.vue` + its test: the note is visible without hover, and there is no ⓘ.
   `AccountSelectRow.vue`'s Alias tooltip takes `position="center"` (U-6).
5. CLAUDE.md section.
6. `pressEscape` (`tests/e2e/helpers/pointer-probes.ts`): the reader moves to a `window`
   capture listener that reads `defaultPrevented` in a `setTimeout(0)` after the dispatch, so a
   listener that stops propagation cannot starve it and it still sees every listener's mark. That
   sentence replaces the doc comment's second one (`pointer-probes.ts:69-70`, the bubble-listener
   reason); the first stays.
7. Smoke e2e (new, both browsers), `tests/e2e/tooltips-glossary.test.ts`, three tests:
   - **Glossary**: Settings → Glossary through `setting-nav-glossary`; the nine
     `glossary-entry-<key>` testids appear in `GLOSSARY_SECTIONS` order; `subpage-back`
     returns to Settings.
   - **Tooltip, in the real 360×600 popup page, where jsdom has no layout**. It touches only the
     two labels and the bubble, which render whatever the gas card's state (Fact 14); nothing
     waits on or probes a balance. The observed smoke state of the card is recorded in
     `lessons/phase-3.md`.
     - Every read of the bubble's rect (bounds, width, P, the tall case) first waits, with a
       bounded `page.waitForFunction`, until the bubble's computed `opacity` is `"1"` and its
       `getAnimations()` is empty, then reads once. Placement lands on `nextTick`
       (`Tooltip.vue:55-59`) and the rise moves the bubble 2px over 0.12s, so an early read sees
       it unplaced or up to 2px high; a poll on the assertion itself could pass on a rising
       frame.
     - `tabAround` from the page start: `gas-label-public` then `gas-label-private` appear as
       consecutive stops.
     - With `gas-label-private` focused, `tooltip-bubble`'s rect lies within [8, width − 8] and
       [8, height − 8], its width is at most 272, and its text is the definition. On Chrome, the
       accessibility tree gives the focused term that description; on Firefox, the
       `aria-describedby` target holds it.
     - Hover the term, move the real pointer in steps onto the bubble, and it stays open.
     - The swallowed click, at the point P = the bubble's centre, measured while it is open by
       focus. A hit counts as the bubble's when `elementFromPoint(P)` (or a click's target) has
       `closest('[data-testid="tooltip-bubble"]')` (Fact 15: `coveredAt` would read the text
       span). A `window` capture click recorder notes each click's target and whether it is
       inside the bubble, then stops that click (`stopImmediatePropagation()`,
       `preventDefault()`), so nothing under P acts on it. It leaves `mousedown` alone, since the
       bubble's `@mousedown.prevent` is part of what is tested.
       1. Open: `elementFromPoint(P)` is inside the bubble.
       2. Esc, then a real click at P with the bubble closed: the recorded target is outside
          any bubble, so the point is live page (its testid or tag goes into the lessons log).
       3. Focus `gas-label-private` again (`page.focus`), click P: the target is inside the
          bubble and the bubble is still open (`@mousedown.prevent` kept the focus).
       4. Reload, hover the term until it opens, re-measure P as the centre of the bubble's
          settled rect (the smoke Home can settle between loads, Fact 14, and move the label),
          click P: the same.
       The hash never changes.
     - `pressEscape` returns `true` and the bubble is gone.
     - Tall bubble (U-5): with the term unfocused, set the viewport to 360 × (the bubble's
       measured height + 4), shorter than the bubble plus both 8px insets, then read
       `innerHeight` back (whether Firefox's BiDi `setViewport` honours so small a height is
       unverified). The test first asserts `innerHeight` < the bubble's height + 16, so a clamped
       window fails loudly instead of passing a case that is not tall; the minimum each browser
       gives goes into `lessons/phase-3.md`. Focus `gas-label-private`: the bubble's top is 8 and
       its bottom (8 + its height) exceeds the read `innerHeight`. Blur it and set the viewport
       back to 360×600.
     - Last, reopened by focusing the term, a 200-character unbroken string set into
       `tooltip-text`: the bubble's width stays at most 272 and `tooltip-text`'s `scrollWidth`
       does not exceed its `clientWidth` (placement is not recomputed for injected text, so
       bounds are not re-read).
   - **Press inside a trigger (U-8)**, on the locked auth page (`lockWallet`, then a fresh
     popup): focus `auth-reset` (its tooltip opens), press Space. `forgot-reset-btn` appears once
     (the button's click ran, exactly one popup) and `tooltip-bubble` is gone. `pressEscape`
     returns `true`, the forgot-password popup closes, focus lands back on `auth-reset`
     (`waitForFocus`) and the tooltip stays closed.

Gate: lint, `typecheck:all`, `test:all`, the smoke file and `passkey-backup.test.ts` (the other
`pressEscape` user) on Chrome and Firefox, exit 0.

### P4 · Parity and arc gate ☐

1. Parity: rebuild the mocks and render the batch's shots.
   - Capture each surface at the mock's size:
     - Home with Private Fee Juice focused (item 2's evidence: the clamp fires at the right
       edge), taken in the network suite on the `feeJuiceImported` wallet once both balances
       show (`fixtures/extension.ts:958-970`), since the smoke Home keeps its skeletons where
       the shot has amounts (Fact 14);
     - a token page with the padlock hovered (the token-seed smoke build);
     - Settings → App;
     - the Glossary page from its top, as the shot is;
     - the import page;
     - the capabilities window's Alias tooltip (network), built centred and clamped as drawn
       (U-6; today it is `position="start"`, placed at the ⓘ's left edge);
     - a suspicious host in the real discover window, from an `xn--tls-seda.localhost` origin
       (Chrome resolves `*.localhost` to loopback). Only if the playground cannot serve it, a new
       `DappIdentityBlock.stories.ts` at 400px, recorded as an exception to the parity gate.
   - Publish one private Artifact placing each capture beside its shot. The driver and the fable
     leg list every difference, including the pre-existing ones: Home's hero, the sub-page
     header, the label size, and the glossary separator in the light theme (the dark
     `--hairline-soft` literal, `nulo.css:30`, where the mock's light value is
     `rgba(124, 116, 104, 0.2)`, `nulo.css:71`); and the bubble's cap, 272px here against the
     mock's 270 (its text cap is `min(272, root − 16) − 24`, `page.js:392`, inside 10px + 1px
     sides, `nulo.css:180`), both within the spec's "at most 272px" (`spec.md:40`).
2. Every row of the program's [Local gates](../plan.md#local-gates): lint, `typecheck:all`,
   `test:all`, `test:ci-gating`, `build`, Storybook; full smoke on Chrome and on Firefox.
3. Network e2e on Chrome and on Firefox, `NULO_E2E_RETRY=0`, over specs that together open all
   four dApp windows: `connect-dapp` (discover and the emoji check), `cap-request-basic`
   (permissions), `tx-sendTx-selfPay` (execute). The list is checked against their
   `waitForPopup(` targets and recorded in `lessons/phase-4.md`. Plus
   `network/popup-escape-layered`, the network `pressEscape` user.
4. Flake bar: `tooltips-glossary.test.ts`, three consecutive retry-0 runs on each browser.
5. `bun run e2e:reap`.

Gate: all of the above exit 0 and the parity Artifact URL printed.

## Arc boundary

1. The codex fix loop (below) until a round has nothing material, three rounds at most.
2. Parity evidence re-captured if the loop changed a surface.
3. `gh stack push`, then `gh stack add feat/ux-4-snackbar-rows-arrivals`.

## Post-implementation (read by the implementing session)

The review loop is `/codex high` (GPT-6 Astra) on the arc diff (`feat/ux-2-window-placement`
...HEAD), resumed until a round reports nothing material, three rounds at most; `/code-review` is
off. Every codex prompt, initial and resumed, carries:

- *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
  extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
  problem. If code works and is clear, leave it alone."*
- *"Audit the comments for value per character. Flag any comment that narrates what the code
  visibly does, restates its line, references implementation plans / phases / reviews, or spends
  a paragraph where a sentence works — and flag places where a non-obvious invariant or
  constraint deserves a comment it doesn't have. Comments are permanent context every future
  reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
- The arc map: "this is arc 3 of 6; arcs 1 (first run and wording) and 2 (window placement) are
  below it, and later arcs build the snackbar, rows and arrivals, and the permission window on
  top of it (batch 5 reuses the dotted term and adds two keys)", so seams reserved for later
  arcs are not flagged as dead code.
- The adversarial ask and the parity rule: "flag any UI that differs from the spec or invents a
  state it does not draw".

Each finding is fixed in its own commit or rejected with a reason in `lessons/phase-4.md`. Codex
is advisory: it cannot override the spec, the owner's picks, CLAUDE.md or this scope.

## Delivery

- Arc 3 of 6 on `feat/ux-3-tooltips-glossary`, stacked on `feat/ux-2-window-placement`.
- Commits: conventional, lower-case, signed; one per phase at least, fixes separate.
- `gh stack push` as checkpoints; no PR until the program's final pass (program Delivery).
- PR body (at submit): summary, the UI impact table, the owner's quotes (i2, i9, i9b, i9c, tips),
  the **sign-off pending** list (U-1 to U-8, the Settings row, U8, U9, the U9 spec wording), the parity Artifact
  link, test evidence.

## Seeds

The program's `/goal` drives this batch. To resume this batch alone:

```
/goal Deliver implementations-plan/ux-feedback/b3-tooltips-glossary/plan.md. Done when the transcript shows every phase ✓ with its gate reported passing and LESSONS_FILE printed per phase, a quoted codex re-review with no new material findings, the parity Artifact URL, and gh stack view with feat/ux-4-snackbar-rows-arrivals on top. Never merge; UI questions the spec does not answer go to the owner.
```

```
/loop 15m Drive implementations-plan/ux-feedback/b3-tooltips-glossary/plan.md forward: read it and its lessons, git status, gh stack view; take the next unchecked step; run its gate; commit; on a decision use the spec, else /codex high for technical asks; hard limits stay hard.
```
