# Phase 3 — "Add accounts…" and the visibility re-read

Commit `4a5908ef` (arc 2, branch `tools-readiness/tools-accounts`, stacked on arc 1 at `4cb608f4`).

## What landed

- `apps/tools/src/lib/prompt-queue.ts`: `enqueuePrompt` + `MID_FLOW_STATUSES` extracted from
  `useTokenGrant.ts` (one queue, two callers); `__resetTokenGrantQueueForTests` re-exports the
  shared reset so the existing token-grant tests are untouched.
- `useAccountWidening.ts`: `addAccounts()` enqueues; the queued task re-checks `connected` and
  `opsInFlight()` INSIDE the queue; `retryCapabilities() === false` → `busy`; `failed` when the
  status left `connected` or an error was set; `added n` from the grant's growth; `unchanged`
  otherwise (a decline and "nothing new" are indistinguishable from the response — the copy says
  "No accounts were added").
- `createAztecWalletSession.ts`: `refreshAccounts()` on the shared queue; blocked unless
  `connected`, no owning flow, no operation in flight; completion checked by state — the
  `s.accounts` array identity, the selection, the status — because a retry or a switch never moves
  the flow epoch; `parseAccountList` extracted from `parseGrantedAccounts` (same hardening over
  the bare list `getAccounts` answers). The session surface grew to 30 members (pin updated).
- `useWalletConnection.ts`: one `visibilitychange` listener installed at module init for the
  page's lifetime — the singleton has no dispose, so nothing removes it.
- `AccountSwitcher.vue`: "Add accounts…" in the foot (disabled while busy or an operation is in
  flight), the status line, both with testids; `apps/tools/README.md` documents the two paths.

## Gate (retry 0, tree = `4a5908ef`)

| Command | Result |
|---|---|
| `bun run lint` | 0 errors, complexity-baseline OK |
| `bun run --cwd apps/tools typecheck` | exit 0 (app + browser suite) |
| `bun run --cwd apps/tools test -- src/composables/useAccountWidening src/composables/createAztecWalletSession src/composables/useTokenGrant src/components/AccountSwitcher` | 5 files, 116 passed |

## Lessons

- The switcher's Add button is disabled while the wallet answers, which moves focus out of the
  menu: an Escape after that goes to `body`, not the menu. The e2e closes the menu from the chip
  (a toggle), and `grantedAccounts` no longer assumes the menu is closed.
- `retryCapabilities` returns `false` as its own no-op; reporting that as "unchanged" would have
  been a lie the queue re-check alone does not prevent.
