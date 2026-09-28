# Batch 3 recon · tooltips and glossary

Two read-only agents (Explore, sonnet), 2026-09-24, against the arc's base: batch 2's tip on top of
`feat/ux-1-first-run-wording` (`46a0ed32`; batch 2 touches no file below). One reuse sweep, one
mapper of the tooltip subsystem. The driver's own reads are in the last section.

## Reuse map

| Capability | Existing | Verdict |
|---|---|---|
| Viewport-aware placement | `Tooltip.vue:55-117` (measures once on open, `translate3d`, no clamp, no flip); `Popover.vue:60-88` (same, no clamp); `DropdownRoot.vue:183-215` (flips on `innerHeight`, app layer, not importable). No `floating-ui`, `popper` or `vueuse` in any `package.json`; no clamp helper (searched `clamp`, `viewport`, `innerWidth`, `innerHeight` in `packages/design/src`, `apps/extension/src/utils`: only `clampDecimals`, unrelated) | adapt `Tooltip.vue` in place; the geometry moves to a pure colocated helper, with the trigger gap at the mock's 6px (`page.js:398`; today 8) |
| Width cap | `.text { max-width: calc(var(--base-width) - 40px) }` = 320px (`Tooltip.vue:228`, `--base-width: 360px` in `base.css`); `maxWidth` prop, one caller (`auth.vue:307`, 220px) | adapt: the bubble caps at `min(272px, 100vw - 16px)`; `maxWidth` keeps its meaning |
| Esc, pointer onto the bubble | none: no `keydown` in `Tooltip.vue`; `mouseleave` hides at once and the bubble has no pointer handlers, so the teleported bubble can never be reached (`:134-140`, `:178-194`); the bubble has no `role` and no testid (`:178-184`) | build new, inside `Tooltip.vue`; the bubble gains `role="tooltip"` and `data-testid="tooltip-bubble"` |
| Escape ordering with popups | `Popup.vue:35-64`: focus-trap's `escapeDeactivates`. focus-trap 8.2.2 listens for Escape on `document` in the bubble phase (`focus-trap.esm.js:886`); only its focus, pointer and Tab listeners capture (`:869-885`). `DropdownRoot.vue:224-229` closes its menu and marks Escape handled (listener on `document`, `:122`), and its own trap keeps the default `escapeDeactivates: true` (`:161-164`), which deactivates on any Escape without reading `defaultPrevented` (`focus-trap.esm.js:813-817`); `Popover.vue:57` closes without marking it (listener on `document`, `:77`); `PasskeyCeremonyDialog.vue:50-57` cancels the ceremony on a `window` bubble listener. dApp windows have two of these: the execute window's fee-method menu (`OperationCard.vue:298` → `FeeSettingsCard.vue:750`) and the passkey window's dialog. The e2e probe `pressEscape` reads `defaultPrevented` from a `window` bubble listener (`tests/e2e/helpers/pointer-probes.ts:68-88`) | reuse the convention (`preventDefault()`, plus `stopPropagation()`); a tooltip listens on `window` in capture, so it answers before an enclosing popup's trap, a menu, a popover or a ceremony dialog; the probe then reads the flag after dispatch |
| Definitions module | absent (searched "glossary" repo-wide, `utils/glossary.ts`, i18n). Shape precedent: `capability-meta.ts:49-89` `CAPABILITY_LABELS: Record<string, CapabilityInfo>` + `capability-meta.test.ts:46-54`. Scan-test precedent: `services/legal/call-sites.test.ts`, `scripts/e2e/unresolved-names.test.ts` | build new `apps/extension/src/utils/glossary.ts` (the spec's path) |
| Dotted term | absent in production (searched `<abbr>`, `dotted`, `DottedTerm`, `n-term`). The mock defines it: `mocks/src/nulo.css:422-423`, `:462-466`; live behavior `mocks/src/page.js:479-529` | build new L3 composite wrapping `Tooltip` (the glossary lives in the app, so it cannot sit in `@nulo/design`) with `textAlign="left"` and a new `inline` prop: `Tooltip`'s wrapper and trigger are `display: flex` (`Tooltip.vue:201-209`), and batch 5 puts a term inside a sentence |
| Settings page | `SettingsPageShell.vue`, `SubPageHeader.vue`, `ItemsContainer.vue` (its `.title` is the mock's `n-setsec-t`, same values), `SettingItem.vue`; `proving.vue` is the page template. The header's back button (`SubPageHeaderBase.vue:36`) has no testid | reuse the shell; the section titles take `.title`'s values; the entries are new page markup (the shot draws no icon, chevron or surface); `SubPageHeaderBase` gains `data-testid="subpage-back"` (additive) so the e2e can press the real control |
| Home fee labels | `GasBalanceCard.vue:160,169` plain `<span class="label">`; testids on the amounts, not the labels | adapt |
| Balance split | `BalanceView.vue:291-301`: `aria-label="Private balance"` / `"Public balance"` on generic spans (a name ARIA prohibits on role `generic`, so screen readers ignore it). The split renders only with `tokenBalance` (`:49`, `:291`), which only the token page passes (`tokens/[id].vue:271`); Home passes none (`general.vue:51`) | adapt on the token page (owner ask U-1): left-aligned label tooltips; the `aria-label` moves onto each `<Icon>`, already `<svg role="img">` with attribute fallthrough (`Icon.vue:56-63`), so no wrapper is needed |
| Rule-6 texts | `DappIdentityBlock.vue:47-54` (four windows mount it: discover, capabilities, execute, verify); `ImportSecretForm.vue:33-38` (onboarding and popup import) | adapt: visible text |
| CLAUDE.md rule | drafted verbatim in the shot `09-claude-md-rule` | build new section (transcription) |
| Stories, tests | `Tooltip.stories.ts` (the extension's Storybook globs `src/components/**`, `src/design/**` and the design package's stories, `apps/extension/.storybook/main.ts:23-27`, so the Storybook build covers it); `Tooltip.test.ts` (12 pinned geometry cases, jsdom 1024×768, `getBoundingClientRect` patched); consumer tests stub `Tooltip` (30 files) | adapt; the 12 cases stay (every result is inside the jsdom viewport, so the clamp leaves them in place), but their trigger-gap coordinate moves from 8 to 6, and the invalid-position pin moves from x = 0 to the 8px inset |

## Tooltip subsystem

- **Props** (`Tooltip.vue:9-38`): `side` (default `bottom`), `position` (`center`), `textAlign`,
  `wide`, `disabled`, `delay` (0; `Number.parseInt` for strings), `maxWidth`, `teleportTo`
  (`#tooltip`). Slots `default`, `content`. Emits nothing. `@click.stop` on the bubble.
- **Open and close**: `mouseenter`/`touchstart` open, after `delay` if set; `focusin` opens at
  once; `mouseleave`/`touchend`/`focusout` close at once. No Esc handler, no scroll or resize
  listener, no `role`, no `aria-describedby`, no unmount cleanup of a pending delay.
- **Placement**: one `nextTick` after opening, from the trigger's and bubble's rects; gap 8px;
  `crossAxisOffset` shared by both axes; an invalid `position` falls back to 0, pinned by
  `Tooltip.test.ts:163-170`.
- **Usages**: 33 `<Tooltip>` in `apps/extension/src` across 24 files, plus `Input.vue:261` in
  `@nulo/design`. Seven are `side="top"`; the other 26 and `Input.vue:261` take the default
  `bottom`. None is `left` or `right`: the `side="left"` at `LogsToolbar.vue:41` is a `Popover`'s.
  About 20 triggers are bare `<Icon>` SVGs with no `tabindex`, so keyboard focus cannot reach
  them. That predates this batch and is outside item 2.
- **Content styling**: 9 of the 33 wrap their text in `<Text color="secondary">`. Seven do it at
  `size="12"` (`ProcessingErrorNote.vue:29`, `DappApprovalFooter.vue:37`,
  `DappIdentityBlock.vue:50`, `security/index.vue:176`, `NewSenderPopup.vue:144`,
  `RevokeAuthwitsPopup.vue:210`, `AccountSelectRow.vue:85`); two only for a prefix label
  (`TokenMetadataPopup.vue:133`, `tokens/[id].vue:221`). The other 24 pass bare text, which
  falls back to `.text`'s `--txt-primary` (`Tooltip.vue:232`). The mocks draw every bubble's text
  as `.n-tip-text`: `--nulo-secondary`, 12px, 600, line-height 1.2 (`mocks/src/nulo.css:181`),
  left-aligned (no tip rule sets `text-align`, so it inherits the `.nulo` root's `left`,
  `nulo.css:46`). `Tooltip`'s `textAlign` defaults to `center` (`Tooltip.vue:25`).
  `<Text color="secondary">` is `--txt-secondary` (`utilities.css:141-143`), which equals the
  mock's `--nulo-secondary` only in the dark theme (`#999187`, `base.css:99`, `:102`); in light it
  is `rgba(0, 0, 0, 60%)` against `#6b655c` (`base.css:154`, `:145`). `base.css` defines
  `--nulo-secondary` for both themes, but no `<Text>` colour maps to it. The mock's
  `.n-tip-text` is a block `div` (`mocks/src/parts/02-tooltip.html:71`); `Tooltip.vue`'s `.text`
  (`:227-233`), `body` (`base.css:284-292`) and `#tooltip` (`popup/app.vue:408`) set no
  line-height, so the bubble's strut is InterVariable's `normal` (about 1.21) and an inline
  child's smaller line-height has no effect: a content span needs `display: block` for the 1.2.
- **Scroll**: every `PopupCard` shell scrolls (`PopupCard.vue:51`), and position is computed once,
  so scrolling under an open tooltip leaves it behind. That predates this batch and is not in item
  2's text.
- **Containing block**: `#tooltip` is a sibling of `#popup` under the app shell
  (`popup/app.vue:407-408`); no transformed ancestor, so `position: fixed` is the viewport. The
  shared stylesheet hides every scrollbar (`packages/design/src/base.css:250-259`), so
  `window.innerWidth`/`innerHeight` are the visible window.
- **Home's gas card in the smoke suite**: the smoke suite has no Aztec node
  (`tests/e2e/README.md:11`). The card shows `gas-skeleton-*` until the entry's `display` is
  defined (`GasBalanceCard.vue:65-66`, `:162`, `:171`); a failed or timed-out read (20s bound,
  `balances.store.ts:113`, `:506-512`) keeps `display` as it was (`:190`), and the reader awaits
  PXE-backed view deps before its legs (`gas-balance-reader.ts:161-162`). So the smoke Home most
  likely keeps its skeletons, and no smoke spec waits on `gas-balance-*` (every waiter is under
  `network/` or in the `feeJuiceImported` fixture, `fixtures/extension.ts:958-970`). The labels
  (`:161`, `:170`) render in every state.
- **`coveredAt`** (`tests/e2e/helpers/pointer-probes.ts:11-20`) returns the direct
  `elementFromPoint` hit's own testid or tag, so a hit on a tooltip's text span reads `SPAN` or
  `tooltip-text`, never `tooltip-bubble`.
- **Consumers**: every consumer test stubs `Tooltip`; e2e never hovers one. `endpoints.test.ts:84-91`
  and `network/token-management.test.ts:19-26` dispatch DOM clicks precisely to avoid hover timing.

## The mock's reference behavior (`mocks/src/page.js`)

- `placeTips` (`:378-406`): width `min(max, root − 16)` (text max-width that minus 24); below
  the trigger by 6px; flip above when it overflows the bottom and fits above; horizontal modes
  `start`, `below-end`, and default `clamp` (centered, then kept within 8px of both edges).
- `wireTerms` (`:479-529`): open 300ms after `pointerenter`, at once on focus; close 150ms after
  `pointerleave` from the term or the bubble, and entering the bubble cancels it; blur closes
  at once; Esc closes; `role="tooltip"` and `aria-describedby` while open.
- Home's Private Fee Juice bubble is `clamp` with max 272, so it is centered on the label and
  kept 8px inside the window's right edge (shot `09-home-dotted`).

## Driver's reads

- **Mocks for the other surfaces**:
  - Glossary (`mocks/src/nulo.css:498-502`): `.n-gl` padding `4px 24px 24px`. Items are
    `.n-gl-item`, a column with gap 4px, padding `12px 0` and a hairline (`--hairline-soft`)
    below. The term is 14px/600, the definition 12.5px, line-height 1.45, `--nulo-secondary`.
    The "where" line is mono 9.5px, 0.06em, uppercase, `--nulo-outline`. Section titles are
    `n-setsec-t` with padding `18px 0 2px`.
  - Shot `09-glossary` shows the page from its top, leading with Balances. Its caption reads
    "Scrolled to Fees and Apps", but the drawing is not scrolled.
  - Proving's definition is two sentences, 123 characters (`spec.md:196-197`), past the map's
    "one sentence, at most 100 characters" (`spec.md:208-209`), so it appears only on the
    Glossary page, never behind a dotted term.
  - U8 (`mocks/gen_r5.py:274-283`, `nulo.css:588-589`): an `.n-warnline` sits between the host
    and the dApp name. It is a flex row with gap 6px, 12px/500, line-height 1.3, `--orange`,
    with a 12px warning icon offset 1px down. The block aligns its logo to the top
    (`align-items: flex-start`) in that state.
  - U9 (`gen_r5.py:284-291`, `nulo.css:591`): an `.n-fnote` sits between the label and the
    field: 12px/500, line-height 1.35, `--txt-tertiary`. The ⓘ is gone. The field's gap is 8px
    (`nulo.css:390`); today's 12px is the shared `.section` (`import-shared.module.css:4`),
    composed by `ImportSecretForm.vue:129` and `ImportFullBackupForm.vue:158`. Vite prepends a
    copy of a composed file into every composing module's CSS
    (`vite/dist/node/chunks/build.js:5456-5457`), so a local `gap` after `composes` wins or
    loses on bundle order.
  - Home dotted labels: `.n-term` on the existing label spans, with `tabindex="0"`. The
    balance-split spans get no `tabindex` and no underline (shot `tips-icon-labels`, which draws
    the split on Home; the extension renders it only on a token's page, see Balance split).
- **The Settings row**: the only drawing of the Glossary row is round 2's i9 Settings panel
  (`mocks/src/r2/i9.html:26`): App section Appearance · Proving · **Glossary** ("What Nulo's words
  mean", `menu_book`) · Advanced. The owner's i9 note: "likes the glossary page (C)". Round 3 did
  not redraw it.
- **Picks**: unchanged at 22 documents (read 2026-09-24 17:4x); `tipsb` (U8) and `tipsc` (U9)
  are absent, so both are the recommended "As drawn" and sign-off pending.
- **Vue 3.5.38** (`useId` available, auto-imported); **Text** has `height` classes `lh--100` …
  `lh--140` (`packages/design/src/utilities.css:89-105`), always emits one (default `100`,
  `Text.vue:17-21`, so a local line-height on a `<Text>` competes with it), and has no default
  weight, so it inherits `.text`'s 600.
- **Press then focus**: a click on a `<button>` inside a tooltip's trigger runs `pointerdown`,
  then `focusin` on the wrapper (`Tooltip.vue:144-147` opens at once), then `click`. The
  "Delete profile" button (`auth.vue:307-313`) opens `ForgotPasswordPopup`, whose trap keeps
  focus on the opener (`initialFocus: false`, `Popup.vue:21-25`), so no `focusout` follows.
- **Alias tooltip**: `position="start"` (`AccountSelectRow.vue:82`) places the bubble at the ⓘ's
  left edge today (`Tooltip.vue:72-73`); option A of item 2 draws it `clamp` (centred, then
  clamped; `mocks/src/parts/02-tooltip.html:71`), the rejected "before" panel `start` (`:46`).
- **Motion**: the artifact's live tooltip enters with `n-tip-in 0.12s ease-out` (opacity and a
  2px rise, `mocks/src/nulo.css:467-468`) and is removed at once (`page.js:487`); `Tooltip.vue`
  fades opacity in and out over 0.12s `ease` (`:240-250`).
- **Hairline**: the mock's `--hairline-soft` is `rgba(74, 70, 63, 0.2)` dark and
  `rgba(124, 116, 104, 0.2)` light (`nulo.css:30`, `:71`); ten extension files ship the dark
  literal in both themes.
- **Home layout**: `GasBalanceCard` labels sit in flex columns (`.col`, `.col_right` aligns end),
  so a wrapper inside the label span lays out as a flex item.
- **Network specs that open each dApp window** (their `waitForPopup(` targets): the
  `dappConnectedExtension` fixture opens discover and verify
  (`apps/extension/tests/e2e/fixtures/extension.ts:343`, `:361`), which `connect-dapp` drives;
  `cap-request-basic.test.ts:30` opens capabilities; `tx-sendTx-selfPay.test.ts:59` opens
  execute. `public-events-capability` calls node functions directly and opens no window.
