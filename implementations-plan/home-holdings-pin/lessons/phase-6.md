# Phase 6 — the menu item, the popup, and the order everywhere

Implemented on the Mac, 2026-09-07, on `home-holdings-pin/pins` after both arc loops closed.

## What changed
- `ConfirmPopup.vue`: `cacheStore.confirm.single` hides Cancel and makes the callback optional; the
  existing on-close reset (`cacheStore.confirm = {}`) clears the flag with everything else.
  `ConfirmPopup.test.ts` (new, 3 cases): single mode, plain mode unchanged, and the regression where
  an informational confirm is followed by a destructive one (Cancel, colour and the text gate back).
- `pages/tokens/[id].vue`: `token-menu-trigger`; a `token-menu-pin` `DropdownItem` (`push_pin`
  glyph, "Pin to Home" / "Unpin from Home", `data-pinned`); `usePinnedTokens` with the page's own
  `TokenServiceClient` and an async `knownContracts` that calls `getTokens` at write time; toasts
  "Pinned to Home" / "Unpinned from Home"; on `"full"` the pinned symbols are read from the same
  token list, bounded with `sanitizeWireString(…, 32)`, and the single-action confirm opens with
  the plan's copy. `[id].test.ts` (new, 6 cases) drives the item through a mocked token client whose
  list changes between mount and the click.
- `usePinnedTokens`: `tokenService` became optional and `pinScopeOf(profileId, chainId)` was added —
  Home, Holdings and the picker are read-only surfaces with no token client, and one deletion
  subscriber (the token page, where "Remove token" lives) is enough since a dangling pin is never
  displayed and is pruned by the next write. Each surface passes its live rows as the known set,
  refreshes on its scope watcher (the picker on every load) and disposes on unmount.
- `TokensView.vue`, `pages/holdings.vue`, `SelectTokenPopup.vue`: `pins.pinnedContracts.value` into
  `orderTokenRows`. Their suites gained an in-memory `chrome.storage.local` + `onChanged` stub
  because the composable reads storage at mount.
- E2E: `pinFromTokenPage` / `readPinState`; `network/pin-to-home.test.ts` — TST (1000) and a deployed
  ALT (25) under a seeded quote, pin ALT from its page → Home leads with ALT, a fresh popup keeps the
  order, unpin restores it, `data-pinned` tracks the state.
- Docs: CLAUDE.md's L4 block names the holdings module and the `src/utils` token-row helpers; the e2e
  README gains a feature-helper table; the plan index entry is updated.

## Test notes
- Stubbing the dropdown in the token page test needs the SFC's own name (`DropdownRoot`), not the
  index export name (`Dropdown`); with the real component the items live in a teleport that only
  renders while open.
- A stub that both declares `@click="$emit('click')"` and lets the parent's `@click` fall through
  fires twice; declare `emits: ["click"]` on the stub.
