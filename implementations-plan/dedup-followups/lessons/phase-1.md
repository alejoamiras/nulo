# Lessons — dedup-followups

Base: dev @ 49a58417. Scope: the three bugs the dedup stack pinned, plus ledger ids X5 and N5.

## Phase 1 — the three fixes ✓

- **Simulate rows**: `OperationActionRow.vue` is the send branch's row verbatim; both `send_transaction` and
  `simulate_transaction` loop it. The window already had `OperationCard.authwit.test.ts` pinning the authwit rendering
  on the send side — it went red until it registered the new child (vitest auto-registers nothing), and it now proves
  the extraction on the send side while `OperationCard.test.ts` proves the simulate side renders the same spender,
  label and args. The friendly label renders (`Transfer (public)`), not the raw method id — the first assertion got
  that wrong. `windows/execute/` is not an auto-registration dir, so `OperationCard` imports the row explicitly (the
  tests had masked that by registering it themselves).
- **Token popup**: `:show="show && !!token"` — the state the swallowed render error used to produce, without the
  error; the suite now asserts an empty render and an untouched `errorHandler` before the fetch resolves.
- **Console hooks**: `nuloOn<method>` at the sniffer and its four writers (popup/onboarding through the forwarder,
  offscreen, the service worker); `types/console.d.ts` no longer overrides `Window.onerror`. The forwarder suite
  asserts `window.onerror` is left alone.
- Gate: lint 0 · extension typecheck 0 · execute window 7 files / 58 tests, token popup, logger and utils suites green.

## Phase 2 — X5 + N5 ✓

- `usePopupEntity` gained `submitKey` (default unchanged) because the two authwit popups confirm on a *global* Enter:
  they have no input, and the input-only predicate would have silently removed their keyboard path. Their handlers
  already own the latch and the fee check; Revoke's `submit` keeps the `!isErrorOccurred` gate the handler lacks.
- `useAuthRegistryStatus(service, account)` returns the same three refs the popups used to declare, so the submit
  paths keep writing `isLoading`/`error` through them; `fetch`/`reset` replace the copied scaffold; `dispose` is
  called from a new `onBeforeUnmount` (the popups never removed the handlers before — unobservable, since they
  persist). `NewTokenPopup` moved as-is: `onShow` = reset + fetch + preselect, `onHide` = abort + reset + three
  disconnects, `submitWaitsForShow` for the install-after-fetch timing.
- The three popup suites (Enter gates, latch pins, the token flow) passed unchanged; `usePopupEntity.test.ts` gained
  the `submitKey` case; `useAuthRegistryStatus.test.ts` has seven cases.
- Gate: lint 0 · extension typecheck 0 · 5 suites / 47 tests + the execute window again · `build:chrome` 0 with the
  regenerated auto-import declarations committed.

## Phase 3 — docs ✓

Ledger rows X5 and N5 marked done; plan phases ✓.

## Phase 4 — full local gate

(pending)

## Codex fix loop

(pending)
