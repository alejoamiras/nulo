# Phase 1 · C5 · the sponsor attribute

- The real `DropdownItem` (`apps/extension/src/components/ui/Dropdown/DropdownItem.vue`) has one
  root `div` and default attribute inheritance, so `data-fpc-id` falls through to the row the same
  way `data-testid` does. The component test's stub forwards `$attrs` too.
- Red first: the new case ran against the unfixed template and failed with
  `expected [ undefined, undefined ] to deeply equal [ 's1', 's2' ]`, which is the check that the
  case fails without the attribute. Its input lists the hand-added sponsor before Nulo's, so the
  expected `["s1", "s2"]` also proves each id travels with its row through `menuOrder`.
- Gate, all exit 0:
  - from `apps/extension`, `bun --bun vitest run src/popup/components/modules/send/FeeMethodSelector.test.ts src/popup/pages/send.integration.test.ts`:
    2 files, 44 passed (the two exact-testid cases and `pickFee` untouched and green);
  - `bun run lint`: exit 0 (29 warnings, 3 infos, all in files this plan does not touch);
  - `bun run typecheck:all`: exit 0, every workspace.
