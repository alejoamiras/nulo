# Phase 2 · The dotted term, the fee labels and the balance split

Built:

- `apps/extension/src/components/composite/DottedTerm.vue` (L3): props `term` (a `GlossaryKey`,
  validator `Object.hasOwn(GLOSSARY, key)`), `position` (default `center`), `testid`. It renders
  `<Tooltip inline :position textAlign="left" delay="300">` around
  `<span tabindex="0" :aria-describedby :data-testid>` holding the slot, a `hidden` span with the
  definition (`useId()`), and a content span with `display: block`, `line-height: 1.2`,
  `color: var(--nulo-secondary)`. The term's style is the mock's `.n-term`: `underline dotted 1px`,
  `--nulo-outline`, offset 3px, `cursor: help`; hover turns the underline `--txt-primary`;
  `:focus-visible` adds the 1px `--txt-primary` outline at offset 2px and turns the underline
  `--txt-primary`. One comment: why the description is a hidden, always-mounted copy.
- `GasBalanceCard.vue`: both labels wrap a `DottedTerm` (`public-fee-juice` / `gas-label-public`,
  `private-fee-juice` / `gas-label-private`) inside the unchanged `.label` span.
- `BalanceView.vue`: each split group sits in `<Tooltip textAlign="left" delay="300">` whose
  content is a local `.label_text` span (the dotted term's three declarations); `aria-label` moved
  from the group spans onto each `<Icon>`; one constant per string
  (`PRIVATE_BALANCE_LABEL`, `PUBLIC_BALANCE_LABEL`); the comment keeps only why the pair has no
  words.
- Tests:
  - `DottedTerm.test.ts` (12): slot not term, definition by key, unknown key warns, `tabindex`,
    hidden `aria-describedby` target, focus at once / hover at 300ms, click then Enter stays open,
    position passthrough (default `center`), left alignment, testid on the span, distinct ids for
    two terms on one screen, the `inline` prop and class.
  - `DottedTerm.scan.test.ts` (3): the scan counts at least one `<DottedTerm`; every occurrence
    names a literal, existing key (bound, missing or unknown fails); every used key's definition
    is one sentence of at most 100 characters.
  - `GasBalanceCard.test.ts` (+1, `DottedTerm` stub): both labels carry their keys, testids and
    words.
  - `BalanceView.test.ts` (+2, `Tooltip` stub rendering both slots): the two labels as tooltip
    content (left, 300ms) and as each icon's `aria-label`, no `span[aria-label]`; Home renders no
    split and no label.

Decisions the plan left open (for codex):

1. **The hidden description sits inside the Tooltip's default slot, after the term span**, not
   beside the Tooltip, so the component keeps one root (attribute fallthrough stays unambiguous)
   and the hidden node still sits next to the term. `hidden` keeps it out of layout and out of the
   term's own text.
2. **`Text` is not registered in `DottedTerm.test.ts`**: the component renders no `<Text>` since
   the content became a plain span (round 4), so only `Tooltip` is registered.
3. **Distinct ids are tested inside one app**: `useId()` is per app, so two separate `mount`s both
   start at `v-0`; every screen of the extension is one app.
4. **The scan's length check skips unknown keys**, which the key check already reports, so an
   unknown key fails one named test instead of crashing the other.

Failing first:

- `BalanceView.test.ts` and `GasBalanceCard.test.ts` against the pre-change `.vue` files (copied
  from `HEAD`, restored with a scratch script): exactly the two new tests red, 44 passed.
- `DottedTerm.scan.test.ts` with the pre-change `GasBalanceCard.vue` (no dotted term anywhere):
  "the scan finds the terms that exist" red. Mutation probes on `GasBalanceCard.vue`: a bound
  `:term`, a missing `term`, an unknown key and the `proving` key (two sentences, 123 characters)
  each red their test.
- `DottedTerm.test.ts` imports a component that did not exist before this phase.

Traps:

- Shallow mounts render no slots of a stubbed component, so `BalanceView.test.ts`'s existing
  split assertions need a `Tooltip` stub that renders both slots.

Gate:

- `bun run lint` → exit 0 (29 warnings, 3 infos, none in changed files).
- `bun run typecheck:all` → exit 0 (15 workspaces).
- `bun run test:all` → exit 0: extension 570 files passed, 3 skipped / 7194 tests passed,
  4 skipped, 7 todo; design 40 files / 370 tests; every other workspace unchanged from phase 1.
