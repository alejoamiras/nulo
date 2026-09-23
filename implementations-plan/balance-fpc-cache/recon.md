# Recon — balance-fpc-cache (Phase 0.4)

Three read-only scouts against clean `dev` (post-#345). Condensed; full transcripts were session-local.

## 1. The consumer landscape

**Machinery inventory (what lifts vs stays):**

- `FeeSettingsCard.vue` LIFTABLE: client instances (:233-237), init coalescing `initInFlight/initRequested/isMounted` (:244-246, 314-333), `rawRequests` per-identity single-flight + `reuseRawRequest` (:257-281), identity snapshot + drift guard (:344-348, 390-394), `committedKey` gate keying (:295, 350-355), `lastGoodFpcKey` retention (:289, 399-405), silent retry backoff (:254-256, 297-312), `withTimeout` call sites (:379-388), `Promise.allSettled` two-leg fetch, raw `gasBalances`/`registeredFpcs`/`error`/`isLoading` state.
- `FeeSettingsCard.vue` STAYS: `isInitComplete` gate, `derivedSettings`, `feeJuiceMissing` + `needsFeeJuice` v-model, `methods` computed, selection state + persistence, `resolveSavedSelection` reconcile, `baseline`/user-picked-during-init race guard, FPC-deleted/renamed selection reactivity, price/fiat, template.
- `GasBalanceCard.vue` LIFTABLE: client instance, peek-then-fetch flow (:104-121), `loadGeneration` guard, `hasLoaded` first-load gate, tx-event force refresh (:78-86, 124-127). STAYS: `isStale`/`isRefreshing` *display* semantics, optimistic deduction (:64-76 — component-local, additive), formatting/fiat, template.

**All consumers of the surfaces** (beyond the two cards): `send.vue` + `execute/index.vue` own ExecutionServiceClients for estimation/execution only (never balances); `OperationCard.vue` mounts one `FeeSettingsCard` per operation → N independent machinery instances per execute batch (strongest lift case); `getFpcs` UIs: `EditFpcPopup`, `NewFpcPopup`, `SelectFpcPopup`, `settings/fpcs/index.vue` (via `useEntityCrud`), `security/export/full.vue`. ≥9 independent client instantiation sites total.

**Test-pin migration map:** `fee-helpers.test.ts` pure/portable; `gas-balance-reader.test.ts` untouched (SW-side); `GasBalanceCard.test.ts` mostly behavioral (mock re-point only); `FeeSettingsCard.test.ts` has implementation pins needing mechanical migration — client-module mocks, raw-call-count assertions (:740-780, 904-911), fake-timer pins on `INIT_FETCH_TIMEOUT_MS`/`INIT_RETRY_BACKOFF_MS`, event-handler reach-ins (`vi.mocked(FpcServiceClient).mock.results`).

**Collision risks:** (1) SW-side `GasBalanceReader` ALREADY owns TTL/single-flight/peek/epoch — the popup cache must not duplicate its role (popup job = instance coalescing + retry/degraded UX + one connection); (2) key-shape mismatch: popup `reqKey` includes profileId, SW key is `networkId:accountAddress`; (3) `formatGasBalance` duplicated in `GasBalanceCard.vue:38`; (4) tx-settle invalidation triggered from THREE places (SW facade, GasBalanceCard subscription, FeeSettingsCard not at all — a latent inconsistency to preserve deliberately); (5) per-component coalescing exists BECAUSE shared-port contention once caused a 60s-timeout regression (comment at `FeeSettingsCard.vue:239-243`) — centralizing must preserve coalescing; (6) `wallet-bridge/src/fee.ts:36-41` is THE canonical `GasBalances` (re-exported via execution spec/models) and `fee-helpers.ts:26-29` is a hand-written duplicate.

## 2. Patterns to follow

- **Event plumbing exemplar** (token-balance): spec `Events` type → service `extends Service<Methods, Events>` + `EventHandler` fields + `this.emit(...)` → client `extends ServiceClient<Methods, Events>` → component `.onX.add(...)`. `emit` both wire-broadcasts to every connected port AND invokes locally (`extension-messaging/src/core/base-service.ts:128-132`). Clients auto-reconnect; lazy-connect on first RPC; **event-only consumers must call `.connect()` explicitly** (`GasBalanceCard.vue:160` precedent).
- **`usePrices`** is a thin per-consumer projection over a SW-side cache (NOT itself shared): primes via `refreshIfStale` on create + on `onConnected` (SW-restart resilience), subscribes `onQuotesUpdated`, staleness recomputed via the module-singleton ref-counted `useTicker`.
- **The convention-correct home for shared popup state that owns a connection is a Pinia store**, NOT a composable (C1 rule bars composables from connect/disconnect). Live precedents: `app.store.ts:186-253` (`inFlightJournal` — connect-once behind a guard, resubscribe on `onConnected`, never disconnects, app-lifetime) and `activity.store.ts` (scoped-key `Map` cache, LRU `MAX_CACHED_SLICES=32`, `mutationVersion` per key rejecting stale in-flight fetches racing live events). `utils/core.ts` `managers` is the pre-Pinia variant.
- **ExecutionService has ZERO event support today** (no `Events` in spec/service/client). Adding is mechanical; `FpcService` already has full events (`onFpcAdded/Updated/Deleted`).
- Note: popup and execute window are **separate documents** → separate Pinia instances → a popup-side store is per-document; cross-document dedup remains the SW reader's job (already does it).

## 3. Wire-shape ripple (`publicFeeJuice: string → string | null`)

**Producers:** `gas-balance-reader.ts:128-140` public leg fallbacks `"0"` → `null` (two spots: catch + not-found ternary); header comment update. Types: `packages/wallet-bridge/src/fee.ts:36-41` (canonical) AND the hand-copy `fee-helpers.ts:26-29` (collapse into an import or edit lockstep). Invalidation/epoch logic value-agnostic — zero touchpoints (verified).

**Consumer table (the load-bearing ones):**

| Site | On `null` |
|---|---|
| `fee-helpers.ts:96` `settingsForMethod` "fj" | **MUST add null → fail closed.** Today `=== "0"` fails closed only because failures fabricate "0" — flipping the producer without this = FAIL-OPEN (derive fj settings from unverified balance; the #342 skipFeeEnforcement footgun via a new path). Producer flip + this guard must land atomically. |
| `fee-helpers.ts:167` `buildFeeMethods` | disable fj on null too; optional honest `disabledReason` split ("couldn't check balance" vs "no balance") |
| `GasBalanceCard.vue:72` optimistic deduction | **MUST guard — `BigInt(null)` throws** (swallowed by EventHandler → silent no-op regression; currently untested path) |
| `FeeSettingsCard.vue:112` formatted computed | explicit null pass-through (else `formatGasBalance`'s `?? "0"` re-fabricates); `FeeMethodRow` already renders `'—'` for null and documents it |
| `GasBalanceCard.vue:38,40` display | null renders "0 FJ" via `?? "0"` unless made honest ('—') |
| `feeJuiceMissing` fj branch + nudge chain | already correct (`null !== "0"` → no nudge) — verify-don't-touch; chain: FeeSettingsCard:151-174 → `needsFeeJuice` model → `send.vue:572,577-586` CTA |
| SW fee strategies / executors | zero reads of GasBalances (verified) — out of scope |
| e2e | no direct assertions on the shape (verified) |

**Test updates:** `gas-balance-reader.test.ts` two assertions ("0"→null); `fee-helpers.test.ts` add fj-null cases (settingsForMethod + buildFeeMethods — zero null-public coverage today); `FeeSettingsCard.test.ts` null-public nudge-negative + degraded variant resolving null; `GasBalanceCard.test.ts` NEW optimistic-deduction test (path currently untested); `FeeMethodRow.test.ts` symmetric fj '—' case.

**Out-of-scope homonyms:** `bridge-core` `publicFeeJuicePayment` (function, naming coincidence); faucet `fuel-claim-state.ts` has its own bigint-null shape (separate app).
