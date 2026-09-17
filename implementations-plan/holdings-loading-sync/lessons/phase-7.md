# Phase 7 — episodes, backoff, health RPC

## I2 — verified (the gate)
`IncomingTransferService` already receives the composition root's `BrowserApi`; its
`storage.session` is the MV3 session area (the runtime heartbeat writes `nulo:liveness` to the same
area), and `FakeBrowserApi` models `local` and `session` as separate areas. No `runtime.ts` change was
needed — the plan's "session-area injection in `wallet/runtime.ts`" line is a no-op.

## What shipped
- `scan-episodes.ts`: `ScanEpisodeStore` (memory + write-behind session blob `nulo:incoming:scan-episodes`),
  `parseStoredEpisode` (field-by-field validation), key/prefix helpers.
- Service: `pollPublic` checks the backoff gate, `scanAndRecord` folds the outcome into the episode,
  `announceHealth` emits `onIncomingSyncHealthChanged` on change (+ the single `warn` on the stalled
  transition), `getIncomingSyncHealth`, `retryIncomingScan`, clear rules on scheduler commit /
  `clearProfile` / `clearChain` / token delete.
- The three transient-failure logs (network resolve, tips, unanchored forward throw) moved from `warn`
  to `debug` with fixed strings + named fields.

## Decisions
1. **Removals are synchronous in memory; persistence is a chained write-behind of the full snapshot.**
   The plan said "writes and removals are serialized through the service lock". `hydrateSchedulers` —
   where lock / profile-switch clears happen — is called both inside the lock (`clearProfile`,
   `clearChain`) and outside it (`init`, `onActiveProfileChanged`, `onTokenAdded`), and `Lock` is
   non-reentrant, so taking it there would self-deadlock. The property the plan wanted holds anyway:
   the outcome WRITE goes through the service lock and is fenced by the epoch captured before the scan,
   and every write carries the snapshot taken at mutation time, so the stored blob converges on memory
   and a removal cannot be overtaken by an older write. Mutation-checked: deleting the fence makes
   "an outcome that lands after a lock cannot recreate the episode" fail.
2. **Episodes follow the scheduler set.** On every commit, episodes whose key is not in the public
   descriptor set are dropped — this is the lock / profile-switch / token-gone rule in one place. It is
   safe at worker start because `ProfileService.init` runs the session restore before this service's
   `init`, so the first commit already sees the real active profile (a TTL-expired or passkey session
   is genuinely locked, and ending its episodes is the intended "unlock starts fresh").
3. **`clearProfile` / `clearChain` drop explicitly**, because the rebuild that follows them can still
   list the contract (the token set is not what those purge).
4. **`ineligible` ends an episode** (a token that turned non-standard must not keep a stale streak).
5. **The healthy steady state takes no lock**: success with no open episode returns before
   `withServiceLock`.
6. **`retryIncomingScan` awaits the polls it triggers** so the popup gets a natural "retrying" window;
   `pollPublic` is single-flight per key, which is the only rate limit a trusted-context retry needs.
7. First-failure backoff equals the 30 s tick, so in practice the next tick lands a hair before the
   gate and the second attempt runs at ~60 s. Accepted: backoff is politeness, not precision.

## Attempts
1. `typecheck:all` exit 2 — `defineRpcMethods<Methods>()` is exhaustive and the two new methods were
   missing from the service's list (the client's `definePassthroughsExhaustive` had them). Added; exit 0.

## Gate (as written in plan.md)
- `bun run typecheck:all` — exit 0
- `bun run lint` — exit 0
- `bun run --cwd apps/extension test src/wallet/services/incoming-transfer` — exit 0 (7 files, 205 tests)
