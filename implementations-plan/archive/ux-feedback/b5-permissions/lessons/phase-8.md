# Phase 8 · Accounts, rename, the Alias ⓘ

Built on `939b87f1`, P7's tip. The account row stops being a `role="button"` that holds the
alias input. A stretched `RowTarget` selects it, and "Rename for this app" swaps in the field
labelled "Name for this app". The Alias label and its ⓘ are gone.

## What was built, per commit

| Commit | Step | What |
|---|---|---|
| `44ca37ad` | P8.1 | `DottedTerm.vue`: the `action` variant, a `<button type="button">` drawn as `.n-linkbtn.n-term`. `DottedTerm.test.ts`: 5 cases. |
| `0ce2fd5a` | P8.2 | `AccountSelectRow.vue` rewritten around `RowTarget`, the rename link and the field. `AccountSelectRow.test.ts` rewritten, 15 cases (the replacements are below). |
| this commit | docs | plan.md: one sign-off-pending line, P8 ✓. This file. |

## Tests

- `DottedTerm.test.ts` gains a describe, "the action variant", 5 cases: a `button` of type
  `button` that emits `click` with its `MouseEvent`; the hidden definition it is described by;
  the one class that pads its hit area (the size is P9's browser check); inside the real
  `Tooltip`, neither Enter nor Space has its default cancelled; without `action` the term stays
  the span with its own class. The 12 span cases are unchanged.
- `AccountSelectRow.test.ts`, 16 cases before and 15 after. Each deleted case and what replaces
  it:

| Deleted | Replaced by |
|---|---|
| preserves the canonical testids + data attributes | keeps the canonical testid and data attributes on the root |
| exposes data-selected when selected so e2e helpers can be idempotent | marks the selection on the root, so e2e helpers can be idempotent |
| renders the truncated address; renders the uppercased chain label | shows the name, the uppercased chain and the trimmed address |
| alias block hidden when not selected | an unselected row has neither the link nor the field |
| alias block visible when selected; alias input defaults to account name | a selected row shows the rename link; the field comes only once it is pressed, prefilled and focused |
| the alias ⓘ's tooltip centres on the ⓘ | no Alias label and no ⓘ (the ⓘ is removed) |
| alias input uses the alias prop when provided; typing in the alias input emits updateAlias(caip, value) | the field shows the alias the parent holds, and typing sends the account's caip with the value |
| clicking the row emits 'toggle' | selects through its target: a click toggles, and aria-pressed follows the selection |
| Enter key on the row emits 'toggle'; Space on the row emits 'toggle' | Enter and Space are the target's own: a native button, and nothing cancels either key |
| disabled=true blocks interactions visually; disabled=true also blocks keyboard toggles | a disabled row: its target out of the Tab order and aria-disabled, a click ignored, the row dimmed |
| locked row: marked granted, out of the tab order, ignores click / Enter / Space, hides the alias input | a locked row: granted and selected, its target out of the Tab order and aria-disabled, no link, SHARED |

  New, with no old counterpart: the target is named by the account's name; no control sits
  inside another; pressing the link, then clicking in the field, leaves the selection as it
  was; once pressed, the field stays open, emptied or deselected and selected again.
- The address is wire-shaped: `0x` and 64 hex digits, below the field modulus.
- Counterfactuals, each run once and restored from a scratchpad copy. Without the link's
  `@click.stop`, the selection test fails. Without the field block's `@click.stop`, the same
  test fails at the click in the field. Both are 1 of 15.

## Decisions

- **The link's hit area is 24px tall without moving the text.** The button has 7px of padding
  above and below and a −7px margin, so its label's line box sits where the drawing puts the
  text. A 10px font at `line-height: normal` gives a line box of at least 10px, so the box is at
  least 24px tall; the label is far wider than 24px. P9 measures the rect.
- **The focus ring is on the label, not the padded button.** `.n-term:focus-visible` rings the
  text at a 2px offset; a ring on the button would sit 7px outside it.
- **The link's `Tooltip` host carries `align-self: flex-start` and `z-index: 1`.** The first is
  `.n-linkbtn`'s own rule. The second lifts the link above the row's stretched target, as
  `RowAction` is lifted. The field's block is lifted the same way.
- **The target is named by the account's name alone** (`aria-labelledby`). The chain label and
  the trimmed address stay visible text.
- **The row's hover and focus look is today's**: `--nulo-surface-high` on hover and while the
  target has `:focus-visible`. No drawing gives the account row a focus state, and
  `RowTarget` draws no ring of its own.
- **The field stays open once pressed**, even after the row is deselected and selected again
  (A-20's "the field stays open"). What was typed is still the alias the parent holds, so the
  field shows it again. This is undrawn, so it is sign-off pending.
- **The field block lost its `@keydown.stop`.** It stopped Enter and Space from reaching the
  root's old key handlers, which are gone. Nothing else in the window listens for keys below
  `window`, and the `Tooltip` listens there in the capture phase.

## The tooltip recount (P8.3)

The unit is batch 3's (b3 plan § Tooltip count): rendered tooltip call sites, meaning `<Tooltip>`
source tags in `apps/extension/src/**/*.vue`, less the one inside `DottedTerm`, plus each
`<DottedTerm>` usage site.

| | 5a's tip (`a3629ac3`) | now |
|---|---|---|
| `<Tooltip>` source tags | 34 | 33: the Alias ⓘ's went |
| less `DottedTerm`'s own | −1 | −1 |
| `<DottedTerm>` sites | 3: Home ×2 (`GasBalanceCard.vue`), the Settings row (`connected-apps/[id].vue`) | 5: adds the window's "authorization(s)" (`PermissionGroup.vue`) and the rename link (`AccountSelectRow.vue`) |
| **rendered call sites** | **36** | **37** |

- The 33 tags: `settings/accounts/index.vue` 4; `RevokeAuthwitsPopup.vue` 3; `FpcRow.vue` 3;
  `settings/networks/[id].vue` 2; `account-state/senders/index.vue` 2; `BalanceView.vue` 2; one
  each in `tokens/[id].vue`, `settings/tokens/index.vue`, `settings/security/index.vue`,
  `connected-apps/index.vue`, `connected-apps/[id].vue`, `auth.vue`, `TokenMetadataPopup.vue`,
  `SelectFpcPopup.vue`, `NewSenderPopup.vue`, `EditFpcPopup.vue`,
  `ChangeAuthwitsRegistryPopup.vue`, `AccountsPopup.vue`, `AuthwitCard.vue`,
  `ProcessingErrorNote.vue`, `DottedTerm.vue`, `DappApprovalFooter.vue`, `AsyncListStatus.vue`.
- Batch 3's 35 is 33, plus its two dotted fee terms and two balance-split labels, less the two
  rule-6 texts. The spec's 36 (spec § Tooltip map) is 35, plus the window's two dotted terms,
  less the Alias ⓘ.
- **The spec's map lists 36; U7A's signed-off Settings term makes 37.** The one over is the
  Settings row's "authorizations" term, which P3 built as U7A draws it. The owner signed off U7
  as drawn ("Regarding 6: Recommended.", 2026-09-25), and the spec's map was counted before U7
  existed. "main" ruled it covered: nothing changes, and the count goes to the owner as
  information.
- **The Settings page keeps under the cap of two dotted terms per screen** (CLAUDE.md § Tooltips
  and the glossary). `connected-apps/[id].vue` renders one `DottedTerm`, inside its one
  authorizations row, and every line that row can show has at most one term segment
  (`permission-rows.ts`):

| The app's state | The row's line | Dotted terms |
|---|---|---|
| holds no `canCreateAuthWit` | no row | 0 |
| no transaction or simulation scope | "You confirm each authorization first." | 1 |
| a listed scope, On | "Nulo signs its authorizations without asking." | 1 |
| a listed scope, Off | "You confirm each authorization first." | 1 |
| a scope on any contract, On | "For any call, on any contract." | 0 |
| a scope on any contract, Off | "You confirm each authorization first. Off because it listed any contract." | 1 |

  While a write is pending the switch shows the asked-for state, which is one of these lines.
  The page's other tooltip is the icon-only "Copy address" label, and neither
  `GrantedCapabilitiesList` nor `DappSessionVerification` renders a dotted term.
- Outside the unit, unchanged: `@nulo/design`'s own `Input.vue` tooltip and the 15 browser
  `title` tooltips.
- The glossary scan (`DottedTerm.scan.test.ts`) reads all 5 sites, the multi-line rename link
  included, and passes with the keys `authorization` and `name-for-this-app`. A-18 already
  reads "two dotted terms per screen" as two distinct terms, so U2's one link per account holds.

## Held and asked

- **The tooltip count, 37 against the spec's 36.** Sent to "main", who ruled it covered by U7A's
  sign-off (above). Nothing is held.

## Sign-off pending, added in this phase (plan.md § Delivery)

- A row whose rename was pressed keeps its field open when it is deselected and selected again.

## Plan text that proved wrong or ambiguous

1. **"Selection through the target (click, Enter, Space)"** (P8.2). jsdom cannot synthesize a
   button's click from a key, so the unit case asserts a native `type="button"` with no
   `tabindex` whose keys nobody cancels. P9's keyboard flow presses Space on the target in a
   browser, which P9.3 as written does not list.
2. **"DottedTerm renders at three sites"** (P8.3) counts this batch's. With Home's two there are
   five usage sites, as the table shows.

## Gate

Run from the worktree root on the uncommitted tree that `44ca37ad` and `0ce2fd5a` commit
exactly. After the two commits, the working tree held only plan.md and this file.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing (P6's count). `complexity-baseline check OK` |
| `bun run typecheck:all` | 0 | 15 workspaces exited 0 |
| `bun run test:all` | 0 | extension 7,698 passed, 4 skipped, 8 todo (592 files passed, 3 skipped); wallet-bridge 423; design 393; aztec-runtime 250 passed, 2 skipped; wallet-core 247; extension-messaging 229; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 11 |

Against P7's gate the extension goes from 7,694 to 7,698 passed: 5 `DottedTerm` cases, and the
row's 16 cases become 15.

## Red runs

- None in the gate. An earlier full run (the same exits and counts) came before the field block
  lost its `@keydown.stop` and gained its click in the selection test, so the gate was run again
  on the final tree.
