# P3 lessons — RecentActivityView IncomingTransferService wiring

## Outcome

`fix(activity): connect IncomingTransferService in RecentActivityView onMounted` — typecheck
clean, no test regressions. Closes codex post-impl audit **H1**.

## The bug

`RecentActivityView.vue:217` registers `incomingTransferService.onConnected.add(loadIncomingTransfers)`
at module top-level, but `ServiceClient` does NOT auto-connect on listener registration —
it requires an explicit `.connect()` (or first request) to handshake with the background
transport. Result: on a fresh mount, `loadIncomingTransfers` never fires unless some other
code path connected the same client instance. The widget's incoming-transfer rows stayed
empty across re-mounts.

Same family as the `configService.connect()` fix that already exists right above (the
explanatory comment at line 222 even acknowledges the pattern — the incoming connect
just wasn't done at the same time).

## What shipped

`packages/extension/src/popup/components/modules/general/RecentActivityView.vue:643-668`:
add a parallel `try { await incomingTransferService.connect() } catch {...}` block right
after the existing `configService.connect()` call. Comment updated to explain why both
explicit connects are needed (config = onUpdate fires; incoming = onConnected listener fires).

## Tests — deferred to P8

P3 calls for a "minimal component test." The realistic minimum is a full mount of
`RecentActivityView` with `vi.mock` stubs for 5 ServiceClients + `createTestingPinia` +
`useRouter` stub + `useTicker` — ~150 lines of fixture setup. That fixture is also needed
for **P8** (test backfill — dedupe / late-delete / trust / visibility / cleanup), all of
which exercise this same component.

Decision: build the fixture once in P8 and pin the connect-on-mount assertion there
alongside the other RecentActivityView regression tests. Splitting it across P3 + P8 would
duplicate the mount harness.

**Tracked in P8:** `RecentActivityView` mount fixture + assertion that
`IncomingTransferServiceClient.prototype.connect` is called once during `onMounted`.

## Files

- `packages/extension/src/popup/components/modules/general/RecentActivityView.vue` (P3
  connect + comment widening)

## Open items

- P8 — add the mount fixture + connect-on-mount assertion (see above).
