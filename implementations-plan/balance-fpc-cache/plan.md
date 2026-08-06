# balance-fpc-cache — service-level balance/FPC cache for the extension popup

**Tier**: `/blueprint mid` (rubric: novelty LOW; blast radius MEDIUM — send flow, execute window, home card; irreversibility LOW; migration NONE; external coupling NONE; security MEDIUM-mapped. ≤1 high → mid.)

**Success bar** (owner-set): behavior-preserving. Every existing test pin keeps passing (mechanically migrated where implementation-pinned, per `recon.md` §1), UX identical — except the explicitly-approved wire-shape honesty ripple ("Approved deviations"). The refactor proves itself by deleting component machinery with no other visible change.

**eli5_mode**: artifact

**APPROVED 2026-08-06 (owner)**: full approve. Ask 1 (deviation 4, nudge honesty) — **approved**. Ask 2 (SW cross-profile leak fix, D12) — **approved**. No conditions; the plan implements as written (no reject branches taken).

## Summary

`FeeSettingsCard.vue` and `GasBalanceCard.vue` each own a private copy of balance/FPC fetch machinery (init coalescing, per-identity single-flight with timeout-survivor raw-request reuse, retry backoff, SWR peek, generation guards) accumulated across #342/#343. This plan lifts the fetch layer into one Pinia store that owns app-lifetime service clients and a profile-scoped keyed cache with split gas/fpc slices, makes the two cards subscribers with declared capabilities, and fixes the fabricated-`"0"` wire-shape debt (`publicFeeJuice: string | null`). The SW-side `GasBalanceReader` keeps its role (TTL, cross-popup dedup, invalidation epochs) untouched.

## Approved deviations (the wire-shape honesty ripple — the ONLY user-visible changes)

1. A failed public-balance read displays `— FJ` instead of a confident `0 FJ` (GasBalanceCard + FeeMethodRow). *Pinned.*
2. `buildFeeMethods` disables the fee-juice row on unknown balance with reason `"couldn't check balance"` (vs `"no balance"` for confirmed zero). **Corrected during Phase 1 red-testing**: fable's inferred saved-selection fallthrough does NOT occur — `resolveSavedSelection` runs against pre-commit methods (balances not yet applied), so a saved fj selection stays selected with no derived settings, exactly as today with the fabricated "0". Pinned as actually preserved: no settings derive, no nudge, sponsored one click away.
3. The get-fee-juice bridge nudge fires ONLY on a confirmed zero. **Deviation 4 (fable audit — needs explicit owner sign-off at the gate): today the nudge DOES fire after a failed public read** (the fabricated "0" is indistinguishable from a real zero), telling a possibly-funded user to go bridge. Post-flip it correctly stays quiet on unknown. This is an honesty IMPROVEMENT but a visible change beyond the original three. *Pinned.*

Everything else is pixel-identical.

## Architecture & Implementation (v2 — post round-1 audits)

### Proposed architecture

```
[SW]     GasBalanceReader (UNCHANGED role). Wire-shape change only: public leg
         fallbacks "0" → null.

[popup]  NEW stores/balances.store.ts (Pinia, per-document):

  Scope key (D3 REVERSED): structured { profileId, networkId, chainId,
  accountAddress }, serialized for the Map. profileId kept — getFpcs() is
  PROFILE-FILTERED data (fpc/service.ts:132); a profile-free key could serve
  profile A's FPC list to profile B (both audits, blocking). Additionally a
  store-level profile EPOCH (activity.store mutationVersion pattern): profile
  switch bumps the epoch AND clears the map; a fetch that started under an
  older epoch discards its commit (kills the mid-switch in-flight
  repopulation race). Clear-on-switch is a PINNED invariant, not hygiene.

  Split slices (codex blocking finding, refined by the fresh pass): each
  entry holds TWO independent sub-states — entry.gas and entry.fpc. The gas
  slice separates DISPLAY data from VERIFIED data (fresh-pass finding 2):
    gas: { display?: GasBalances,   // last-known, SWR-retained across failed
                                    // refreshes — what GasBalanceCard renders
           verified?: GasBalances,  // cleared to undefined by a failed
                                    // refresh — the ONLY thing ensure()
                                    // snapshots return for gating
           status, version, retryVersion, retryDebt: boolean, lastError }
  A stale peek can keep painting the home card while fee gating correctly
  sees unknown — one field can't express both guarantees. Peek commits are
  version-guarded: a late peek NEVER overwrites a newer fetch/forced commit.
  Versions are CAUSE-SPECIFIC two ways: tx-settle refreshes bump gas.version
  only, and the degraded-recovery signal is `retryVersion`, bumped only by
  retry-path commits. RETRY DEBT is tracked independently of slice status
  (fresh-pass finding 3): a failed retry-capable ensure sets retryDebt; the
  backoff loop runs while retryDebt && a retry-capable subscriber holds the
  key; ONLY a successful retry-path commit clears it — a coexisting tx
  refresh going ready neither stops the loop nor re-commits the degraded
  card (today a tx settle does nothing for that card; each retry is cheap —
  it lands on the SW TTL cache). FeeSettingsCard's degraded-recovery watch
  observes exactly the retryVersions of slices it committed degraded — never
  transaction-live (D4 structural, pinned).

  Fetch pipeline (lifted, not reinvented): per-key/per-leg single-flight AND
  per-leg RAW-PROMISE REUSE ported verbatim from reuseRawRequest — a leg
  whose withTimeout wrapper fired keeps its raw RPC promise keyed and
  UNSETTLED; the next attempt re-attaches a fresh timeout to the SAME raw
  promise (both audits, blocking: plain single-flight settles at timeout and
  would re-stack uncancellable pre-connect RPCs). TWO exceptions to reuse
  (codex round 2): (a) FORCED refreshes (tx-settle) never join a raw flight
  that predates the trigger — the forced path waits out any live raw flight
  and re-enters, mirroring the SW reader's own force semantics ("force
  refresh never joins a pre-invalidation flight" is a Phase 2 test); (b) raw
  flights are EPOCH-STAMPED — a new-epoch attempt never re-attaches to an
  old-epoch raw promise (else old-profile FPC data gets blessed under the
  new epoch). Per-leg allSettled isolation; lastGoodFpc retention per key;
  peek (peekGasBalances) primes entry.gas + stale, but ONLY for subscribers
  that request it (caps.peek — GasBalanceCard true, FeeSettingsCard false:
  the send flow never issued a peek RPC today and must not start).

  Subscriber capabilities (codex Asks, resolved): subscribe(key, caps) with
  caps = { legs: ("gas"|"fpc")[], retry: boolean, txRefresh: boolean }.
  Union of live caps per key drives the loops:
    - FeeSettingsCard subscribes { legs: [gas, fpc], retry: true,
      txRefresh: false, peek: false }
    - GasBalanceCard subscribes { legs: [gas], retry: false, txRefresh: true,
      peek: true }
  Consequences, all matching today's traffic BY CONSTRUCTION: a GasBalance-
  Card-only mount never fetches FPCs and never backoff-retries (today it has
  neither); the backoff loop runs only while a retry-capable subscriber holds
  the key (today: FeeSettingsCard mounted); tx-settle refreshes the GAS slice
  only, and only for keys with a txRefresh-capable subscriber (today: only
  GasBalanceCard reacted). Backoff attempt state is per-key and dies with the
  key's last retry-capable release (today: reset on identity change / death
  on unmount or embedded-mode early-return — the card releases on BOTH).

  Store-owned subscriptions: ONE TransactionServiceClient (explicit
  connect()) for onTransactionUpdated → settle → FORCED gas refresh per caps.
  The store does NOT subscribe to FPC events in this plan (behavior-
  preserving: no consumer refreshes the fpc LIST on FPC events today;
  FeeSettingsCard's event reactivity is about its SELECTION and stays in the
  card — see cards). Store clients: ONE ExecutionServiceClient + ONE
  FpcServiceClient, connect-once behind a guard, never disconnected
  (app.store inFlightJournal precedent). NO reconnect re-prime (codex round
  2): today's cards do nothing on SW restart until their own next trigger —
  the store likewise does nothing on onConnected (usePrices' re-prime is
  that composable's behavior, not these cards'). Subscribe ALWAYS triggers
  ensure (every card mount = one getGasBalances RPC served from the SW TTL
  cache — today's exact per-mount pattern). LRU cap 32; SUBSCRIBED keys are
  never evicted.

  API: subscribe(key, caps) → { release() } (idempotent disposer);
  ensure(key, { legs, forceRefresh }) → Promise<EntrySnapshot> (settles when
  the requested legs settle, ready OR degraded); entry(key) → readonly
  reactive entry. Callers never build map keys by hand — the store exports
  scopeKeyFor(identity).

[cards]  GasBalanceCard: renders the reactive gas slice (isStale/isRefreshing
         derive from entry.stale/gas.status); KEEPS a TransactionServiceClient
         subscribed to onTransactionAdded for the optimistic deduction, which
         becomes a CARD-LOCAL DISPLAY OVERLAY (a ref subtracted at render;
         null-guarded) — it never mutates the shared entry (fable: shared-
         entry mutation would leak deducted balances into FeeSettingsCard
         snapshots). Deletes: execution client, peek flow, loadGeneration,
         hasLoaded plumbing, its onTransactionUpdated refresh (moves to store).

         FeeSettingsCard: KEEPS its entire commit/gate layer (isInitComplete,
         committedKey, identity-drift guard, derivedSettings, selection state,
         saved-selection reconcile, degraded row) AND its FpcServiceClient AS
         AN EVENT-ONLY CLIENT (explicit connect) for onFpcUpdated/onFpcDeleted
         SELECTION reconciliation — that reactivity is a STAYS item and never
         routes through store versions (codex blocking finding). runInit:
         subscribe(key, caps) + await ensure(key) → commits a SNAPSHOT into
         local refs (never live-binds). Degraded recovery: watch the committed
         key's DEGRADED slice versions only; on bump, re-run the commit path
         (drift-guarded). Releases its subscription on unmount, on the
         embedded-mode early-return path (preserving today's retry-chain
         death + useOwnMethod revival), AND — codex round 2 — RELEASE-BEFORE-
         SUBSCRIBE whenever the structured scope changes (account/network
         switch within a profile must not leave the old key subscribed and
         retrying; A→B and A→B→A are Phase 2/4 tests). Deletes: execution
         client, fetch legs, initInFlight/initRequested, rawRequests, retry
         timers, withTimeout call sites.
```

### Key interfaces / types

```ts
// stores/balances.store.ts (NORMATIVE — every field advertised in the architecture)
export interface BalanceScope { profileId: string; networkId: string; chainId: number; accountAddress: string }
export type SliceStatus = "idle" | "fetching" | "ready" | "degraded"
export interface GasSlice {
  display?: GasBalances        // last-known (SWR): survives failed refreshes; version-guarded peek commits
  verified?: GasBalances       // cleared by a failed refresh; the ONLY gating-grade data
  status: SliceStatus
  version: number              // any commit
  retryVersion: number         // retry-path commits only (degraded-recovery signal)
  forcedVersion: number        // SUCCESSFUL forced (tx-settle) commits only — the D9 overlay-reset
                               // signal (a failed force does not bump it: overlay retained, pinned)
  retryDebt: boolean           // set by failed retry-capable ensure; cleared only by a successful retry-path commit
  lastError?: string
}
export interface FpcSlice { data?: FpcInfo[]; status: SliceStatus; version: number; retryVersion: number; retryDebt: boolean; lastError?: string }
export interface BalanceEntry { gas: GasSlice; fpc: FpcSlice; stale: boolean; epoch: number }
export interface SubscribeCaps { legs: ("gas" | "fpc")[]; retry: boolean; txRefresh: boolean; peek: boolean }
// ensure() resolves an epoch-stamped snapshot { scope, epoch, gas: { verified }, fpc: { data } }.
// On epoch staleness it REJECTS with the typed EnsureSuperseded — it never re-enters and never
// resolves cross-epoch; only a live lease for the exact scope may retry.

// wallet-bridge fee.ts (canonical wire shape) — THE debt fix:
export type GasBalances = {
  readonly publicFeeJuice: string | null   // null = unknown (read failed/timed out)
  readonly privateFeeJuice: string | null
}
// fee-helpers.ts's hand-copied GasBalances interface is DELETED (import the canonical type).
```

### Data & control flow (critical path: send page opens)

1. `FeeSettingsCard.runInit` (entry conditions unchanged) → `subscribe(key, caps)` + `await ensure(key, { legs: ["gas","fpc"] })`.
2. Store: epoch-stamped fetch → per-leg raw-reuse single-flight → per-leg commit (slice versions bump independently) → ensure resolves with a snapshot.
3. Card: identity-drift guard (unchanged) → commits the snapshot → gate opens (committedKey semantics unchanged).
4. Degraded: store backoff (retry-capable subscriber present); recovery bumps the degraded slice's version; the card's watch re-runs its commit. Unmount/embedded → release → backoff dies (today's pins).
5. GasBalanceCard renders the same entry's gas slice reactively — instant paint from the peek-primed entry; its deduction overlay subtracts locally.

### File-level change map

- MODIFY `packages/wallet-bridge/src/fee.ts` — wire shape.
- MODIFY `apps/extension/src/wallet/services/execution/gas-balance-reader.ts` — public-leg null fallbacks + comment.
- MODIFY `apps/extension/src/wallet/services/execution/service.ts` — D12 (Ask 2): active-profile-change subscription → `gasBalances.invalidateAll()`, wired in `init()` alongside the existing invalidation subscriptions; proven by a facade/composition-level test (a reader unit test cannot see the wiring — fresh-pass v3).
- ADD `apps/extension/src/stores/balances.store.ts` + `balances.store.test.ts`.
- MODIFY `apps/extension/src/popup/components/modules/send/fee-helpers.ts` — delete hand-copied type; `settingsForMethod` fj null fail-closed; `buildFeeMethods` null-disable + reason; `withTimeout` + timing constants MOVE to the store module.
- MODIFY `FeeSettingsCard.vue`, `GasBalanceCard.vue` per architecture.
- MODIFY tests per recon §3 + mechanical migration per recon §1, under the testing directive below.
- UNCHANGED: execution spec/service/client (no events — D2), FpcService, `getFpcs` CRUD UIs, send.vue/execute window.

### Testing directive (both audits, adopted verbatim)

- Phases 3/4 test against the REAL Pinia store with mocks at the CLIENT layer (`vi.mock` of `@/wallet/services/*/client`), never `createTestingPinia`-stubbed store actions — stubbing the store guts the pins.
- The raw-RPC non-accumulation pin stays anchored at CLIENT-call counts (a hung `getGasBalances` is called exactly once across a retry-after-timeout cycle) — never re-anchored to store-level fetch counts.
- Both cards are plain-JS SFCs: typecheck cannot see their null handling, and `null === "0"` typechecks even in TS — the red-first tests are the ONLY guard on the fail-open landmine. Phase 1's tests are load-bearing, written before the producer flip.
- Phase 2 store suite must include (codex rounds 1+2 + fresh pass): A→B→A profile/identity flap with late completion discarded AND no cross-epoch raw reuse AND ensure's snapshot never cross-epoch; hung-RPC client-call counts across retries; forced refresh never joins a pre-trigger raw flight; identity-change release-before-subscribe (A→B, A→B→A at account/network level); capability-union and release-transition behavior (0→1 backoff reset, 1→0 death); alternating-leg last-good-FPC retention; LRU never evicting subscribed keys; the traffic matrix (GasBalanceCard-only: no fpc fetch, no retry, peek yes; FeeSettingsCard-only: no tx-refresh, no peek); tx-settle bumps gas.version but never retryVersion; **coexistence** (degraded retry-capable subscriber + successful tx refresh: retryDebt persists, loop continues, degraded card NOT re-committed); **late-peek ordering** (a stale peek never overwrites a newer fetch/forced commit); **display-vs-verified split** (failed refresh: display retained, verified cleared); **retry-debt lifecycle** (only a retry-path success clears it; a tx-refresh failure creates none).
- Phase 3 additionally pins the **overlay reset** (D9) via `gas.forcedVersion`: the optimistic-deduction overlay clears only when forcedVersion bumps (successful forced commit) — a FAILED forced refresh retains the overlay (pinned), and generic gas.version bumps never clear it (pinned).
- Phase 2 additionally includes the **A-pending→B supersede test**: a pending profile-A ensure, superseded by B, performs no further fetch and no commit under A (cancels with `EnsureSuperseded`).

### Algorithms / non-obvious mechanics

- **Per-leg raw-promise reuse** (ported): map raw RPC promises per (key, leg); `withTimeout` wraps per attempt; a timed-out attempt leaves the raw promise keyed; settle clears it. Identical to `reuseRawRequest` semantics including the unhandled-rejection probe.
- **Epoch fence (v3, fresh-pass finding 4)**: there is no single identity source (send reads appStore; execute-window cards read props), so the fence is decoupled from "watching the active profile": the store keeps a per-profileId epoch; `subscribe`/`ensure` carry the caller's full identity; a SYNCHRONOUS appStore profile watcher (belt) plus last-subscriber-release (suspenders) bump the departing profile's epoch and clear its entries. Fetches AND raw flights capture the epoch at start; commit requires epoch equality; cross-epoch raw reuse is forbidden; and a superseded `ensure` **CANCELS — it never re-enters** (fresh-pass v3 finding: `getFpcs` binds to the SW's ACTIVE profile, not the caller's claimed profileId, so a stale profile-A ensure re-entering under A's bumped epoch could fetch B's FPCs and validly cache them under A). A cancelled ensure rejects with a typed `EnsureSuperseded` error; the card's existing drift guard already treats that as a discarded run. Only a LIVE lease — an active subscription for the exact scope — may retry. Tests: A→B→A (non-commit, non-reuse, no cross-epoch resolution) AND A-pending→B (the superseded A ensure performs NO further fetch and NO commit under A). The interface section below is normative and includes every advertised field.
- **Snapshot commit + slice-scoped recovery watch**: the two mechanisms that make FeeSettingsCard's non-reactivity structural (can't observe versions it didn't commit degraded).
- **Backoff parity**: per-key attempt counter; reset when the key's retry-capable subscriber set transitions 0→1 (a card arriving on a new identity = today's reset-on-identity-change); cleared at 1→0 (unmount/embedded = today's chain death).

### Trade-offs & alternatives not taken

- **Push events on the execution service** — deferred (D2), unchanged from v1.
- **Composable-only outline B** — rejected, STRENGTHENED (fable): beyond the C1-rule argument, `base-client.ts:213` `disconnect()` rejects all in-flight requests — shared in-flight maps over component-owned clients means one card's unmount poisons promises another card joined. B's smaller diff buys a new cross-component failure mode.
- **Unified entry version** — rejected (codex round 1 blocking): conflates causes; either makes FeeSettingsCard tx-live or loses FPC-event selection reactivity. Split slices + cause-specific versions.
- **Profile-free cache key** — rejected (both audits): FPC data is profile-filtered.

## Phases

### Phase 1 ✓ — Wire shape + SW cross-profile fix, atomically with their guards
*(gate passed 2026-08-06: `bun run audit:vue` exit 0, 3758 tests; lessons/phase-1.md)*
Producer flip + fail-closed `settingsForMethod` guard + `buildFeeMethods` null-disable + `BigInt(null)` deduction guard + display honesty + hand-copied-type deletion, in ONE phase, tests red-first (they are the only guard — see testing directive). Includes the deviation-2 fallthrough pin and the deviation-4 nudge pin. **Plus (Ask 2, fresh-pass critical): the SW-side cross-profile fix** — `ExecutionService` subscribes to active-profile change and calls `gasBalances.invalidateAll()` (matching its existing invalidation-subscription style), closing the pre-existing leak where `GasBalanceReader`'s profile-free cache serves profile A's PrivateFPC balance to profile B for up to the TTL. A facade/composition-level test pins the WIRING (profile-change event → invalidateAll observed through the service — a reader unit test cannot see it).
**Gate**: `bun run audit:vue` exit 0. Layers: typecheck/lint/unit/component.

### Phase 2 ✓ — The store, test-first
*(gate passed 2026-08-06: `bun run audit:vue` exit 0, 3778 tests, store suite 20/20; lessons/phase-2.md)*
Full pipeline per architecture v2 (structured scope, epoch fence, split slices, raw-reuse, capabilities, tx-settle subscription, LRU-with-subscribed-exemption). New `balances.store.test.ts` porting semantic pins + the codex-mandated suite (testing directive).
**Gate**: `bun run audit:vue` exit 0; store test file green explicitly. Layers: typecheck/lint/unit.

### Phase 3 ✓ — GasBalanceCard onto the store
*(gate passed 2026-08-06: `bun run audit:vue` exit 0, GasBalanceCard suite 13/13 incl. the D9 overlay-reset trio; lessons/phase-3.md)*
Subscriber rewrite ({legs:[gas], retry:false, txRefresh:true, peek:true}); deduction → card-local overlay with retained tx-added subscription, cleared via `gas.forcedVersion`; delete fetch/generation machinery. Mocks re-pointed at the client layer against the real store.
**Gate**: `bun run audit:vue` exit 0, all GasBalanceCard pins green. Layers: typecheck/lint/component.

### Phase 4 ✓ — FeeSettingsCard onto the store
*(gate passed 2026-08-06: `bun run audit:vue` exit 0, FeeSettingsCard suite 38/38 incl. the EnsureSuperseded no-op pin; two retry-traffic pins updated to the debt-scoped design — lessons/phase-4.md)*
subscribe+ensure+snapshot-commit+slice-scoped recovery watch; event-only FpcServiceClient retained; release on unmount AND embedded early-return; delete coalescing/rawRequests/timers. `runInit` explicitly catches `EnsureSuperseded` as a NO-OP before its generic failure handling (the post-await identity guard cannot observe a rejected promise) — pinned: a superseded ensure creates no degraded state and no retry. Pins migrated per recon §1 with client-layer anchoring (raw-count pins keep their meaning).
**Gate**: `bun run audit:vue` exit 0, all FeeSettingsCard pins green. Layers: typecheck/lint/component.

### Phase 5 — Cleanup, docs, end-to-end proof
Dead-code deletion, `formatGasBalance` dedup, README/CLAUDE.md touchpoints, `implementations-plan/index.md`.
**Gate**: `bun run audit:vue` exit 0 AND `bun run test:e2e` (smoke) green AND `bun run e2e:agent tests/e2e/network/fee-methods.test.ts` green locally (5/5). Layers: full ladder incl. e2e + live-network e2e.

**Post-implementation** (approved protocol): `/code-review max --fix` → separate commit → codex post-impl audit → fix loop → PR to dev → auto-merge babysit. No `/harden`.

## Security & Adversarial Considerations

- **Threat model**: no new trust boundaries; same SW services, same port. Balance readout is display + fee-method gating; fee strategies never read it (verified).
- **Fail-open landmine**: producer null-flip without the consumer guard = self-paid settings from unverified balance (#342 class; estimation runs `skipFeeEnforcement`). Mitigation: Phase 1 atomicity + red-first load-bearing tests (typecheck provably cannot catch this — fable S1). Independent consumer sweeps by both auditors found no further flip sites.
- **Cross-profile leak (found in round 1, designed out)**: profile-scoped keys + epoch fence + pinned clear-on-switch. Residual: none identified after the fence; the A→B→A late-completion case is an explicit Phase 2 test.
- **Least privilege / supply chain / crypto**: unchanged; no new deps.
- **Failure honesty**: unknown renders as unknown; the nudge no longer instructs possibly-funded users to bridge (deviation 4).

## Assumptions

**Facts** (verified; refs in `recon.md` + audits):
1. SW `GasBalanceReader` owns TTL/single-flight/peek/epochs; invalidation value-agnostic.
2. Canonical `GasBalances` in `packages/wallet-bridge/src/fee.ts:36-41`; `fee-helpers.ts:26-29` is a hand-written duplicate.
3. SW fee strategies/executors never read `GasBalances`; e2e has no shape assertions.
4. `settingsForMethod` fj fails closed on "0" today only because failures fabricate "0".
5. `BigInt(null)` throws in the deduction path; EventHandler swallows it; path untested today.
6. Connection-ownership precedent: `app.store.ts:186-253`; slice-map/mutation-fencing precedent: `activity.store.ts` (two DIFFERENT precedents — fable correction folded in).
7. ExecutionService has no events; popup/execute are separate documents.
8. Per-component coalescing exists due to the shared-port 60s-timeout regression.
9. `getFpcs` is profile-filtered (`fpc/service.ts:132`) — the round-1 blocking fact.
10. `base-client.ts:213`: `disconnect()` rejects all in-flight requests (the outline-B killer).
11. Both cards are plain-JS SFCs — no typecheck coverage of their null handling.

**Inferences** (attackable):
1. The epoch fence + profile-scoped keys close the cross-profile race completely (Phase 2 A→B→A test is the check).
2. Slice-scoped recovery watching + capability flags reproduce today's retry/traffic semantics exactly (Phase 2 traffic-matrix tests are the check).
3. Pin migration preserves discriminating power UNDER the testing directive (client-layer anchoring is what makes this safe — without it, false).
4. The execute window's RPC pattern strictly improves (N cards → 1 store fetch); popup-side traffic otherwise identical by the capability construction.

**Asks**: TWO for the gate —
1. Confirm **deviation 4** (the bridge nudge stops firing after failed balance reads; it previously did fire, misleadingly).
2. Confirm the **SW cross-profile fix** (fresh-pass critical finding): `GasBalanceReader`'s cache is profile-free while its private leg is profile-filtered — TODAY, switching profiles can serve profile A's cached PrivateFPC balance to profile B for up to 5 minutes. Recommended disposition (planned as Phase 1 scope): invalidate the SW cache on active-profile change — a one-subscription fix in the facade's existing style. This is a behavior/traffic expansion beyond the original scope (it fixes a live bug), hence the explicit Ask.

All other Asks from the audit rounds are resolved by the capability/slice design and documented above.

**Independent reject branches** (the Asks do not couple — fresh-pass v3): if Ask 1 (deviation 4) is REJECTED, the fj nudge branch also fires on `null` (`=== "0" || === null`), preserving today's misleading-but-familiar behavior, and its pin flips accordingly — no other phase content changes. If Ask 2 (SW fix) is REJECTED, the `service.ts` change and its composition test drop from Phase 1; the popup's epoch fence remains the sole (partial) mitigation and the residual SW-side leak is documented as accepted risk in the plan. Either rejection leaves the rest of the plan intact.

## Decision ledger

- **D1 — Pinia store, not composable singleton**: KEPT, strengthened (Fact 10: outline B's shared-promises-over-owned-clients poisoning).
- **D2 — No execution-service push events**: KEPT (per-document stores + SW dedup; events would change tx-settle visibility).
- **D3 — Cache key**: **REVERSED in round 1** (both audits, blocking): structured profile-scoped key + epoch fence + pinned clear-on-switch. Original rationale was wrong for the profile-filtered FPC slice.
- **D4 — Snapshot commits for FeeSettingsCard**: KEPT, made structural via split slices (can't observe undeclared versions).
- **D5 — Wire flip atomic with guards**: KEPT; tests promoted to load-bearing (typecheck blindness acknowledged).
- **D6 (new, codex) — Split gas/fpc slices with cause-specific versions**: replaces the rejected unified entry version.
- **D7 (new) — Subscriber capability flags** {legs, retry, txRefresh}: resolves all round-1 traffic/ownership Asks by construction.
- **D8 (new) — FPC events stay card-side (event-only client)**: selection reactivity is a STAYS item; the store fetches lists, never routes selection events.
- **D9 (new, fable; pinned per fresh pass) — Optimistic deduction = card-local overlay** + retained tx-added subscription; never shared-entry mutation; overlay clears only on a successful forced-refresh commit (pinned).
- **D10 (new, fresh pass) — Display/verified split in the gas slice**: one data field cannot serve both the home card's SWR retention and fee gating's fail-closed unknown; `ensure` returns verified-only.
- **D11 (new, fresh pass) — Cause-scoped retry debt** independent of slice status: coexisting subscribers can neither stop a degraded card's recovery loop nor trigger it.
- **D12 (new, fresh pass) — SW cross-profile invalidation** (Ask 2): fix the pre-existing reader leak at its source rather than fencing only the popup.
- **Unresolved disputes**: none — all findings across three codex rounds + fable converged and were adopted; two owner Asks remain open by design.

## Competing outline B (rejected — kept for the fresh-pass audit trail)

Composable-only, pull-only, minimal-diff: module-singleton composable sharing in-flight/cache maps over component-owned clients. Rejected on C1 convention AND Fact 10 (disconnect-poisoning of shared promises); retry/lifecycle ownership undefined. Both round-1 auditors independently rejected it harder than the draft did.

## Audit verdicts

- **Codex round 1** (transcript: `audit-codex.md`): **reject** — blocking: profile keying (→ D3 reversed), raw-RPC non-accumulation loss (→ ported verbatim), unified-version model (→ D6 split slices). All three designed out in v2; re-verdict below.
- **Fable round 1** (transcript: `audit-fable.md`): **conditional approve** — 5 conditions, ALL adopted (raw-reuse port + client-anchored pins; deduction overlay D9; D3 reversal; deviations 2b/4 enumerated + pinned; real-store/client-mock testing directive + typecheck-blindness acknowledgment).
- **Codex round 2 (resumed, on v2)** (`audit-codex.md`): **conditional approve** — 5 conditions, ALL adopted in v2.1: forced-flight path bypassing raw reuse (+test restored); identity-change release-before-subscribe (+A→B/A→B→A tests); retryVersion split so tx commits never trigger the degraded watcher (pinned); sync-flush epoch watcher + epoch-stamped raw flights (+non-reuse assertion); reconnect re-prime REMOVED and FeeSettingsCard peek disabled via caps.peek (both were traffic deviations).
- **Final fresh-context codex pass on v2.1** (`audit-codex.md`): **reject** — 5 findings, ALL adopted in v3: (1) the SW reader's own cross-profile leak (pre-existing, critical) → D12 + Ask 2; (2) display/verified split → D10; (3) retry debt independent of status → D11; (4) per-profile epochs, caller-carried identity, epoch-stamped ensure snapshots with re-entry, normative interface completed; (5) D9 overlay-reset pin + expanded Phase 2/3 test lists.
- **Fresh-pass re-verdict on v3 (resumed)** (`audit-codex.md`): **reject** — 3 findings + 1 process note, ALL adopted in v3.1: superseded ensures CANCEL (typed `EnsureSuperseded`), never re-enter — only a live lease retries (+A-pending→B test); `GasSlice.forcedVersion` gives D9 an implementable signal (+failed-force retention pin); the D12 file-map contradiction fixed (`service.ts` modified, composition-level test); independent accept/reject branches specified for both Asks. D10/D11 confirmed genuinely closed.
- **Fresh-pass re-verdict on v3.1 (resumed)** (`audit-codex.md`): **conditional approve → approve** — "the substantive designs are closed"; four normative-consistency corrections required and applied in v3.2 (ensure() comment states typed cancellation; Phase 4 catches `EnsureSuperseded` as no-op + pin; Phase 1 pins D12 via the composition test; caps prose/Phase 3 include `peek`). Per the verdict's own words: "With those consistency fixes, approve."

## Seeds (FINAL — approved scope, both Asks yes)

**ELI5 artifact**: https://claude.ai/code/artifact/080ef192-76fb-41d4-b9eb-642e4b612a77 (source: `implementations-plan/balance-fpc-cache/eli5.html`).

Recommended: `/goal` (completion is transcript-observable). Run inside this worktree (`agent-worktree resume balance-fpc-cache`). Use exactly one per session.

```
/goal All five phases marked ✓ in implementations-plan/balance-fpc-cache/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as defined in plan.md reported passing in the transcript, with LESSONS_FILE=implementations-plan/balance-fpc-cache/lessons/phase-N.md printed per phase; /code-review max --fix run and ITERATED until it reports no findings above nitpick, its fixes committed separately from implementation commits; the codex post-impl audit run as an ITERATION LOOP — resume the same codex session with each round of applied fixes — until codex returns an explicit "approve", every round's findings fixed or explicitly rejected with reasons logged in lessons/; `bun run audit:vue` exit 0, `bun run test:e2e` green, and `bun run e2e:agent tests/e2e/network/fee-methods.test.ts` green (5/5), all shown in the transcript; a PR to dev opened (conventional title ≤93 chars, NO auto-merge armed) and its CI babysat — flake → re-run, real breakage → fix and re-push — until quality-status, smoke-e2e-status, and network-e2e-status all report pass on the current head; and a final wrap-up report posted stating the PR is fully green and AWAITING MY EXPLICIT MERGE APPROVAL. The goal completes when the green-PR report is posted — never by merging; the merge is mine.
```

```
/loop 15m Drive implementations-plan/balance-fpc-cache forward. Never idle waiting for my input. Each firing: (1) Reality check: read plan.md + lessons/ (authoritative state), `git status`, `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup`. (2) Waiting on CI is fine if it's progressing — use the wait to review the diff or prep the next phase. (3) No task in hand? Pick the next pending step from plan.md and start it; after each meaningful edit run `bun run lint` + the touched package's tests; commit → push. (4) Stuck or facing a decision? Call /codex xhigh with full context, reach a defensible decision together, act, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to main, never publish/deploy, never expand scope beyond plan.md. (5) Same step failed 5 times? Stop retrying; reassess with codex. (6) Phase green means ITS VALIDATION GATE in plan.md passes — run the full gate, paste the result, mark ✓ in plan.md, file lessons, print LESSONS_FILE=implementations-plan/balance-fpc-cache/lessons/phase-N.md, advance. (7) All phases ✓? Run /code-review max --fix ITERATED to no findings above nitpick → separate commit → codex post-impl audit as an ITERATION LOOP (resume the session each round) until an explicit approve → open the PR to dev (NO auto-merge) → babysit CI to fully green (flake → re-run, breakage → fix+push) → post the wrap-up report (every contentious decision explained ELI5) stating the PR is green and awaiting the owner's merge approval → stop. NEVER merge — the merge is the owner's.
```
