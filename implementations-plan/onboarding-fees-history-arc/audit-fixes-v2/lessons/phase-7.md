# P7 lessons — Tactical C1: NewTokenPopup auto-setTrustAllow

## Outcome

`fix(new-token-popup): auto-trust user-added contracts via setTrustAllow` —
15/15 tests pass in `NewTokenPopup.test.ts` (+3 new P7 pins). Closes
the user's QA report C1 ("trust popup opened for a token I already
had added").

## What shipped

`packages/extension/src/popup/components/popups/NewTokenPopup.vue`:

- Import `IncomingTransferServiceClient` + instantiate alongside the
  other client clients.
- After `tokenService.addToken(...)` succeeds (line ~205), `await
  incomingTransferService.setTrustAllow(submittingProfileId,
  submittingNetworkId, newToken.contract)`. Best-effort: wrapped in
  `try/catch` that swallows errors so transient port hiccups don't
  fail the token-add.
- `incomingTransferService.disconnect()` in the existing close-watcher
  cleanup block (alongside the other client disconnects).

## Why "tactical" (vs the deferred full setUserAddTrustHandler design)

The full v3 design (a `tokenService.setUserAddTrustHandler` setter +
awaited handler invocation BEFORE `onTokenAdded` emit) closes the
strict ordering race with the scheduler's immediate-poll path. The
v3 codex audit also caught a startup-ordering hole: a popup-origin
addToken during the boot window (before `IncomingTransferService.init`
runs) would silently skip the auto-trust.

This tactical fix lives in the popup itself. Race window: the
scheduler's `startScheduler` fires an IMMEDIATE poll on token-add (zero
delay), THEN subsequent polls every 30s. So the race is with the
immediate-kick poll, not just the 30s tick — corrected per the post-
impl codex audit Low finding. In practice the immediate poll still
includes the PXE call + note-decoding latency (typically &gt;100ms),
which exceeds the popup's `setTrustAllow` write (sub-100ms repo
write + emit). The user's reported scenario closes; the full
concurrency-safe design ships in a separate arc.

## Security boundary preserved

`setTrustAllow` ONLY fires from this popup. dApp-driven `register_token`
flows through `popup/windows/execute/index.vue` → `interactionService.approveInteraction`
→ `tokenService.addToken({origin: "dapp"})` — entirely outside this
popup. No bypass; the first-receive friction prompt still protects
against pollution attacks via the RPC path.

## Tests (+3 new P7 pins)

`packages/extension/src/popup/components/popups/NewTokenPopup.test.ts`:

- **success path**: addToken succeeds → `setTrustAllow` called exactly
  once with `(p1, net-1, validHex)`.
- **setTrustAllow failure tolerance**: mock setTrustAllow to reject;
  the popup still proceeds through the balance-wait flow + closes
  with "Token added" toast. No surfaced error.
- **parse-failure path**: parseTokenInterface returns
  `{ isComplete: false }` → addToken NOT called → setTrustAllow NOT
  called.

The test harness was extended with an `IncomingTransferServiceClient`
mock + a `setTrustAllowMock` spy.

## Files

- `packages/extension/src/popup/components/popups/NewTokenPopup.vue`
  (import + client + setTrustAllow call + disconnect cleanup).
- `packages/extension/src/popup/components/popups/NewTokenPopup.test.ts`
  (mock + 3 cases).

## Open items

None for this PR. The full handler-injection architecture + startup-
ordering guard is deferred to a separate arc.
