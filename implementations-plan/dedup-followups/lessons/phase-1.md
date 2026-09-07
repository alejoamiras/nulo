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


## Phase 4 — full local gate ✓ (0521d179)

`bun run lint` 0 · `bun run typecheck:all` 0 · `bun run test` 0 (470 files / 5,741 tests) · `build:chrome` 0 · generated
`src/types/` unchanged.

## Codex fix loop (`/codex high`, GPT-6 Astra, session `01a07da0-9fc0-7662-a002-0f8b5071df1e`, resumed each round)

- **Round 1** (on 0521d179): *"no new material findings"* — the extracted row matched the send branch after
  normalisation, X5 preserved timing/predicates/latches/order, N5 kept the live account comparison, no executable
  reader of the old hook names anywhere. Low items adopted: the authwit case asserts the contract address and a
  control-character + overlength arg (sanitised, capped at 48 + ellipsis); both card suites stopped registering
  the row child (production imports it; the registration had masked that); `usePopupEntity` docs say the
  input-only Enter guard is the default; the two authwit popups lost the stale "caller-side duplication" wording;
  the token popup, row and `safeWire` comments are one sentence each (the last now states the control stripping
  and the ellipsis). Test gotcha: a fallthrough `data-testid` on a stub overrides the stub`s own, so the address
  stubs are selected by their `data-address` attribute.
- **Round 2** (on 02cbdabc): *"no new material findings"* — every round-1 item verified, the strengthened cases
  judged proportionate, no new teardown or focus regression, no executable reader of the old sink names. Loop
  converged in two rounds.

## Full gate re-run on the converged tree (02cbdabc) ✓

`bun run lint` 0 · `bun run typecheck:all` 0 · `bun run test` 0 (470 files / 5,741 tests) · `build:chrome` 0 · generated `src/types/` unchanged.
