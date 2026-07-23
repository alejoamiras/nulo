# Incoming sync indicator — "Catching up…" on the token card

Follow-on to `incoming-public-transfers` (§3, deferred there). A per-token affordance that shows the
token is **cold-start backfilling** its incoming public-transfer history (hydrating from far back), NOT
the steady every-30s poll. Design was approved by the owner (pulsing dot + "Catching up…", escalate to
a shimmer when the balance is still unresolved).

## Problem

The public-event scan (`IncomingTransferService`, D3) runs a per-`(networkId, contract)` cursor forward
from `startBlock` to the checkpointed tip. On a fresh account/token add or a service-worker restart, that
cursor can be far behind the tip and takes several budgeted passes to catch up. Today the UI shows
nothing — a user who just added a token sees no receipts + no indication the wallet is still pulling
history, which reads as "broken / nothing here" rather than "catching up."

## Signal (service)

A per-`(networkId, contract)` derived state, computed from data the scan ALREADY reads each tick (no
extra node call):

- `checkpointedBlockNumber` from `getScanTips` (the scan reads this every pass for its bounds).
- the persisted `PublicScanCursor.cursor` position (`{ blockNumber, … } | null`).

**State:**
- `backfilling` when `cursor === null` (never scanned yet, tip non-trivial) **OR**
  `checkpointedBlockNumber − cursor.blockNumber > CAUGHT_UP_THRESHOLD_BLOCKS`.
- `caught-up` otherwise.

`CAUGHT_UP_THRESHOLD_BLOCKS` is small (the steady poll only ever lags by ~1 tick's worth of blocks;
cold-start gaps are hundreds–thousands). A generous single-digit threshold cleanly separates the two and
tolerates the tip advancing during a pass. Named constant, documented.

Computed + emitted at the natural points where the cursor + tips are both in hand:
- after each `forwardScanOnce` / scan tick (cursor just advanced),
- when a public scheduler (re)starts / on `init` hydrate (initial snapshot).

## Surface (extension-messaging)

`IncomingTransferService` gains:
- Event `onIncomingSyncStateChanged: { networkId, contract, state: "backfilling" | "caught-up" }`
  (per-contract — the scan serves all accounts; the token card keys on `token.contract` + active
  `networkId`). Emitted only on a state TRANSITION (dedupe: hold the last emitted state per key so a
  steady poll doesn't spam `caught-up`).
- Method `getSyncState(networkId, contract): "backfilling" | "caught-up"` for the initial snapshot on
  mount (parallels `getTrustState`). Returns `caught-up` for an unknown/never-scanned-with-a-tip key
  (fail toward "no indicator" so we never show a stuck spinner).

Wire through client passthrough list + `rpcMethods` + the client-side `EventHandler`, with the existing
exhaustiveness drift-guards.

## UI

Parallels how `isUpdating`/`isMinting` are grafted today (Task service → `TokensView` → `TokenCard`):

- **`TokensView.vue`** subscribes to `onIncomingSyncStateChanged`, keeps a `Map<contract, state>`, and
  seeds it on mount / account / network change via `getSyncState` per token. Grafts a `backfilling`
  boolean onto each token row (or passes the map) → threads into `<TokenCard>`. Teardown mirrors the
  existing `.remove()`/`disconnect()` in `onBeforeUnmount`.
- **`TokenCard.vue`** gains a `backfilling` prop and renders, as a sibling of the existing `isInitialSync`
  loading block:
  - `backfilling && !isInitialSync` → **pulsing dot + "Catching up…"** caption. Reuse the
    `@keyframes blink` opacity-pulse (from `BalanceView.vue`), dot tinted `--nulo-accent` (dark cream).
  - `backfilling && isInitialSync` (balance ALSO unresolved) → **escalate to the shimmer** — clone the
    reduced-motion-safe `--bezier` shimmer from `received/[id].vue`.
  - neither → today's behavior unchanged.
  New `data-testid`s: `token-catching-up`, (shimmer already implicitly covered).

## Security & adversarial considerations

- **No new node calls / no new data to the RPC** — the state is derived from the tips read the scan
  already performs and the local cursor. So this adds ZERO marginal network footprint / correlation
  surface (unlike the fee fetch). Note this explicitly in the audit prompt.
- **Fail toward "no indicator"**: any gap in the signal (unknown key, tips read failed, cursor missing)
  resolves to `caught-up` so a bug can never strand a token in a permanent "Catching up…" spinner.
- **Hostile/racey inputs**: the state is per-`(networkId, contract)`; a chain purge / profile switch /
  account change must reset or stop emitting for the gone keys (reuse the epoch + scheduler teardown
  already in place). No persisted shape change → no migration (pre-production rule still holds).
- **Transition-only emit** prevents an event storm from steady polling.

## Phases

1. **Service signal** — derive + store per-key state, emit on transition, `getSyncState` method, client
   passthrough + drift-guards. Unit tests (backfilling↔caught-up transitions, threshold boundary, fail-
   toward-caught-up, purge/epoch reset, transition-only dedupe).
2. **UI** — `TokenCard` prop + pulsing-dot/shimmer states (+ component tests), `TokensView` subscription
   + grafting + teardown.
3. **Validation + audit** — `bun run audit:vue`; codex `gpt-5.6-sol` xhigh audit cycle until satisfied;
   address findings; `bun run test:e2e` smoke (token card renders). E2E for the live backfill is optional
   (hard to force a large gap deterministically) — pin the state logic at the unit layer.

## Validation gates

- `bun run audit:vue` exit 0.
- New unit tests green (service signal + TokenCard component).
- Codex audit cycle → satisfied, high/critical addressed.
