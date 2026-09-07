# Lessons — dedup-followups

Base: dev @ 49a58417. Scope: the three bugs the dedup stack pinned, plus ledger ids X5 and N5.

## Phase 1 — the three fixes ✓

- **Simulate rows**: `OperationActionRow.vue` is the send branch's row verbatim; both `send_transaction` and
  `simulate_transaction` loop it. The window already had `OperationCard.authwit.test.ts` pinning the authwit rendering
  on the send side — it went red until it registered the new child (vitest auto-registers nothing), and it now proves
  the extraction on the send side while `OperationCard.test.ts` proves the simulate side renders the same spender,
  label and args. The friendly label renders (`Transfer (public)`), not the raw method id — the first assertion got
  that wrong.
- **Token popup**: `:show="show && !!token"` — the state the swallowed render error used to produce, without the
  error; the suite now asserts an empty render and an untouched `errorHandler` before the fetch resolves.
- **Console hooks**: `nuloOn<method>` at the sniffer and its four writers (popup/onboarding through the forwarder,
  offscreen, the service worker); `types/console.d.ts` no longer overrides `Window.onerror`. The forwarder suite
  asserts `window.onerror` is left alone.
- Gate: lint 0 · extension typecheck 0 · execute window 7 files / 58 tests, token popup, logger and utils suites green.
