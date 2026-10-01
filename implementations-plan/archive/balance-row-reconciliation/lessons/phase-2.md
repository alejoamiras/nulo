# Phase 2 — service lock + ensure path

## What landed

- **`private readonly lock = new Lock("token-balance", undefined, null)`** — the third
  argument is load-bearing. `lock.ts:29-34` documents that the default watchdog
  force-releases and "would admit a second critical section into a legitimately-running
  one", which is precisely the allocator invariant this lock exists to hold. Holds are
  bounded by the repair count, which has no cap, so queueing is the only correct semantic.
- `createTokenBalance` → **`createTokenBalanceHoldingLock`**; both live handlers take one
  hold for their whole batch. Zero unlocked callers remain (`grep -c "createTokenBalance("` → 0).
- **`restore()` takes one whole-batch hold but NOT the ensure path** — it keeps only
  `TokenBalanceRawSchema.parse` and `assertRestoreEpoch`. Full-backup slices are written
  before the imported profile is activated (`useFullBackupImport.ts:900-905`, "Late
  activation"), so their token ids are absent from the active map; any active-map
  authorization here would reject every restored balance.
- **`purgeForTokens`** — typed and raw passes share one hold with the creators.
- **Token liveness is `isSameTokenLive`**, comparing `profileId`/`chainId`/`contract`, not
  `tokens.has(id)`. Ids are `max+1`, so deleting the highest token frees its id for a
  successor (`token/service.ts:681-684` warns about exactly that reuse) and a bare
  membership check would pass for a different token.
- **Init hydration fenced** — generation captured before the first await, map and
  `this.profile` committed only if it still holds. This was the service's one unfenced
  token-map write.
- `dependencies` += `AccountService.name`.

## Red-run proof of the concurrency test

The test asserts two concurrent creators produce two distinct ids and two distinct pairs.
With the lock neutralized to a pass-through:

```
AssertionError: expected 1 to be 2
```

One id for two rows — the second `repo.set` silently overwrote the first, with no
`onTokenBalanceDeleted`. That is the pre-existing production bug, reproduced.

## Two things that cost time

**`EventHandler.invoke` dispatches un-awaited**, so `await Promise.all([invoke, invoke])`
returns before either handler runs and the first version of the test asserted against zero
writes. Draining with repeated `flush()` is the right shape — and the un-awaited dispatch is
the very property that makes the two handlers concurrent in production.

**The bare `AccountService` stubs did not break here.** They will in Phase 3, when init
starts reading accounts; codex's round-3 re-wording of the phase boundary (Phase 2 prepares
the ensure path, Phase 3 adds the sweeps) predicted this exactly.

## Validation gate — PASS

```
bun run lint       → exit 0
bun run typecheck  → clean
bun run --cwd apps/extension test src/wallet/services/
                   → Test Files 130 passed | 2 skipped · Tests 1821 passed
```
