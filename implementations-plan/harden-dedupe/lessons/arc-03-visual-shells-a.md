# Arc 3, visual-shells-a: lessons log

## Build

- Three shared modules, composed by four settings rows, two record cards and five toolbar buttons. Four hairline literals became `var(--hairline-strong)`. AccountSelectRow left the arc, by the panel's call.
- One code commit rather than one per module, since `connected-apps/index.vue` carries both a settings row and a toolbar button.
- The minifier keeps native nesting inside a composed module (`._divider_…{position:relative;&:after{…}}`), as it does in the SFCs.
- Local gates green: lint, `typecheck:all`, `test:all`, `audit:vue`, `test:ci-gating`; `audit:vue`'s build left the generated declaration files unchanged.

## Disjointness table

What each composing class keeps locally, and which shared longhands it meets on the same element.

| consumer class | keeps locally | meets |
|---|---|---|
| ContactRow `.row`, `.row_text`, `.row_name`, `.row_address`, `.actions` | nothing | none |
| connected-apps `.row`, `.row_text`, `.row_name`, `.row_grants`, `.actions` | nothing | none |
| SettingItem `.wrapper` (+ `.interactive` on the same root) | display, alignment, background, text-decoration, padding and its size and `raw` modifiers, `disabled`, `::after` insets, `:last-child::after`; cursor, transition, hover, focus and active states | E1 only |
| SettingField `.wrapper` | cursor, background, padding, transition, hover, active, `disabled`, `::after` insets, `:last-of-type::after` | E1 only |
| AuthwitCard `.card` | `border`, `padding`, the `.revoke` reveal (a descendant) | E2 only |
| notes `.card` | `border`, `border-left`, `padding` (plus the inline left colour and `card_error`, unchanged) | E2 only |
| AuthwitCard and notes `.header`, `.type`, `.kv_*` | nothing | none |
| four toolbar `.icon_btn` | nothing | none |
| `tokens/[id].vue` `.icon_btn` | `:disabled` opacity and pointer-events | none |

## Screenshots and computed styles

- **Harness additions:** a surface may declare a `probe`, which runs before the freeze and blur and writes each touched element's full computed style, element and `::after`, per state. `run.ts` compares those records leaf by leaf and counts them like shots.
- **Data:**
  - Contacts are added through the popup.
  - Sessions go through the `dapp-session` port.
  - Authwits are three schema-valid storage rows.
  - Notes come from a fake `note` Port behind a wrapped `chrome.runtime.connect`. Plain assignment worked on both browsers, with no `defineProperty` needed.
  - Token detail is one seeded token row.
- **Masks:** the clock-derived "Expires" line and the random profile ID.
- **Base 585dda2a against head 40d10344, Chrome 152 and Firefox 153, dark and light:** 132 of 132 identical. That is 72 shots over 18 surfaces, plus 60 computed-style records over 15 probed surfaces. The record states are:
  - rest, hover, `:active` and keyboard focus, on rows and on all toolbar buttons, both token-detail buttons included;
  - hover and focus on row actions, including the revoke reveal and the disconnect SVG's red fill;
  - the notes error card hovered, pressed and focused (E2: the red left border holds while the other sides take the hover colour);
  - every row of both network-detail containers, so each container's true last row (`::after` hidden) is recorded;
  - the twins' `.row_text` and `.actions` containers (`min-width`, `flex-shrink`);
  - a forced disabled toolbar button and a SettingField forced to last-of-type;
  - the four late revisits.
- A probe now fails when one of its watch locators matches nothing, so a record cannot silently omit an element.
- **Stability**, base against itself on both browsers: 132 of 132 identical.
- **Forced diff:** a throwaway build with the shared row's `cursor` set to `default`. The pixels stayed identical and the records failed with 128 and 80 leaves, all `cursor`. So the records see what pixels cannot.
- **Probe fix while building:** a pointer press focuses its target, and re-focusing the focused element is a no-op. Firefox's first run therefore found the card target without `:focus-visible`. The probe now blurs before each keyboard focus, and it throws whenever its target does not match `:focus-visible`.

## Codex loop

- **Code round 1** (GPT-6 Astra, xhigh): NOT CONVERGED, two should-fix and two nits, all adopted. Its own rebuild of all 31 compositions agreed with the disjointness table, and it re-compared the stored artifacts (72/72 shots, 60/60 records), finding no cascade bug.
  1. **The probes omitted elements whose declarations moved:** the twins' `.row_text` and `.actions` containers, and the disconnect SVG's red fill. They are now in the watch lists.
  2. **The state checklist was partly unimplemented.** Added:
     - toolbar `:active` on the connected-apps list and authwits, and focus on the connected-app detail;
     - refresh-button hover, active and focus;
     - the network-detail rows whose `::after` is hidden;
     - the notes error card through hover, press and focus.
  3. **Comments:** the wrap rule's "instead of truncating" claim was false, since the clamp truncates. It now states only its ordering invariant, and the toolbar module lost a narrating line.
  4. **The plan embedded the harness's local path.** It now names the local screenshot harness without one.
- After round 1: lint, `typecheck:all` and `test:all` (8656 passed) are green; base against head 40d10344 and `--stability` are each 132 of 132 identical.
