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
- **Base 585dda2a against head 4995abec, Chrome 152 and Firefox 153, dark and light:** 132 of 132 identical. That is 72 shots over 18 surfaces, plus 60 computed-style records over 15 probed surfaces. The record states are:
  - rest, hover, `:active` and keyboard focus;
  - action focus, including the revoke reveal;
  - a forced disabled toolbar button;
  - a SettingField forced to last-of-type;
  - the four late revisits.
- **Stability**, base against itself on both browsers: 132 of 132 identical.
- **Forced diff:** a throwaway build with the shared row's `cursor` set to `default`. The pixels stayed identical and the records failed with 128 and 80 leaves, all `cursor`. So the records see what pixels cannot.
- **Probe fix while building:** a pointer press focuses its target, and re-focusing the focused element is a no-op. Firefox's first run therefore found the card target without `:focus-visible`. The probe now blurs before each keyboard focus, and it throws whenever its target does not match `:focus-visible`.
