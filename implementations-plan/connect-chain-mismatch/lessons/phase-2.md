# Phase 2 — `useNetworkActivation` composable

Status: ✓ (2026-09-05)

## What landed
- `composables/useNetworkActivation.ts` (C1): receives `{ persist, read }` callbacks; owns the in-flight
  pre-check and the blocked/unconfirmed toasts; returns the `NetworkActivationResult`; nothing to dispose.
- `settings/networks/[id].vue` `handleSetActive` is now: snapshot → `activate(target)` → success toast.

## Gate
- `bun run test src/composables/useNetworkActivation.test.ts` → 10 passed.
- `bun run lint` exit 0 · `bun run typecheck` exit 0.

## Notes
- Recon called `[id].vue` the guard's sole caller; `NewNetworkPopup.vue` also calls
  `activateNetworkGuarded`, with deliberately different copy ("Network added. Finish or cancel…") because
  the network was just created. Left as is — a shared composable would have to grow a copy parameter for
  one caller, which is not a dedup.
