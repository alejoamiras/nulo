# Iteration hygiene — leaked Vite servers degrade the local env (2026-06-16)

## Finding

Every `e2e:agent` run ends with: `close timed out after 10000ms / Tests closed
successfully but something prevents Vite server from exiting`. The playground/faucet
**Vite dev servers do not exit cleanly** — each run leaks a `node .../node_modules/.bin/vite`
process that keeps LISTENing on its ephemeral port. Over a long local flake-loop these
accumulate (found **18 leaked nulo-2 vite servers**, some hours/days old).

## Impact (caused false failures in the Phase-1 flake-loop)

As leaked Vite servers pile up, the Mac degrades. Late runs in a long sequential batch
failed at the **pre-mint** step (`mintPublicTokensForAccount` -> `Timeout awaiting isMined`
/ "request took too long") — NOT at the migrated assertion. The batch timestamps showed
runs ~49 min apart (a hung run blocking the queue). These were ENV-degradation failures,
not code failures — verified by re-running in a cleaned env.

## Immediate mitigation (local)

Between local runs, reap the leaked servers:

```
pkill -f "nulo-2/node_modules/.bin/vite"
```

(Path-scoped to this repo — does NOT touch other worktrees or the user's Chrome.)

## Phase 2/3 follow-ups

- **Phase 2 (tooling):** the local flake-loop helper must pkill leaked vite between
  iterations (or fix the global-setup teardown to await server close).
- **Phase 3 (Class B lead):** investigate WHY Vite won't exit (a hanging handle — likely
  an open socket/HMR/websocket or a child esbuild). On CI the playground starts once per
  shard, but if teardown hangs the shard JOB waits for it -> contributes to the 17-21 min
  shard wall-times even when the tests themselves pass. Worth confirming against a shard's
  teardown logs. Candidate fix: force-close the Vite server in `global-setup.ts` teardown
  (server.close() with a timeout + process kill fallback), or run the playground as a
  preview/static server instead of a dev server in e2e.
