# P4 lessons — visibility-toggle gate completion

## Outcome

`fix(incoming): close incomingTransfersVisible gate on Pending emit + replay` —
typecheck clean, no test regressions (2063 pre-P4 → 2063 post-P4). Closes codex post-impl
audit **C2** + **H1**.

## The leak

The `incomingTransfersVisible` setting only gated TWO of the four emit paths:
1. `getIncomingTransfers` (initial-load filter) — OK
2. `scanContract:onIncomingTransferAdded` (live-event filter) — OK
3. `scanContract:onIncomingTransferPending` (first-receive prompt) — **leaked**
4. `replayPendingPrompts` (reconnect replay path) — **leaked**

So a user who toggled incoming-transfers OFF would still get the trust-prompt popup the
first time a new contract delivered them a note, and the same popup would resurface on
every popup reconnect for every pending contract. Privacy promise broken.

## What shipped — service side

`packages/extension/src/wallet/services/incoming-transfer/service.ts`:

- **`scanContract`** (line ~394): wrap the `onIncomingTransferPending` emit in
  `if (await this.isVisibilityEnabled())`. Trust transition (`unknown → pending`) +
  record persistence still happen — so toggling back ON can resurrect the prompt via
  `replayPendingPrompts`. Only the emit is silenced.
- **`replayPendingPrompts`** (line ~446): early-return on `!isVisibilityEnabled()` BEFORE
  fetching trust records. Cheap fast-path + matches the policy elsewhere in this service.

`isVisibilityEnabled` fails open (returns `true` on transient config-service errors) —
same policy already in use for `scanContract`'s Added gate. A transport hiccup never
silently suppresses prompts.

## What shipped — popup side

The service can't own the OFF→ON replay because it doesn't know the active UI-selected
`(profile, network, account)` triple — `appStore` does, and `appStore` lives in the popup
process. So **`PopupManager.vue` subscribes to `ConfigServiceClient.onUpdate`** and fires
the replay:

```js
const configService = new ConfigServiceClient()
let lastVisibility = true
function onConfigUpdate(prop) {
    if (prop.key !== "incomingTransfersVisible") return
    const newValue = prop.value !== false
    const wasOff = lastVisibility === false
    lastVisibility = newValue
    if (!wasOff || !newValue) return
    // ... call replayPendingPrompts(appStore triple)
}
configService.onUpdate.add(onConfigUpdate)
```

Three subtle invariants:

1. **`lastVisibility` is module-scoped** — it survives across mount cycles within the
   same popup session. A popup that closes during an OFF state and reopens before the
   user flips the toggle still sees `lastVisibility === false`, so the next user flip
   is correctly detected as OFF→ON. (Re-opening the popup creates a new
   `PopupManager.vue` instance only if the popup app fully reloaded; routine route
   navigation doesn't re-mount it.)
2. **Seed from disk on mount** — `onMounted` awaits `getValue("incomingTransfersVisible")`
   to overwrite the optimistic `true` default. Without this, a popup opened while the
   user has the toggle OFF would see `lastVisibility = true` initially, miss the next
   OFF→ON flip (read as `true → true`).
3. **Explicit `configService.connect()`** — same fix as RecentActivityView P3 / activity.vue
   bootstrap. Listener registration alone doesn't activate the transport.

## Tests — deferred to P8

Service-level visibility-gate tests + PopupManager false→true mount test both need
heavy fixture setup (8-dependency `IncomingTransferService` constructor + the same
`createTestingPinia`/`vi.mock` PopupManager mount harness as P3). Both phases share
fixtures with the P8 backfill sweep — building those harnesses once in P8 is cheaper
than three duplicated setups.

**Tracked in P8:**
- service: `scanContract` Pending emit with toggle OFF — record persisted, no event.
- service: `replayPendingPrompts` with toggle OFF — no-op (returns without iterating).
- popup: `PopupManager` mount with stubbed services; flip
  `incomingTransfersVisible: false → true` via mocked `ConfigServiceClient.onUpdate`;
  assert `replayPendingPrompts` called once with the active appStore triple.
- popup: same flip but `false → false` (idempotent OFF write) → replay NOT called.
- popup: `true → false` (user disables) → replay NOT called.

## Files

- `packages/extension/src/wallet/services/incoming-transfer/service.ts` (2 gate sites)
- `packages/extension/src/popup/components/popups/PopupManager.vue` (ConfigService
  subscriber + onMounted seed + onBeforeUnmount cleanup)

## Open items

- P8 — full test backfill including the P4 gating assertions.
