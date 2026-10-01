# Phase 7 · Details table and the U1 fold

Built on `506eddf6`, P6's tip. The permission window gets its two folds. "Already allowed · N"
holds the rows the app already has, read-only, and "Details" holds the contract table. Only the
new rows fill the groups, and an app asking for more reads "wants more permissions on X" and
"Allow".

## What was built, per commit

| Commit | Step | What |
|---|---|---|
| `f172dcc9` | P7.2, P7.4 | `CapabilityDisclosure.vue` (L3) + test, 11 cases: the fold both folds use. `DetailsTable.vue` (L3) + test, 12 cases and 1 todo. `DetailsTable.stories.ts` (S1's data). `src/types/components.d.ts` regenerated with both. |
| `8bf3d70d` | P7.3 | `PermissionGroup.vue` (L5): one group's label and rows, for the new groups and the held ones. `index.vue`: the fold, Details, the copy, the U1 words. `index.test.ts` and `chain-switch.test.ts` (below). |
| this commit | docs | plan.md: four sign-off-pending lines, P7 ✓. This file. |

P7.1 (`details-table.ts` and its 11 tests) landed in P6 (`7d37fa91`), because the S2 note reads
the table's split. P7 adds nothing to it.

## Tests

- `CapabilityDisclosure.test.ts`, 11: a native button; the label, then the tag after a middle
  dot; the testid on the button; closed at first; a click opens it with the slot, a second
  closes it; `aria-controls` only while the panel exists; the chevron is `aria-hidden`; two
  folds open apart with distinct ids; opening emits nothing.
- `DetailsTable.test.ts`, 12 and 1 todo: every case P7.2 names. The todo is A-27's spoken name
  for an unknown row, held for the owner (lessons/phase-6.md).
- `index.test.ts`:
  - S1 gains "Details lists both contracts, and a copied address goes to the snack whole". The
    window hands the full address to `copyWithToast` with `sanitize`.
  - "no Details when the grants reach no contract", over an accounts-only connect and U4's data
    plus contract classes. With the rule flipped to the plan-literal "Details · 0 contracts",
    both cases fail.
  - A new describe, "U1: a connected app asks for more", on the tools app's four grants and a
    narrow consent. A-5: the three new rows, the authorizations row Off and flagged, "Already
    allowed · 5", "Details · any contract", "Allow", and the opened fold read-only with its
    stored lines. A-30: private events new and Off, the fold at 7, `data` left out of the
    answer. A-32: the badge on the new row, none on the folded address book. A-31: only the
    accounts new, the authorizations row folded with its line, no consent in the answer.
  - Two P6 tests move into that describe on the tools app's grants. "a data re-request after a
    declined widening: private events new and badged, the address book not asked again" is
    replaced by the A-32 test. "a membership-only accounts widening: only the address row is
    new, no switch, no consent sent" is replaced by the A-31 test. Each keeps every assertion
    it had and adds the fold's.
- `chain-switch.test.ts` gains A-13: an app asking for more on another chain reads "Allow as
  is", with the banner's title and switch button unchanged.

## Decisions

- **One fold component for both folds.** `gen_r5.py:585-590` styles "Already allowed" "like
  Details" (`.n-details`, `.n-detail-panel`), so `CapabilityDisclosure` holds the button, the
  chevron and the panel, and `DetailsTable` puts its table inside it. A composite importing a
  composite is allowed (L3 bans only service clients, stores and `@/utils/core`).
- **The panel mounts only while open**, so `aria-controls` is set only then. An id pointing at
  nothing would be a broken relation.
- **`PermissionGroup.vue` sits beside the window** (`popup/windows/capabilities/`). It is the
  P6 group markup moved out of `index.vue`, so the new groups and the fold's groups render the
  same way. The fold's groups pass `granted`, which marks each row `data-cap-granted="true"`.
- **Row keys double as id suffixes** (`known-0`, `unknown-0`, `any`), since `aria-labelledby`
  takes a space-separated list.
- **A named Details row is labelled by a hidden "{name}: {columns}" span** (A-27). An unknown row
  is labelled by its visible trimmed address, the drawing's text, until the owner answers.
- **The copy button carries `data-details-key`**, pairing it with its row's target for P9. Its
  24px box is pulled in by 6px on each side: the 12px glyph then sits 6px from the address as
  drawn, and the row keeps its 30px height.
- **`--hairline-soft` is defined on the table** with the mock's dark and light values, because
  `base.css` has no such token and stays untouched. `PermissionRow` already inlines the same
  two values.
- **The window copies through `copyWithToast(address, openToast, "Address is copied", { sanitize:
  true })`**, as `ScopeAddress` does. Nothing depends on where the snack sits.
- **`useToast` is imported explicitly.** Vitest's auto-import covers only `vue` and `vue-router`,
  so the auto-imported call threw in every window test.
- **Details with no contract: no fold** (coordinator, relayed 2026-09-25, moderate confidence).
  The window drops the table when its known, unknown and any-contract parts are all empty. A
  one-line condition in `index.vue` is pinned by the `test.each` above.
- **An app whose session holds no row reads as a first connect.** `asksForMore` is "the fold has
  a row", so the words and the fold follow from one fact.
- **Line heights.** The extension's body leaves `line-height: normal`, as the mock's `.nulo` root
  does, and no ancestor of the window's sections sets another. The new rules set only the mock's
  own values: 1.5 on function lines, 1.45 on the footnote, and 1 on the 15px checks through the
  icon font's rule. The disclosure sets `normal` on its button itself, since a button's font
  comes from the UA stylesheet rather than its parent. Details rows are one line and centre as
  drawn. `PermissionRow`'s icon and switch keep arc 5a's `margin-top: 1px` over the mock's
  13px/1.35 title; P10 measures both.
- **The disclosure's focus ring is batch 4's row ring**: 2px `--nulo-accent` inside the edge,
  with the hover's colours. The plan names "batch 4's `RowTarget` pattern" for the button, and
  no drawing has its focus state.

## Held and asked

- **The empty table** (no drawing, no plan recommendation). Asked "main" with (a) the
  plan-literal "Details · 0 contracts" and (b) no fold, recommending (b) at moderate confidence.
  "main" decided (b), with the owner's question and (a) as the alternative for P10's parity page,
  and one such window captured in both browsers.
- **A-27's unknown row** stays held (P6).

## Sign-off pending, added in this phase (plan.md § Delivery)

- Details with no contract: no fold (the coordinator's wording).
- An app whose session holds no row reads as a first connect.
- The S2 note on a re-request sits after the fold, before Details.
- The keyboard focus of the Details and "Already allowed" buttons.

## Plan text that proved wrong or ambiguous

1. **P7.1 was built in P6** (see above).
2. **The empty table** had neither a drawing nor a recommendation (Held and asked).
3. **"Rows open with Enter and Space"** is a native button's own behaviour. jsdom cannot
   synthesize the click from a key, so the test asserts that neither keydown is
   `defaultPrevented` and that a click toggles the row, as P8.1 plans for `DottedTerm`. P9 presses
   the keys in a browser.

## Gate

Run from the worktree root on the uncommitted tree that `f172dcc9` and `8bf3d70d` commit
exactly. After the two commits, the working tree held only plan.md and this file.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing. `complexity-baseline check OK` |
| `bun run typecheck:all` | 0 | 15 workspaces exited 0 |
| `bun run test:all` | 0 | extension 7,694 passed, 4 skipped, 8 todo (592 files passed, 3 skipped); wallet-bridge 423; design 393; aztec-runtime 250 passed, 2 skipped; wallet-core 247; extension-messaging 229; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 11 |
| `bun run --cwd apps/extension build-storybook` | 0 | `DetailsTable.stories` among the built stories |

Against P6's gate the extension goes from 7,665 to 7,694 passed (11 disclosure, 12 table and 6
window tests), and from 7 to 8 todo. The Chrome build (`bun run --cwd apps/extension build`,
exit 0) ran once, to regenerate `components.d.ts`.

## Red runs

- **Every window test failed** at first, 39 of 134, with `useToast is not defined`. Vitest's
  auto-import covers only `vue` and `vue-router`, so `index.vue` now imports it.
- **The first lint failed** on the formatter alone, in the three new test and story files.
  `biome format --write` fixed them, and the second run is the gate's.
- **commitlint warned `footer-leading-blank`** on the window commit. A body line began with
  "assertions:", which reads as a footer token. The message was reworded and amended before
  anything was built on it.
