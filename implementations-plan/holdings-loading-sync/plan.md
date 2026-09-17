---
plan: holdings-loading-sync
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 sweep agent (+2 pre-blueprint explorers reused); foreign reviewer /codex high
status: approved 2026-09-17 — implementing
---

# Holdings loading states + incoming-scan health

Make the Home token list honest from the first second, remove the per-row "catching up" dot, and replace
the scan's block-lag indicator with an outcome-based health signal. Wallet-only: nothing under
`apps/tools/**` or `packages/bridge-core/**`.

Mockups (design canvas): https://claude.ai/artifact/M6mJ7P1ePepCZF2NpaJn1q
Recon: [recon.md](recon.md) · Audits: [audit-codex.md](audit-codex.md), [audit-fable.md](audit-fable.md)

## UI impact (owner sign-off required by CLAUDE.md — recorded)

Owner, 2026-09-17, after reviewing the canvas and the recommendation table: **"I agree with all decisions
and proposed things. Let's fix all the bugs too please. Blueprint it mid."** Post-audit decisions, same
day (owner's selections): backfill gap **"Follow-up plan"**; row copy **"Compiled-in name; 'Couldn't
verify', no Retry"**; hero cap **"12 seconds"**; scan floor first **"Sign-up only"**, then — after it drew
High findings in three codex rounds — **"Move it to the follow-up"** (final).

| Surface | Before | After | Canvas |
|---|---|---|---|
| Home → Holdings, while loading or seeding | "NOTHING HERE YET — Tap to import your first token" | Each expected default token renders immediately as an inert row: symbol + compiled-in name ("USD Coin", "Compliant USDC"), amount as skeleton. Lists with nothing known show two anonymous skeleton rows after 300 ms. The empty state renders only when BOTH snapshots (balances, seed status) are loaded and nothing is pending | A1–A3, B |
| Home → Holdings, default token that could not be set up (network-type failure, attempts exhausted) | nothing | Inert row, dimmed symbol, "Couldn't set up", `RETRY` | A4 |
| Home → Holdings, default token rejected by its security pin / metadata bounds | nothing | Inert row, dimmed symbol, "Couldn't verify", no button | A4 variant |
| Home → hero total | `$0.00` while balances are unknown | skeleton while any shown row has no first balance or a seed is in progress — for at most 12 s per scope, then the aggregate of known balances; if the balance list could not be read at all, the existing unknown-value dash `—` (**new since the owner's selections — approve at the gate**) | A1–A2 |
| Home → token row | pulsing accent dot + tooltip; "Catching up…" shimmer text; spinner + "Loading balance…" | dot, tooltip and both texts removed; a row without a first balance shows a skeleton amount | C2 |
| Home → Recent transactions | no scan status | one dashed line "Older incoming transfers may be missing · Retry" when the active network's scan has been failing continuously for > 10 min; stays ≥ 5 s once shown; the section renders for it even with no rows | C4 |
| Holdings page | unchanged | unchanged (the never-wired `backfilling` prop is dropped) | — |

Screenshots of A1, A4 (both variants) and C4 attach to the PRs.

## Assumptions

### Facts (verified against the code; the Fable leg re-verified 1–4, 7–10, 13, 15)
1. The empty state has no loading branch: `TokensView.vue:437-451`; `fetchTokenBalances` clears the list before its await (`:289`) and has no event-vs-snapshot protection (`:155-175,281-305`), unlike `BalanceView.vue:118-178`.
2. Seeding is fire-and-forget on three triggers, none on popup open: `token/service.ts:143-172`.
3. For a **seed**, the Token/TokenBalance rows are written only after `previewTokenMetadata` (instance fetch, registration, three sequential `simulate()`): `token/service.ts:592-723`, `seeder.ts:283-300`. (Manual imports fetch metadata inside the journaled path instead.)
4. The attempt counter is incremented before the slow work by design, cap 3, reset per extension version; a zero-account pass consumes no attempt: `seeder.ts:19-22,278-288`.
5. `readMarkerState` validates only object shape and `typeof attempts === "number"`: `seeder.ts:383-397`. Profile purge deletes the whole marker blob (`:178-208`).
6. e2e replaces the SW's seed list at runtime (`tests/e2e/README.md` § default-token seeding); source-mode smoke arms an empty list.
7. Balances never read scan state (`token-balance/balance-projector.ts`).
8. The forward-scan `catch` wraps only `forwardScanOnce` and treats any throw with an anchor as a reorg; `resolveScanInputs` swallows tips/network failures and returns early; class-gate and missing-hash returns, reconciliation steps and the pending-page probe (`pendingPageReorged`, any throw ⇒ reorged) are outside it: `incoming-transfer/service.ts:1374-1458,1465-1478,1655-1663`.
9. Validator-dropped pages return `dropped: true` without throwing (`public-events.ts:248-250,278-279`); a dropped pass leaves coverage unchanged (`service.ts:1537-1561`).
10. During a reconciliation `coveredBlock = lowerBound − 1` (`service.ts:560-566,1681`).
11. `onAccountAdded` resets every cursor on the chain to `freshCursor(existing?.startBlock ?? 0)` (`service.ts:344-359`) — **unchanged by this plan** (see D5).
12. `syncState` is an in-memory map keyed `${networkId}|${contract}`; `commitSchedulers` (`:812-829`) does not clear it. Its only consumers are `TokensView` and tests.
13. Account addresses derive from `(master, l1ChainId, type, index)` — the same address on every Aztec network sharing an L1; a network delete + re-add re-creates index 0 (`account/service.ts:264-268`). This, plus phrase exposure during onboarding, is why no history-skipping shortcut survived the audits.
14. The node API has no deployment-block lookup; the scan pages by log count (`MAX_LOGS_PER_TAG = 20` × 5 pages per tick).
15. The extension already has an alarm-based SW wake path (journal reaper, 1 min, `operation-journal/reaper.ts`; registered in `wallet/runtime.ts`).
16. `scanPublicContract` is ~87 lines, `persistToken` 129, `parseTokenInterface` 72 — at or over the 80-line production budget before this plan.
17. Pre-production: persisted-shape changes need no migration (CLAUDE.md).
18. Every gate script named below exists (`lint`, `typecheck:all`, `audit:vue`, `test:e2e`, `e2e:agent`, `baseline:rescore`, workspace `test`).

### Inferences (each verified in the phase that depends on it)
- I1. `batchedViewSimulation` can serve `name/symbol/decimals` in one batch on its fast path; its supported slow arm is one combined simulation. Either way fallback values and result decoding of today's `fetchTokenMetadata` (`token/service.ts:701-722`) are preserved. (Phase 8)
- I2. A session storage area can be injected into `IncomingTransferService` (memory-backed, survives SW restarts, dies with the browser). **This is a Phase 7 gate**: if it cannot be wired, Phase 7 stops and the owner is asked — an in-memory episode would make the stalled line dead code. (Phase 7)
- I3. Every terminal balance-projection failure persists `syncFailure`. If a path does not, the 12 s cap bounds the hero only — the row keeps its skeleton; Phase 4 fixes any such path it finds. (Phase 4)
- I4. Artifact-mode smoke (real seeds, dRPC blocked) reaches `failed` seed rows only after the seeder's continuation exhausts the cap (~2 min); before that it shows placeholders. No assertion there counts anything but `tokens-card`. (Phase 5)
- I5. The seeder's continuation can ride an existing alarm wake (Fact 15) instead of a bare `setTimeout`, so it survives a SW death with the popup closed. If no alarm hook is reusable, a dedicated `chrome.alarms` entry is registered only while a continuation is due. (Phase 2)

### Asks
- **One open, for the approval gate:** the hero's `—` state when the balance list cannot be read at all (UI table, row 4) was added after the owner's selections.
- Recorded, not hidden: **a from-zero history read still delays NEW incoming public transfers in activity until it catches up — silently — for every wallet on a busy token, brand-new ones included.** Balances are unaffected. The owner moved the fix (and the rejected "scan floor" shortcut) to a follow-up plan, `incoming-tip-first-scan`, added to `implementations-plan/index.md` as "proposed" at close-out.

## Architecture & Implementation

### Shape
Two small read models replace the popup's guesswork, both RPC + event pairs on existing services:

1. **Seed status** (TokenService) — which defaults this chain should have and where each stands.
2. **Incoming-scan health** (IncomingTransferService) — one per-network "failing since", outcome-based.

The per-contract sync-state API (`getSyncState`, `onIncomingSyncStateChanged`,
`BACKFILL_INDICATOR_THRESHOLD_BLOCKS`, `emitSyncStateIfChanged`, `coveredBlock`/`lagBehind` as indicator
inputs) is deleted in Arc 2 after Arc 1 removes its only consumer.

### Seed status

```ts
// token/default-tokens.ts
type DefaultTokenSeed = { …; displayName: string }        // compiled-in literal, placeholder only

// token/spec.ts
export type SeedStatus = "pending" | "seeding" | "failed" | "rejected"
export type SeedStatusEntry = { chainId: number; contract: string; symbol: string; displayName: string; status: SeedStatus }
getSeedStatus(): Promise<SeedStatusEntry[]>   // PURE READ. active profile + network; seeded / deleted omitted
ensureSeeding(): Promise<void>                // recovery kick, latched
retrySeed(chainId: number, contract: string): Promise<void>
onSeedStatusChanged: { profileId: string; chainId: number }
```
- Source of truth: `deps.getSeeds()` (the list the SW really uses — e2e-safe) ⨝ marker blob ⨝ in-memory `inFlight` set on `TokenSeeder`.
- Marker hardening: `readMarkerState` additionally requires `attempts` to be a finite non-negative integer, `outcome ∈ {seeded, deleted}`, version fields strings; anything else drops the entry.
- `failed` = attempts ≥ cap at the current version. `rejected` = new `rejectedAtVersion === version`, written when `previewOne` hard-skips (pin mismatch / metadata bounds); a new extension version retries it, exactly like the cap.
- `ensureSeeding()` runs a pass iff some entry is `pending`, none is in flight, and the latch for `(profileId, chainId)` is unset; the latch is per SW lifetime and is set only when an account exists (a zero-account pass would consume nothing and loop). Reads and events never kick. The popup calls it on mount **and on every client reconnect** (a SW death under a mounted popup).
- **No stranded `pending`:** only after an attempt that was **actually made and failed retryably** (never merely because entries are `pending` — a zero-account pass schedules nothing, or the wake loop returns), the seeder persists `nextAttemptAt` in the marker entry (15 s, then 60 s) and arms a continuation through the single-flighted `run()`, coalesced with every other trigger, until the entry is `seeded`, `failed` or `rejected`. The due time rides an alarm wake (I5), so a SW death between attempts with the popup closed resumes instead of stranding; one continuation per scope, cancelled on scope change / purge (epoch). With the node down a seed reaches `failed` (+ Retry) in roughly two minutes; the cap still bounds the work.
- The event fires only when a derived status actually differs from the last emitted one for that scope.
- Marker writes become lifecycle-safe: the generic marker writer re-checks the captured epoch **inside** the lock (today only before queueing, `seeder.ts:178-186`), so neither a `rejectedAtVersion` write nor a retry can recreate a purged blob; tombstones take precedence over every other state; every automatic trigger honors `rejected`.
- `retrySeed`, inside the marker lock: active profile + network re-checked, key ∈ `getSeeds()`, epoch re-checked, tombstone and `rejected` refused, a key in flight **or already reserved** refused (coalesced). It sets a per-key in-memory reservation and clears `attempts`/`cappedAtVersion` in the same critical section, releases the lock, and only then launches the pass (a pass awaited inside the marker lock would deadlock on its own marker writes); the reservation is released when that pass settles or is invalidated. Two simultaneous retries ⇒ exactly one accepted, and the counter is never reset after work has started.
- Touched seeder log lines become fixed strings + named bounded fields (`{ seedKey, attempts, category }`), error category instead of the raw error.

### Scan outcomes and health

```ts
// incoming-transfer/scan-health.ts (pure, unit-tested)
type ScanOutcome = "progress" | "idle-at-tip" | "no-progress" | "failed" | "ineligible"
nextBackoffMs(failures: number): number                  // 30 s · 2^(n−1), cap 5 min
isStalled(ep: { failingSince: number | null; failures: number }, now: number): boolean   // ≥ 2 && > 10 min

// incoming-transfer/spec.ts
export type IncomingSyncHealth = { stalled: boolean; since: number | null }
getIncomingSyncHealth(networkId: string): Promise<IncomingSyncHealth>
retryIncomingScan(networkId: string): Promise<void>
onIncomingSyncHealthChanged: { profileId: string; networkId: string }   // invalidation — consumers refetch
```
- `scanPublicContract` returns a `ScanOutcome` covering the **whole** tick: inputs unresolved / tips failed / class gate `unresolved` / reconciliation step threw / pending-page probe or forward scan threw → `failed`; dropped or degraded page, or deferred for a missing checkpoint hash → `no-progress`; validated EOF at the tip → `idle-at-tip`; class gate `non-standard` → `ineligible` (never counted).
- **`progress` is a successfully committed, validated cursor advance** — the forward event cursor, the reconciliation progress cursor, or confirmed coverage. The scan pages by log count, so many valid pages inside one busy block advance the cursor without moving `coveredBlock`; block coverage alone would misread a productive backfill or a multi-tick reconciliation as stuck. `stepReconciliation` returns its result so the outcome can see it.
- Success = `progress | idle-at-tip`. It clears the episode. `failed | no-progress` opens or extends it and applies backoff (skipped ticks still re-evaluate `isStalled`, because the flip to stalled comes from time passing).
- **The reorg path is unchanged**: any throw with an anchor still begins a reconciliation immediately, pending-page markers are preserved on failure, coverage never advances on failure. No transient-vs-reorg classifier (ledger D3).
- Episodes are keyed `${profileId}|${networkId}|${contract}`, live in `chrome.storage.session` (I2 — a **gate**, not a nicety: in-memory episodes die with every alarm-woken SW and the line would never fire), survive same-profile scheduler rebuilds, and are cleared on success, lock / active-profile change, `clearProfile`, `clearChain`, token delete. Unlock after a long lock therefore starts a fresh episode; a node down for an hour with the wallet unlocked shows the line after 10 min.
- Episode persistence is lifecycle-safe: writes and removals are serialized through the service lock and fenced by the scan's start epoch (a late outcome cannot recreate an episode cleared by lock/purge); hydration completes before the first poll; stored values are validated field by field — `failures` a finite non-negative integer, `failingSince` ≤ now, `nextAttemptAt` allowed in the future but clamped to now + the 5 min backoff cap — and only an invalid field is repaired or the entry dropped, so a restart during an active backoff keeps its streak. The records reveal only which (profile, network, contract) triples are failing, are readable only from trusted extension contexts, and confer no authority.
- Health events carry `profileId` and are treated by consumers as refetch invalidations; the composable cancels its min-display timer on scope change.
- `retryIncomingScan` clears only `nextAttemptAt` for the network's keys and triggers one poll — never the failure count or `failingSince`.
- Network health = any eligible contract stalled; emitted on change. Transient failures log at `debug`; one `warn` on the stalled transition.

### Scan start — unchanged
Every cursor still starts at block 0 and `onAccountAdded` still rewinds the chain's cursors (Fact 11). No
history is ever skipped. The "scan floor" shortcut was removed from this plan (ledger D5).

### Popup
- `pages/general.vue` (L6) owns one `TokenServiceClient` + `useSeedStatus` (C1: `entries`, `ready`, `refresh`, `retry`, `dispose`; generation-guarded; refetch on event/reconnect/scope change; calls `ensureSeeding()` on mount and on every client reconnect) and passes `seedEntries` / `seedReady` down to `BalanceView` and `TokensView`; `TokensView` emits `retry-seed`. One client, one kick.
- `TokensView`: adopts `BalanceView`'s `isLoaded` + dirty-refetch + request-generation pattern for its balance snapshot. Placeholders = seed entries whose contract is neither a real row nor a visible `TokenImportRow`. Template order: import rows → real rows → `TokenSeedRow`s → ghost rows (`!isLoaded || !seedReady`, none of the above, after 300 ms) → empty state (`isLoaded && seedReady && nothing`). Count = real rows + placeholders. All sync-state plumbing is deleted (~70 lines).
- `TokenSeedRow.vue` (L4, presentational, **inert**: a `div`, no `RouterLink`, no token id, not part of any picker). `pending|seeding` → symbol, displayName, `Skeleton` amount; `failed` → dimmed, "Couldn't set up", `RETRY`; `rejected` → dimmed, "Couldn't verify". Testids `token-seed-row` (+ `data-status`, `data-symbol`), `token-seed-retry`, `tokens-skeleton-row`.
- `TokenCard`: drops `backfilling`, dot, tooltip, both loading texts and the spinner; the initial-sync block is a `Skeleton` pair under the kept `token-balance-loading` testid. `TokenList` drops its `backfilling` prop.
- **Readiness is not validity.** Each snapshot (balances in `BalanceView`, balances in `TokensView`, seed status in `useSeedStatus`) has `state: "loading" | "loaded" | "unavailable"`. A rejected fetch retries once after 2 s and again on every client reconnect; until one succeeds the state is `unavailable`, never `loaded`-with-nothing. `TokensView` keeps its skeleton rows while `unavailable` (the empty state needs two `loaded` snapshots); previously obtained same-scope rows are kept, not cleared.
- `BalanceView`: `heroPending = balances.state !== "loaded" || seed.state !== "loaded" || rows.some(updatedAt === 0 && !syncFailure) || seedEntries.some(pending|seeding)` — `loading` and `unavailable` both hold (a retry may still land) — bounded by a 12 s timer per scope generation. After the cap the figure depends on one question only: **has any balance snapshot succeeded for the current scope?** Yes ⇒ the aggregate of the balances actually known (a successfully loaded empty list is a real `$0.00`). No — whether the request was rejected or is still unanswered ⇒ the existing unknown-value dash `—`, never `$0.00`. Testid `balance-hero-loading`.
- `@nulo/design/ui/Skeleton.vue` (L2; `width`, `height`; one keyframe; reduced-motion aware; in `NULO_DESIGN_COMPONENTS`). Adopted by `TokenSeedRow`, `TokenCard`, `BalanceView`, `GasBalanceCard`. The other private shimmers are out of scope.
- `RecentActivityView` (account mode): `useIncomingSyncHealth` (C1) → the stalled line + Retry; min-display 5 s with a scheduled expiry. Testids `incoming-sync-stalled`, `incoming-sync-retry`.

### Metadata read
`fetchTokenMetadata` issues one batched read via `batchedViewSimulation` / `getViewSimulationDeps` (the `BalanceProjector` wiring). Validation and fallbacks unchanged. `persistToken` / `parseTokenInterface` are not grown; the batching lives in `fetchTokenMetadata` only.

### File-level change map
| Arc | Files |
|---|---|
| 1 | `packages/design/src/ui/Skeleton.vue` (+test, export), `apps/extension/scripts/design-resolver.ts`; `token/{default-tokens,spec,service,client,seeder}.ts` (+tests), the seeder's wake hook in `wallet/runtime.ts` (existing alarm, or a dedicated `chrome.alarms` entry — I5); `composables/useSeedStatus.ts` (+test); `pages/general.vue`; `modules/general/{TokensView,TokenCard,TokenSeedRow,BalanceView,GasBalanceCard}.vue` (+tests), `modules/holdings/TokenList.vue`; e2e `network/default-token-seeding.test.ts`; `ARCHITECTURE.md` |
| 2 | `incoming-transfer/{spec,service,client,repository}.ts`, new `scan-health.ts` (+tests; "§3 Catching up" scenarios rewritten), session-area injection in `wallet/runtime.ts`; `composables/useIncomingSyncHealth.ts` (+test); `modules/general/RecentActivityView.vue` (+test); `token/service.ts` (metadata); docs |

`packages/aztec-runtime` is no longer touched.

## Competing outline (journal-first, cheapest)
Create the `token_import` journal record at seed-pass start with `title = expectedSymbol`; the existing
`TokenImportRow` covers the dead window with zero new RPC.
- For: smallest diff; reuses a wired path.
- Against: not the approved A1 row; a failed record disappears after 30 s, so a durable failure + Retry is impossible; the reaper fails `pending` records after 2 min and cold seeding can exceed that; nothing covers "pending but no pass running" after a SW death; the hero still needs a second signal; one journal record per attempt pollutes history. Both audit legs: nothing worth adopting.

## Security & Adversarial Considerations
- **Threat model.** (a) hostile or flaky node; (b) local attacker with write access to `chrome.storage.local`; (c) hostile token contracts. No new dApp-facing surface, origins, or dependencies.
- **Reorg handling is not weakened.** Detection, reconciliation markers, epoch fencing and the any-throw ⇒ reconcile rule stay exactly as audited. Backoff only spaces retries of a failing tick; it never advances coverage or clears a pending-page marker.
- **A lying node can suppress the stalled line** only by serving internally consistent pages — indistinguishable from an honest node for this read model; stated, not solved. Dropped/degraded pages now count as failure, closing the cheap suppression.
- **Node-forced stalled line** is the truth. Retry cannot reset the episode.
- **No history is skipped.** Every scan still starts at block 0; this plan adds no way to omit an incoming record. (The scan-floor shortcut was removed after three audit rounds — ledger D5.)
- **Seeding.** `retrySeed`/`ensureSeeding` are popup-only internal RPCs, lifecycle-fenced, membership-checked, tombstone- and pin-respecting, latched and reservation-guarded — no wake storm, no resurrection after purge, no retry of a security rejection. Continuations are armed only by a real failed attempt, are bounded by the attempt cap, and die with their scope. TOFU pins gate every attempt as today.
- **Placeholders** render compiled-in literals only (the e2e override pins `TST`), are inert, and never enter token pickers or Send.
- **Hostile marker blob**: every field used by status derivation is validated.
- **Logging**: identifiers as named object properties, categories not envelopes; `log-payload-ban.test.ts` enumerates `apps/extension/src` + `packages/*/src` so the new files are covered.
- **Supply chain / crypto / least privilege**: unchanged.

## Phases

All gates run from the repo root. "Fast layers" = `bun run lint && bun run typecheck:all` + the named tests. Validate within a phase after each meaningful step, not only at its end.

### Arc 1 — loading states + seed status

**Phase 1 ✓ — `Skeleton`.** Primitive (≥ 5 cases), resolver entry, `GasBalanceCard` adoption (60×12 parity).
- Gate: fast layers + `bun run --cwd packages/design test` + `bun run --cwd apps/extension test src/popup/components/modules/general/GasBalanceCard` — exit 0. Layers: lint/typecheck, unit.

**Phase 2 ✓ — seed status surface.** `displayName`; marker hardening + `rejectedAtVersion`; `inFlight`; pure `getSeedStatus`; latched `ensureSeeding`; fenced `retrySeed`; change-only event; log normalization.
- Tests: status per marker shape incl. hostile values; read never kicks; `ensureSeeding` runs once, not with zero accounts, not while in flight; a failed attempt below the cap continues on its own to `failed` (fake timers) and never strands `pending`; a SW death between attempts resumes from the persisted `nextAttemptAt` on the next wake (verify I5); a zero-account pass arms no continuation; scope change / purge cancels it; node-down does not burn attempts through event→refetch; `retrySeed` refuses tombstone / rejected / non-member / in-flight / stale epoch, two simultaneous retries ⇒ exactly one accepted and no counter reset after work starts, and it does not deadlock the marker lock; purge during a `rejectedAtVersion` write cannot recreate the blob; two consumers ⇒ one pass.
- Gate: fast layers + `bun run --cwd apps/extension test src/wallet/services/token src/wallet/runtime` — exit 0, including a composition-level test that a fresh runtime (simulated SW restart, no popup connected) woken by the alarm resumes a due continuation exactly once. Layers: lint/typecheck, unit, composition.

**Phase 3 ✓ — Holdings list.** `useSeedStatus` (≥ 10 cases), `general.vue` ownership, `TokenSeedRow`, `TokensView` gating + dirty-refetch + plumbing deletion, `TokenCard`, `TokenList`.
- Tests: empty state never before both snapshots are `loaded`; balances-before-seed-status ordering; event during an in-flight snapshot refetches; a rejected fetch is `unavailable` (skeleton stays, empty state never), recovers on the timed retry and on reconnect; `ensureSeeding` re-issued on reconnect; dedupe vs real rows and vs `TokenImportRow`; ghost rows only after 300 ms; scope change resets readiness; rejected row has no button; seed row is not a link.
- Gate: fast layers + `bun run --cwd apps/extension test src/popup src/composables/useSeedStatus` — exit 0. Layers: lint/typecheck, unit/component.

**Phase 4 ✓ — hero.** Rule + 12 s cap + snapshot-reject recovery; verify I3.
- Tests: zero rows with a seeding entry; row at `updatedAt === 0`; failed/rejected seed does not hold; cap releases to the known aggregate; a rejection BEFORE the cap keeps the skeleton; a rejected OR still-unanswered snapshot after the cap renders `—`, never `$0.00`; a successfully loaded empty list renders `$0.00`; token-detail hero untouched.
- Gate: fast layers + `bun run --cwd apps/extension test src/popup/components/modules/general/BalanceView` — exit 0.

**Phase 5 ✓ — e2e + docs.** `default-token-seeding.test.ts`: `token-seed-row[data-symbol="TST"]` visible before `tokens-card`; `tokens-empty-import-link` never appears in between. Verify I4. `ARCHITECTURE.md`: seeding paragraph corrected to the truth as of this arc (three metadata simulations) + seed status. Screenshots.
- Gate: `bun run audit:vue` exit 0; `bun run test:e2e` green; `bun run e2e:agent` complete network suite green (retry-0; a genuine flake is re-run, never waived). Layers: all, incl. live sandbox.

Arc 1 boundary → quality loop → `gh stack add`.

### Arc 2 — scan health, seeding speed

**Phase 6 ✓ — outcomes + deletion.** Delete the sync-state API and the four `emitSyncStateIfChanged` call sites FIRST (frees the line budget), then `scanPublicContract` returns `ScanOutcome`; extract `handleScanFailure`; `scan-health.ts`.
- Tests: each early-return and throw path maps to the right outcome (`unresolved` gate ⇒ `failed`, `non-standard` ⇒ `ineligible`); dropped page ⇒ `no-progress`; many pages inside ONE block ⇒ `progress` every tick; a multi-tick reconciliation ⇒ `progress` per step; reconciliation still begins on any anchored throw and the scan recovers to `idle-at-tip` after a transient anchored failure; pending-page marker preserved on failure; coverage never advances on failure. "§3 Catching up" describe replaced. The deletion commit removes declarations, client exports, implementation and obsolete tests together and passes on its own; coverage data the outcome needs stays.
- Gate: fast layers + `bun run --cwd apps/extension test src/wallet/services/incoming-transfer src/popup` — exit 0.

**Phase 7 ✓ — episodes, backoff, health RPC.** Verify I2. Session-backed episodes, per-profile keys, clear rules, backoff with re-evaluation on skipped ticks, RPC/event/retry.
- Tests: node down 1 h unlocked ⇒ stalled after 10 min; unlock after 8 h + two failures ⇒ NOT stalled; SW restart mid-episode keeps `failingSince` (hydrated before the first poll); same-profile rebuild keeps, profile switch clears; a late outcome after lock/purge cannot recreate an episode; hostile stored episode values are repaired or dropped; a restart during an active backoff keeps the streak and the (future) `nextAttemptAt`; two profiles sharing a network do not cross-talk; Retry keeps the count; success clears and emits once.
- Gate: fast layers + `bun run --cwd apps/extension test src/wallet/services/incoming-transfer` — exit 0.

**Phase 8 ✓ — one metadata read.** Verify I1.
- Tests: one read issued; fallbacks/decoding/validation unchanged; slow-arm path.
- Gate: fast layers + `bun run --cwd apps/extension test src/wallet/services/token src/wallet/services/execution` — exit 0.

**Phase 9 — stalled line.** `useIncomingSyncHealth` (≥ 10 cases), `RecentActivityView`, screenshot.
- Gate: fast layers + `bun run --cwd apps/extension test src/popup/components/modules/general/RecentActivityView src/composables/useIncomingSyncHealth` — exit 0.

**Phase 10 — e2e + docs.** The stalled line stays pinned at unit/component level (a node outage is not deterministic in e2e); the network suite proves no regression. Docs: `ARCHITECTURE.md` (scan outcomes/health, one metadata read), `implementations-plan/index.md` (+ the proposed `incoming-tip-first-scan` follow-up).
- Gate: `bun run audit:vue` exit 0; `bun run test:e2e` green; `bun run e2e:agent` complete network suite green; `bun run baseline:rescore` unchanged (no new complexity acceptances).

## Delivery

| Arc | Phases | Stacks on | code_review |
|---|---|---|---|
| 1 `feat(popup): honest holdings loading states and default-token seed status` | 1–5 | `dev` | off |
| 2 `fix(incoming): outcome-based scan health and one-shot token metadata` | 6–10 | Arc 1 | off |

Stacked via `gh stack` (`gh stack init --adopt worktree-holdings-loading-sync`; arc 2 branch `worktree-holdings-loading-sync-scan`). PR titles ≤ 93 chars, squash into `dev`. Bodies quote the owner sign-off and attach screenshots. **Rollback is reverse-order**: Arc 2 must be reverted before Arc 1 (Arc 1's pre-image calls the API Arc 2 deletes). No PR, not even a draft, before the loops below converge. `gh stack merge` is the owner's call.

## Post-implementation

`code_review: off` — `/code-review` is not run.

1. **Per arc, at its boundary** (last gate green, before `gh stack add`): `/codex high` on the arc's diff with plan.md, the decision ledger, the arc map ("arc N of 2; arc 2 deletes the sync-state API arc 1 stopped consuming and adds the stalled line"), the adversarial/security ask, and both rules below verbatim. On this host codex cannot read the repo (AppArmor blocks its sandbox): build the prompt with the diff and the touched regions inline, as the plan audits did.
2. **Fix loop**: verify each finding against the repo; apply accepted fixes; commit; log the round (consult + verdict) in `lessons/phase-N.md`; **resume the same codex session** with the fix diff. Repeat until a round yields no new material findings. Still material after 3 rounds → stop and surface to the owner.
3. **After both arcs**: one FRESH `/codex high` session over the net diff from `dev` for cross-arc issues (seams, duplication, plan drift); same loop.
4. **Delivery**: `gh stack sync` if `dev` moved, `gh stack submit --auto`, `gh pr edit` bodies, `gh pr checks --watch`; update `implementations-plan/index.md`.

Rules sent verbatim in every post-implementation codex prompt:
- *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
- *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

Dispositions for an autonomous session: never idle; a decision you would bring to the owner goes to `/codex high` first and is logged; hard limits hold (no merge, no publish, no scope beyond this plan, no complexity suppressions, no UI beyond the UI-impact table); the same step failing 3 times means stop and reassess with codex, not retry.

Post-implementation hardening: none scheduled (owner, Phase 0).

## Decision ledger

| # | Decision | Source | Alternatives rejected, and why |
|---|---|---|---|
| D1 | Main outline (seed-status RPC + health RPC) over journal-first | main; both legs concur | Journal-first cannot give a durable failure row, fights the reaper, pollutes history |
| D2 | Health from whole-tick **outcomes**; success = a committed, validated cursor advance (forward, reconciliation, or coverage) or validated EOF | codex H3/H4, fable H1 | Draft counted only forward-scan throws and "did not throw" as success — blind to node-down and to dropped pages |
| D3 | **No transient-vs-reorg classifier**; any anchored throw still reconciles | fable M (simpler), resolves codex R1 H2; codex final: "defensible" | Draft classifier delayed reconciliation with an unprovable bound and needed a reader marker + node error shapes. With the dot gone a spurious reconciliation no longer shows anything. Residual, accepted: a needless reconciliation costs RPC and can delay discovery of new receipts by its window, more so under backoff — Phase 6 tests recovery to `idle-at-tip` after a transient anchored failure |
| D4 | Failure **episode** in session storage (a gate), lifecycle-fenced, cleared on success/lock/profile change; not persisted `lastSuccessAt`. Progress = committed cursor advance, not block coverage | fable H, codex R1 H, codex final H/M | `lastSuccessAt` gives a false line ~30 s after a long lock; in-memory dies with every alarm-woken SW; block coverage misreads a busy block or a multi-tick reconciliation as stuck |
| D5 | **Scan floor removed from this plan**; scans start at 0 as today. The user problem (a new wallet's first receipt waiting on a history read) moves to `incoming-tip-first-scan`, which shows new receipts first and skips nothing | owner decision (final), after codex R1 H, fable H2/H3, codex final H×3, codex re-review H×2 | Three designs were tried and each lost receipts somewhere: "generated ⇒ tip at first scan"; "only account row, tip in the handler" (receipt during the async tip read, sole-chain delete + re-add, cursors inheriting `startBlock`); "one-time record + pre-persist tip" (reordered `onAccountAdded` handlers reinstalling a stale floor; the phrase is shown before the first account exists, so another device can receive first). A shortcut that skips history needs a provenance guarantee the wallet cannot give |
| D6 | Deployment-block anchoring dropped | recon row 8 | Not lookup-able; paging is by log count so it saves nothing |
| D7 | `getSeedStatus` pure; latched `ensureSeeding` (mount + reconnect); seeder-owned bounded continuation armed only by a real failed attempt, persisted due time, alarm-resumed; epoch-checked marker writes; in-lock retry reservation, launch outside the lock; change-only event | both legs; codex final H/M; codex re-review M×2 | Draft getter-kick + refetch-on-event loops and burns the cap in seconds when the node is down. First revision's latch alone stranded a seed at `pending` after one failed pass |
| D7b | Snapshot `loading / loaded / unavailable`; `unavailable` never reads as empty or `$0.00` (hero falls to `—`) | codex final M | First revision's "retry once, then `isLoaded`" turned a failed read into evidence of emptiness |
| D8 | Seed state owned by `general.vue`, passed to both siblings | fable M, codex H (coordinated readiness) | Two composables ⇒ two clients, two kicks, uncoordinated readiness |
| D9 | `rejected` status, "Couldn't verify", no Retry; compiled-in `displayName` | owner decision | Retrying a security rejection; chain-supplied text in an unverified row |
| D10 | Hero hold capped at 12 s | owner decision | Uncapped hold sticks on a hung token or an account-less seed |
| D11 | Tip-first + background backfill scan deferred to `incoming-tip-first-scan` | owner decision | Touches the audited reorg machinery; deserves its own plan |
| D12 | Private shimmer keyframes outside the touched components stay | main | Sweeping them is unrelated churn |

**Still disputed:** nothing. Rejected from the final pass (codex withdrew it on re-review): replacing the per-layer test minima with "behavior coverage" — the minima are a CLAUDE.md rule; the listed behaviors are the content, the minima the floor.

## Audit verdicts
- **Fable, round 1 (draft):** conditional approve — six conditions: four adopted (D2, D4, D7, D8), the two scan-floor ones made moot by D5, owner asks surfaced. Transcript: `audit-fable.md`.
- **Codex, round 1 (draft):** reject — blocking: unsafe scan floor, incomplete failure accounting, unbounded loading/retry states. Addressed by D2–D5, D7–D10; item-by-item in `audit-codex.md`.
- **Codex, final fresh-context pass (revised plan + ledger):** reject — blocking: scan-floor eligibility + capture timing, stranded pending seeds, block-coverage progress semantics; plus atomic marker transitions, lifecycle-safe episodes, readiness ≠ validity. All adopted (D4, D5, D7, D7b) except the test-minima point. Transcript: `audit-codex.md` § Final pass.
- **Codex, re-review 1 (same session resumed):** reject — two High, both on the scan floor (handler reordering; phrase exposure before capture); all other prior blockers "resolved at the design level". Floor removed by the owner (D5); the four Medium/Low items adopted (continuation contract, retry reservation, episode timestamp validation, description sync).
- **Codex, re-review 2:** **conditional approve (with conditions: reconcile the hero predicate with its unknown-data behavior and complete the recorded UI sign-off gate)** — "previous blocking findings are resolved at the plan level … no operative floor leftovers … no further architectural blocker". Conditions: hero predicate reconciled (above, adopted); Arc 1 change map + Phase 2 gate now carry the alarm integration (adopted); the `—` state needs the owner's sign-off at the approval gate (open — the gate asks for it).

## Seeds
ELI5 artifact: https://claude.ai/artifact/HiWByjxBXkg49gFZ5ip75A — source `implementations-plan/holdings-loading-sync/eli5.html` (republishing that file updates the same URL). **Approval (2026-09-17):** the owner ran `/goal` first on the ELI5 artifact URL and then with the artifact's recommended seed verbatim — taken as `approve` of the plan as presented, including the hero `—` state that page lists under "Approval needed". The PR body repeats the `—` item so the owner can veto it at review.

Canonical seed (as set by the owner, unchanged from the draft):

```
/goal All 10 phases marked ✓ in implementations-plan/holdings-loading-sync/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/holdings-loading-sync/lessons/phase-N.md`; `/code-review` was NOT run (code_review: off); the codex fix loop converged for Arc 1 at its boundary, for Arc 2 at its boundary, and for the final cross-arc pass — each evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; only after all three converged, the two stacked PRs exist on GitHub (`gh stack view` output in the transcript) with the owner sign-off quoted and screenshots of A1, A4 and C4 attached; `bun run test` and `bun run lint` both report exit 0 in the transcript; no file under apps/tools/** or packages/bridge-core/** changed; no new biome-ignore complexity directive was added.
```
