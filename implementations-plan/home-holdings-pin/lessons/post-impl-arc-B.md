# Arc B — post-implementation codex loop

Base = Arc A's tip; diff = phases 3–4 (`apps/extension`). Astra at `high`, read-only, session
`01a0796f-f4a5-7b71-9c8d-c3817c689c42`.

## Round 1 — verdict `reject`, seven findings, all verified and taken

1. **High — the Send picker had no scope fence.** A fetch for account A resolving after a switch to
   B installed A's rows (`props.show` was the only guard), and loaded rows survived a scope change.
   Fix: the scope is captured before the fetch, a load generation drops superseded results, a
   scope watcher reloads while shown, updates are gated on scope like adds. New case: two deferred
   fetches resolved out of order → only the new account's rows.
2. **Medium — `usePrices` was constructed inside the show watcher**; its `useTicker` registers
   `onUnmounted`, which needs a component instance, so every open leaked a ticker user (Vue warned).
   Fix: the composable lives with the component (constructed in setup, disposed before its client
   disconnects on unmount); only the balance client is per-open.
3. **Medium — no rejection handling.** Hiding the picker disconnects its port, which rejects the
   pending fetch → an unhandled rejection; Holdings' config reads had the same hole on navigation.
   Fix: the picker's load catches (swallowed after a hide, `select-token-error` while open);
   Holdings' reads catch and keep the defaults. New cases for both rejection paths.
4. **Medium — a query outlived its search box.** Four rows → search "delta" → a deletion leaves
   three → the box disappears but the query kept filtering everything out. Fix: the filter applies
   only while the box is shown. New case.
5. **Medium — reconnect recovery.** The picker never resnapshotted on `onConnected`; Holdings
   resnapshotted balances but not config. Fix: both subscribe (the picker skips the connect its own
   load opens, via an in-flight counter). New cases for both.
6. **Low — weak fixtures.** The TokenList and e2e Holdings sort-toggle checks used rows whose value
   and name orders coincide; the picker's balance-row id equalled the token id. Fix: the unit
   fixtures now rank differently under each sort (`ZED` 3000 vs `ETH` 1), the e2e extra token is
   `ZED` ("ZED Token" sorts after "TestToken"), and picker rows carry `id = tokenId + 100`.
7. **Low — comments.** "Pins land in a later arc" deleted from Holdings and the picker; TokenList's
   empty `.wrapper` rule and its binding removed.

Not taken: the Holdings deferred-fetch scope-switch case — `useEntityCrud.refresh` already fences
stale fetches with its own sequence (`useEntityCrud.ts:80-97`) and its suite covers it; the page
adds nothing to that path. The e2e Holdings spec's renamed token runs again in Phase 6's gate.

## Round 2 — verdict `approve with fixes`, three findings, all verified and taken

1. **Medium — the reconnect guard was wrong in both the picker AND Arc A's `BalanceView`.**
   `ServiceClient.onDisconnect` rejects the pending request and reconnects synchronously
   (`extension-messaging/src/background/client.ts:65-79`), so `onConnected` fired while the
   in-flight counter was still 1: the recovery load was suppressed and the rejected load then
   showed the error (codex reproduced "two connections, one request, error displayed"). Arc A's
   round-3 test had emitted the reconnect only after the rejection settled, which is not the real
   order. Fix in both: count connects — the first after a show (mount, for the hero) is the one the
   load opened; every later one is a reconnect and reloads, the new generation fencing the
   rejection out; the picker resets the count on hide. Both tests now reject and reconnect in the
   client's order. The `BalanceView` fix is committed here on Arc B and cherry-picked down to Arc A.
2. **Medium — the picker's price feed refreshed at mount while LOCKED.** `PopupManager` mounts every
   popup unconditionally and `refreshIfStale` requires the fiat switch but no profile
   (`price/service.ts:145`), so a locked wallet could reach the price provider. Fix: the picker is
   mounted only while `appStore.isLogined` (which also disconnects it on lock).
3. **Low — a narrating comment** in the TokenList sort case deleted.

Also added on codex's aside: a Holdings case where both config reads reject (defaults stand, no
error line).
