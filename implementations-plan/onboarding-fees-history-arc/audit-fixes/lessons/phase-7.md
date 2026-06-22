# P7 lessons — real pending-prompts queue in PopupManager

## Outcome

`fix(popup-manager): pending-trust queue with (profile, network, contract) dedup` —
typecheck clean, 2075/2082 vitest passing (+6 new), no regressions. Closes codex post-impl
audit **M3** + opus **C3** (bare-contract dedup) + codex final-review **L** (open-popup
coalesce must also be triple-keyed).

## The bug

The pre-P7 PopupManager had a single-slot model: `cacheStore.incomingTrust` held one
payload, and `replayPendingPrompts` on close re-fetched and overwrote it. Two real
failures:

1. **Bare-contract dedup** — the open-popup coalesce checked
   `cacheStore.incomingTrust?.contract === payload.contract`. The same token contract
   address can legitimately exist on multiple networks (USDC-on-net1 vs USDC-on-net2,
   etc.). A user with twins on two networks would see only the FIRST one and the
   second would be silently suppressed.
2. **Replay race on overlap** — if the service emit-stormed N pending prompts via
   `replayPendingPrompts`, only the last-fired one survived (each emit overwrote the
   prior payload), and the others got re-derived via the replay-on-close loop. That
   loop wasn't idempotent either: replay re-emitted entries already represented.

## What shipped

`packages/extension/src/popup/components/popups/PopupManager.vue`:

- Module-scoped `pendingTrustQueue` array. Three feeder paths converge on it: live
  `onIncomingTransferPending`, `replayPendingPrompts` on reconnect, `replayPendingPrompts`
  on visibility OFF→ON flip.
- **`tripleKeyOf(payload) = profileId|networkId|contract`** — the dedup key. Bare-contract
  is incorrect for the USDC-twin case.
- **`enqueueIfNew(payload)`** — drops the payload if (a) the currently-open popup is
  already showing the same triple, OR (b) the queue already contains an entry with the
  same triple. Both checks gate on the same key.
- **`dequeueNextPendingTrust()`** — pops the head, populates `cacheStore.incomingTrust`
  (now including `profileId` + `networkId` for the next coalesce check), opens the popup.
- The popup-close watcher now calls `dequeueNextPendingTrust()` directly. The previous
  `replayPendingPrompts(...)` call there was redundant — every replay path feeds the
  same queue, and the close-watcher just drains the head.

`cacheStore.incomingTrust` now carries `profileId` + `networkId` alongside the existing
`contract` / `tokenSymbol` / `amountRaw` / closures. The IncomingTrustPopup consumer
ignores them; they exist for the open-popup coalesce check.

## Tests — 6 new cases

`packages/extension/src/popup/components/popups/PopupManager.test.ts`:

1. Single event → opens popup + populates cacheStore with profileId/networkId.
2. Duplicate triple while open → silently dropped + queue stays empty.
3. **The headline case**: 3 events across 2 contracts (1 repeat) → A opens, dup
   dropped, B queues; close → B surfaces; close → stays closed.
4. **Same contract on different networks** → both surface (triple-key dedup pin).
5. Replay-while-open: 4 dups for the open triple → queue stays empty after close.
6. Closure binding: `allow()` calls `setTrustAllow(p1, net-1, 0xcA)` for the FIRST
   payload, not the most recent — guards against the previous overwrite bug.

## Test-fixture pattern (reused by P8)

`shallow: true` mount stubs every child component automatically. The queue logic lives
in PopupManager's `<script>`; the template just renders child popups, none of which
matter for the queue.

Listeners are captured into module-level arrays (`incomingPendingHandlers`,
`configUpdateHandlers`, `incomingConnectedHandlers`) inside the `vi.mock` factory. Tests
fire payloads via `firePending(payload)` which iterates the captured handlers. The
reactive `popupsState` proxy drives the close→dequeue watcher. This same pattern will
extend cleanly to P8's PopupManager mount fixtures.

## Files

- `packages/extension/src/popup/components/popups/PopupManager.vue` (queue + dedup +
  dequeue-on-close).
- `packages/extension/src/popup/components/popups/PopupManager.test.ts` (new, 6 cases).

## Open items

None — P7 is self-contained. P8 will extend the test fixture for the broader sweep.
