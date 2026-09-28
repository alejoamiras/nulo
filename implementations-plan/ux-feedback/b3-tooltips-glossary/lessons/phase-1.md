# Phase 1 · The tooltip primitive and the glossary module

Built:

- `packages/design/src/ui/tooltip-placement.ts`: `placeTooltip({ trigger, bubble, viewport, side,
  position }) → { x, y }`. Today's side/position arithmetic with the 6px gap; `top`/`bottom` flip
  when only the other side fits; both coordinates clamp into `[8, extent − 8 − size]`, taking 8
  when the bubble is larger than that interval; `left`/`right` clamp without flipping; an invalid
  position (or side) keeps its 0 and the clamp moves it to 8.
- `packages/design/src/ui/Tooltip.vue`:
  - placement through the helper against `window.innerWidth`/`innerHeight`;
  - `.content` capped at `min(272px, calc(100vw - 16px))` (border-box); `.text` lost the
    `--base-width` clamp and gained `overflow-wrap: anywhere`; `maxWidth` still narrows the text;
  - `inline` prop (`inline-flex`, `align-items: baseline` on the wrapper and the trigger);
  - one pending open and one pending close; leaving (`mouseleave`, `touchend`, the bubble's
    `mouseleave`) cancels the open and closes after 150ms; entering the trigger or the bubble
    cancels the close; focus opens at once and cancels both; `focusout` closes at once;
  - Escape on a `window` capture listener that exists only while open: `preventDefault`,
    `stopPropagation`, close;
  - the press latch (`pointerdown`, Enter or Space inside a `button`, `a` or `[role="button"]` in
    the trigger), cleared by a non-touch `pointerenter`, `mouseleave` or `focusout`; neither key is
    prevented;
  - the bubble: `role="tooltip"`, `data-testid="tooltip-bubble"`, text `data-testid="tooltip-text"`,
    `@click.stop`, `@mousedown.prevent`;
  - the rise: opacity 0 → 1 and `translate: 0 -2px` → none over 0.12s ease-out; no leave motion;
  - unmount clears both timers and the Escape listener.
- `Tooltip.test.ts`: 54 cases (was 25). "mouseleave hides the content again" is replaced by
  "leaving the trigger keeps it open 150ms, then closes it" (the spec's grace); "focusout hides"
  now says "at once". Also `enableAutoUnmount(afterEach)`, the 12 geometry cases
  with the 6px gap, the invalid-position pin at x = 8, three component cases through a mocked
  360×600 window (flip, right shift, left shift), the pointer, Escape, press/latch, unmount and
  bubble cases the plan lists.
- `tooltip-placement.test.ts`: 14 table cases.
- `apps/extension/src/components/Popup/Popup.tooltip.test.ts`: the real `Popup`, focus-trap and
  `Tooltip` (only `@/utils/core` mocked): tooltip-in-popup takes the first Escape, the second
  closes the popup and focus returns to the opener; a popup opened from a trigger's `<button>`
  (`pointerdown`, focus, click) gets the first Escape and focus stays on the button.
- `Tooltip.stories.ts`: `AtRightEdge`, `AtBottom`, `InlineInSentence`, and the `inline` control.
- `apps/extension/src/utils/glossary.ts` (`GLOSSARY`, `GlossaryKey`, `GLOSSARY_SECTIONS`) and
  `glossary.test.ts` (the nine entries and the four sections against a hardcoded copy of the
  spec's strings; every key in exactly one section).

Decisions the plan left open (for codex):

1. **The rise is a CSS `animation` on the bubble, not a Vue `<Transition>`.** A `<Transition>`
   with no leave classes still waits two frames before removing the element (`nextFrame`, then
   `whenTransitionEnds`), so "removed at once" would not hold. A keyframe on `.content` replays on
   every mount and `v-if` removes the node synchronously, which is the mock's own mechanism
   (`.n-tip.live { animation: n-tip-in 0.12s ease-out }`, `nulo.css:467-468`). The P3.7 read-wait on
   `getAnimations()` covers CSS animations as well as transitions.
2. **The latch sentence sits on the `dismissed` declaration.** The plan says the focus comment
   becomes the latch invariant; the old keyboard-parity comment above `handleFocusIn` went, and
   `@focusin` now calls `show` directly, so the declaration is where a reader meets the latch.
3. **Coordinates are not rounded**, as today (the mock rounds its absolute `left`/`top`).
4. **Re-entering while open only cancels the close.** The mock re-arms its show timer on every
   `pointerenter`, which re-creates an open bubble after 300ms; the plan's "entering the trigger
   or the bubble cancels that close" is built, with no re-open.
5. **The gap and inset constants are module-local** to the helper (no consumer needs them).
6. **Story copy is neutral** ("A longer body that wraps…"), not a glossary sentence, so no story
   carries user-facing text that could drift from the glossary.

Failing first:

- The new `Tooltip.test.ts` run against the pre-change `Tooltip.vue` (copied back from `HEAD`,
  then restored with `cp`): 34 of 54 failed. Most of the 20 that passed are the unchanged cases;
  the "stays closed" ones passed vacuously there, because the old bubble has no `tooltip-bubble`
  testid, so each rule was also proven by a mutation probe on the new code, each reverted
  from a scratch copy:
  - focus-open not cancelling the close → "hover, leave, then focus" red;
  - no latch → the focusin and tap cases red;
  - no `stopPropagation` → the Escape/document case red;
  - the latch cleared on `mouseenter` → the tap case red;
  - leave closing at once → the three grace cases red;
  - no `@mousedown.prevent` → the bubble press case red;
  - no unmount cleanup → the three unmount cases red;
  - the latch not cleared by a mouse/pen arrival → both arrival cases red;
  - a press that cancels no pending open → "cancels a pending open" red.
- `Popup.tooltip.test.ts` under three mutations of `Tooltip.vue`: no `stopPropagation` and a
  bubble-phase listener each red the tooltip-in-popup case; no latch reds the popup-from-trigger
  case.
- `glossary.test.ts` and `tooltip-placement.test.ts` import modules that did not exist before
  this phase.

Traps:

- `vi.useFakeTimers()` freezes `Date.now`, and Vue's event invoker skips an event whose `_vts` is
  not newer than the handler's attach time; test-utils' `trigger` works around it
  (`event._vts = Date.now() + 1`), so every event in the component tests goes through `trigger`
  (a `DOMWrapper` for the teleported bubble) or is dispatched where the first Vue listener on its
  path is the only one.
- An explicit `wrapper.unmount()` under `enableAutoUnmount` makes the auto-unmount call
  `app.unmount()` a second time, which warns; the unmount cases mount a host and drop the
  tooltip with `v-if` instead.
- Biome's `noShadowRestrictedNames` rejects a test helper named `escape` (a global); renamed
  `escapeKey`.
- This agent's sandbox refuses compound shell lines that mention `git` or build commands from
  variables; the probes ran as a scratchpad script with plain arguments.

Gate:

- `bun run lint` → exit 0 (29 warnings, 3 infos, none in changed files).
- `bun run typecheck:all` → exit 0 (15 workspaces).
- `bun run test:all` → exit 0: extension 568 files passed, 3 skipped / 7176 tests passed,
  4 skipped, 7 todo; design 40 files / 370 tests; aztec-runtime 34 files passed, 1 skipped /
  249 passed, 2 skipped; wallet-bridge 279, wallet-core 247, extension-messaging 229,
  wallet-crypto 120, third-party-notices 66, legal 54, landing 40, resolve-asset 14,
  wallet-sdk-schema-patch 11; passkey-rp exit 0.
