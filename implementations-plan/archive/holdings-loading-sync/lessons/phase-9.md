# Phase 9 — stalled line

## What shipped
- `useIncomingSyncHealth` (C1): `{ stalled, retrying, refresh, retry, dispose }`. The health event is an
  invalidation, never a value — every signal (event, reconnect, scope change, retry) refetches. A fetch
  that rejects changes nothing: it can neither invent a stall nor clear one. Once shown, the line stays
  at least 5 s (`STALLED_MIN_DISPLAY_MS`) so a Retry that works at once does not make it blink.
- `RecentActivityView`: account mode only. One dashed line — "Older incoming transfers may be missing ·
  Retry" — `data-testid="incoming-sync-stalled"` / `incoming-sync-retry`. The section's root `v-if`
  gains the line, so a stalled network with no rows still renders it.
- The composable receives the view's already-connected incoming-transfer client; `dispose()` is the last
  call in `onBeforeUnmount`, after every `disconnect()`.

## Decisions
1. **No new client.** The view already owns an `IncomingTransferServiceClient` for receipts; a second one
   would double the port and the teardown.
2. **Scope = token mode + profile + network.** Token mode is part of the key: leaving it changes neither
   profile nor network, yet reveals a feed that has never fetched its health (foreign-review finding).
3. **A scope change releases Retry.** `enterScope` resets `retrying` and bumps a retry generation; a retry
   that outlived its scope neither clears the new scope's flag nor triggers its refetch.
4. **Copy and placement are the plan's UI-impact row C4** — nothing beyond it.

## Attempts
1. `ReferenceError: useIncomingSyncHealth is not defined` under vitest: composables are auto-imported by
   the vite build only. The SFC imports it explicitly.

## Screenshot (C4)
`screenshots/c4-stalled-line.png`, captured on the REAL path with no injected state: a default seeds, the
worker is cut off the network over CDP, and the popup stays open. Observed: failures 1 → 5 with the
backoff doubling (30 s, 60 s, 2 min, 4 min, 5 min cap), the network flips to stalled just past ten
minutes, the announced prefix is persisted, and the line appears through the health event with no
remount. (The first attempt seeded an aged episode and restarted the worker; in the e2e harness a killed
worker comes back LOCKED, and a lock ends every episode by design — so the blob was correctly dropped.)
The same frame shows arc 1's offline rows ("Couldn't refresh", "Couldn't set up" + RETRY).

## Gate (as written in plan.md)
- `bun run lint` — exit 0
- `bun run typecheck:all` — exit 0
- `bun run --cwd apps/extension test src/popup/components/modules/general/RecentActivityView
  src/composables/useIncomingSyncHealth` — exit 0 (2 files, 42 tests)
