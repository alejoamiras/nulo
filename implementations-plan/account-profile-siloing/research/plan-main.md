# Plan (main-agent draft) — Account + Profile Siloing

> Independent draft #3 of the deep blueprint. Codex + Opus-fable draft the same task in parallel; this gets
> consolidated with theirs into the final `plan.md`. Commit to a concrete design; attack it.

## 0. Problem statement + goal

The active **composite scope** `S = (profileId, networkId, chainId, accountAddress)` must be the *only* thing that
decides what activity renders and what an in-flight execution is allowed to bind to. Phase 1 (#314, on `dev`)
closed the same-network account-switch FEED leak with drop-only guards; it did NOT (a) generalize to profiles as a
structural invariant, (b) deliver instant-from-cache switching, or (c) harden the EXECUTION side (a switch
mid-prove still builds a tx under the wrong account/journal). This arc does all three, as ONE PR.

**Done =**
1. Switching profile/account/network is an O(1) slice swap — the target scope's last-known feed paints instantly,
   no clear-then-refetch flash (instant-from-cache).
2. No producer event or async result can ever reach a slice other than its own scope's — structurally, not by
   a downstream drop-guard (guards become defense-in-depth, not the primary barrier).
3. A profile/account switch during an in-flight dApp send ABORTS the op with a user-visible warning; no tx is
   ever signed/submitted under a scope other than the one the user authorized.
4. The durable causal protocol survives SW-restart, ABA, delete-during-snapshot, and mnemonic re-import — proven
   by property tests on a pure module BEFORE it is wired.
5. A multi-PROFILE + multi-account network e2e deterministically reproduces the mid-send switch (H5) and asserts
   no cross-profile render or bind.

## 1. Architecture

### 1.1 The slice model (structural containment — subsumes Phase 1)

Introduce a single coordinator `apps/extension/src/stores/activity.store.ts` (Pinia) that owns:

```ts
type ActivityScopeKey = string  // `${profileId}|${networkId}|${chainId}|${accountAddress}` — canonical, lower-cased addr

interface ActivitySlice {
  transactionsByHash: Map<string, TxRow>
  awaitingById:       Map<string, AwaitingRow>      // the send.vue placeholder / optimistic sends
  journalOpsById:     Map<string, JournalRow>
  incomingByKey:      Map<string, IncomingRow>      // key = `${scopeKey}::${siloedNullifier}` (H8: nullifier unique per-tree only)
  seqBySource:        Map<SourceId, number>         // durable per-(source) high-water counter for THIS slice
  epoch:              number                        // incarnation id (re-import / reset bumps it)
  tombstones:         Map<RecordId, number>         // recordId -> seq at which it was terminally removed
}

const slices = new Map<ActivityScopeKey, ActivitySlice>()
const activeScopeKey = ref<ActivityScopeKey | null>(null)
const activeSlice = computed(() => activeScopeKey.value ? slices.get(activeScopeKey.value) ?? EMPTY : EMPTY)
```

- The UI (`RecentActivityView`, `activity.vue`, `journal/[id].vue`) reads **only** `activeSlice` (readonly).
- Switching is `activeScopeKey.value = keyFor(newScope)` — synchronous, O(1). The target slice already holds its
  last-known rows ⇒ **instant-from-cache**. No `resetActiveFeedState`, no generation bump on the *presentation*
  path (generation still guards *fetches*, see 1.4).
- **Every producer routes to the slice for the record's OWN scope**, computed from the record's own
  `(profileId, networkId, chainId, accountAddress)` — NEVER from `active*`. A foreign record can't structurally
  reach `activeSlice` because it's written into a different map entry. This is the invariant that makes the
  Phase-1 drop-guards redundant (we keep them as cheap defense-in-depth + assertion, not the barrier).

**Why a store, not N per-scope refs:** one coordinator centralizes the scope-routing rule (one place to get
right/audit), gives the swap its O(1) property, and lets us cap memory (LRU-evict cold slices, see 1.6).

### 1.2 Durable causal protocol (the reducer — spike + property-test FIRST)

Pure module `packages/wallet-core/src/activity/causal.ts` (no chrome.*, no Vue), so it unit/property-tests in
isolation and is reusable. It answers one question per producer event: *given the current slice state, does this
event apply, and how?*

```ts
interface CausalEvent { source: SourceId; scopeKey: string; recordId: string; seq: number; epoch: number; kind: 'upsert'|'remove' }
// reduce(slice, event) -> { next: ActivitySlice, applied: boolean }
```

Rules (each maps to an H8 hazard):
- **epoch guard**: `event.epoch < slice.epoch` ⇒ drop (stale incarnation, e.g. a pre-re-import event). A re-import
  of the same mnemonic → same `scopeKey` but `epoch := slice.epoch + 1`, so the old incarnation's late events
  can't paint into the new one.
- **monotonic seq per source**: `event.seq <= slice.seqBySource.get(source)` ⇒ drop (ABA / out-of-order /
  duplicate). Advance the high-water on apply.
- **tombstone guard**: `slice.tombstones.has(recordId) && event.seq <= tombstones.get(recordId)` ⇒ drop
  (resurrection prevention — a snapshot/upsert that raced a terminal remove). `remove` writes the tombstone at its
  seq.
- **snapshot vs newer-event (watermark)**: a full-slice snapshot ingest carries a watermark `seq`; per-record it
  applies only where `record.seq > existing.seq` — a newer single event already applied is not clobbered.
- **durability**: `seqBySource` + `epoch` + `tombstones` persist per slice in `chrome.storage.local` (behind the
  migration-aware facade) so an SW restart doesn't reset counters to 0 (which would let a replayed event look
  "newer"). Counter source-of-truth is durable; the in-memory Map is a hydrated cache.

The **spike** builds this module + a fast-check-style property suite (bun:test) that throws random interleavings
of upsert/remove/snapshot/restart/re-import at it and asserts the invariants (no resurrection, no cross-epoch
paint, monotonicity, snapshot-idempotence). Only after green do we wire it into the store.

### 1.3 Execution: capture the authorized scope, abort on drift (decision 1)

The execution side is a *binding* problem, not a presentation problem: a send authorized under scope `S_auth` must
either complete under `S_auth` or not at all — never silently rebind to `S_now`.

- **Fence capture (H4, atomic):** `ProfileService.captureExecutionFence(expectedProfileId?)` runs INSIDE the same
  `runExclusive(profileSwitchMutex)` the profile switch takes, and returns
  `ExecutionFence = { profileId, epoch, authorizedAccounts: Address[] }`, throwing `ActiveProfileMismatchError` if
  `session.profile.id !== expectedProfileId`. Atomic ⇒ no check-then-switch-then-capture window. (The p1a branch
  `a6ed183` has a working variant — reference `apps/extension/src/wallet/services/profile/service.ts:~223`.)
- **Abort-on-drift chokepoint (H5):** the fence threads to the ONE place that matters — a
  `requireScopeUnchanged(fence)` assertion called (a) when resolving the execution mutex key
  (`execution-lane.ts:~193` — key on `fence.profileId`, not active), and (b) at the top of both tx builders
  (`tx-request-builder.ts:~113` buildStandard, `:~382` buildNoFrom) right after they read the active
  profile/account, comparing the snapshot to `fence`. On mismatch: throw `ExecutionScopeDriftError` (a typed,
  non-retryable abort). We do NOT thread the captured scope INTO getAccountContract to keep executing (rejected —
  decision 1); we abort.
- **Drift window honesty:** the assertion closes the check→build window because the SAME synchronous snapshot that
  the builder uses for `getAccountContract` is the one compared to the fence (no await between). The residual
  window is check→sign→submit inside the SDK; we mitigate by keeping the mutex key on `fence.profileId` so a
  concurrent switch's work can't interleave on the same lane, and by making the fence account-set the source for
  the NO_FROM default (so even the account is pinned). Document the residual as an accepted, mutex-narrowed window.
- **Residue cleanup (H6):** the silent-path fast-forward to `pending` (`dapp-interaction/service.ts:~334`) plus
  background failure cleanup (`wallet-sdk/background.ts:~687`) must terminalize a `pending` (not only `queued`)
  record on abort, and emit a `remove` causal event (tombstoned) so no card lingers.
- **Warning UX:** on `ExecutionScopeDriftError`, the dApp-interaction rejects the request with a typed reason and
  the popup surfaces a toast: "Transaction cancelled — you switched accounts while it was preparing." No seed
  solicitation, no silent swallow. (See 3.Security for the DoS angle.)

### 1.4 Producer wiring + queued-journal correctness (H1/H2/H3/H7)

- **Tx service:** stamp `profileId`/`networkId` onto tx rows at creation (optional fields, per-row-tolerant codec)
  and route `onTxAdded/onTxUpdated` to `sliceFor(row.scope)`. The `syncTransactions` fetch keeps its
  `{generation, account, chain}` capture as a *fetch-drop* guard (a slow fetch from the old scope is discarded),
  but the presentation no longer needs a generation bump — the result simply lands in its own slice.
- **Incoming:** `useIncomingTransfers` routes each accepted record to `sliceFor(record.scope)` keyed by
  `${scopeKey}::${siloedNullifier}` (H8 — nullifier is unique per rollup tree, not across `networkId`). Keep
  `isVisibilityEnabled` fail-closed (Phase 1). Keep owner = trusted `NoteDao.owner` (do NOT reintroduce the
  reverted owner-drop).
- **Queued-journal (H1):** `wallet-sdk/queued-journal.ts` derives the record account from the actual authorized
  `from` of the send, not `dapp.accounts[0]`. Extract `extractSendFrom(message)`.
- **NO_FROM default (H2):** the queued-create default MUST equal the dispatcher's rule —
  `allAccounts.find(a => sessionAddresses.has(a.address))` in INDEX-SORTED WALLET order
  (`dispatcher.ts:~1349-1385`), shared via one helper so create + dispatch can't diverge.
- **Journal delete/supersede (H3):** `operation-journal/service.ts` `deleteOperation` + `setOperationMeta`
  acquire the `transitionLock`; deletes emit a tombstoned `remove` event (no load-modify-write resurrection).
- **Profile-aware filters (H7):** `journalRecordInScope` (and any residual publication/display filter) compares
  `profileId` too — present-and-equal for populated rows, lenient (accept) on `undefined` legacy rows.

### 1.5 What we explicitly DROP (decision 2)

The dApp `ExecuteOperation` in-progress "spinner" card stays fail-closed HIDDEN. No `correlationId` task↔journal
threading, no reactive publication gate, no `setOperationCorrelation`. dApp progress renders via the durable
journal cards only. This removes the single largest audit-pain surface (5 rounds of leaks lived here) from scope.

### 1.6 Memory / lifecycle

Cap `slices` with an LRU (keep active + N most-recent; evict cold slices' in-memory Maps but KEEP their durable
`seqBySource/epoch/tombstones` so a re-visit rehydrates correctly). Evicted slice re-paints from its durable
snapshot + a scoped refetch on next activation (still feels instant if snapshot present; worst case a spinner on a
long-cold scope, acceptable).

## 2. Phases (each ends in a Validation gate)

### Phase A — Durable causal protocol SPIKE (pure module + property tests). NO wiring.
Build `packages/wallet-core/src/activity/causal.ts` + `causal.property.test.ts`. Model the slice reducer +
durable counter store interface (inject storage, test with an in-memory fake). Property suite: random
interleavings of upsert/remove/snapshot/SW-restart(counter-rehydrate)/re-import(epoch-bump) → assert no
resurrection, no cross-epoch paint, per-source monotonicity, snapshot idempotence, tombstone durability.
**Gate:** `bun run --cwd packages/wallet-core test src/activity` green (incl. property suite, ≥ a few hundred
generated cases) · `bun run typecheck:all` 0 · `bun run lint` clean.

### Phase B — `activity.store.ts` coordinator + slice routing (presentation). Behind the existing UI.
Introduce the store; migrate `RecentActivityView`/`activity.vue`/`journal/[id].vue` to read `activeSlice`; route
tx + journal + incoming producers to `sliceFor(record.scope)`; switch = key swap (instant-cache). Keep Phase-1
drop-guards as defense-in-depth + add assertions that they never fire in tests. Profile-aware filters (H7).
**Gate:** component tests for the store (scope routing: a foreign-scope event never mutates `activeSlice`; A→B→A
swap restores B-cached rows without refetch; instant-cache = no clear flash) · `bun run --cwd apps/extension test
src/stores src/popup/components/modules/general src/composables/useIncomingTransfers` · typecheck:all · lint ·
`bun run test:e2e` (smoke) green.

### Phase C — Queued-journal + incoming correctness (H1/H2/H3/H8).
`extractSendFrom`; shared index-sorted NO_FROM helper (create == dispatch); lock-serialized delete + tombstone;
`(scope, siloedNullifier)` re-key. Unit tests for each hazard (session `[A,B]` send-from-B journals under B;
NO_FROM picks index-0 wallet-order match; racing delete+transition doesn't resurrect; cross-network same-nullifier
lands in distinct slices).
**Gate:** `bun run --cwd apps/extension test src/wallet/services/{operation-journal,incoming-transfer,wallet-sdk}`
· typecheck:all · lint green.

### Phase D — Execution abort-on-drift (H4/H5/H6) + warning UX.
`captureExecutionFence(expectedProfileId)` atomic; `requireScopeUnchanged(fence)` at mutex-key + both builders;
`ExecutionScopeDriftError` typed non-retryable; `pending`-residue terminalize + tombstoned remove; toast warning.
Unit + composition tests: fence atomicity (switch racing capture throws mismatch); drift at builder aborts, emits
remove, no tx built; residue cleanup terminalizes pending; the happy path (no switch) still sends.
**Gate:** `bun run --cwd apps/extension test src/wallet/services/{profile,execution,dapp-interaction}` + the
`*.composition.test.ts` for the send lane · typecheck:all · lint · `bun run test:e2e` green. Existing network
e2es that exercise the shared lane must stay green in Phase F.

### Phase E — Multi-PROFILE + multi-account network e2e harness + test.
New `tests/e2e/network/profile-account-siloing.test.ts`: two profiles P1/P2, each ≥2 accounts, with a colliding
account address across profiles (same mnemonic re-imported OR deterministic address reuse) to force the
worst-case. Deterministically reproduce H5: begin a dApp send under P1/A1, hold it at the prove gate (the
`E2E_PROVERLESS`-gated bidirectional poll gate from Phase 1, DCE'd + negative-grep-guarded), switch to P2, release
→ assert the op ABORTED (warning toast asserted via `waitForToast`), no P1 card under P2, and no tx bound under
P2. Positive control: no-switch send completes; switch-back shows P1's own cached feed instantly.
**Gate:** `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/profile-account-siloing.test.ts`
green · negative-grep (gate absent from prod build) green.

### Phase F — Full regression + blast-radius + `/harden security`.
Run the shared-lane network e2es that this PR's execution changes could regress:
`concurrent-sendtx*`, `cancel-mid-prove`, `transfers`, `multi-account-from`, `account-switch-isolation`
(Phase-1 test must stay green — proves no regression). Full `bun run audit:vue`. Then schedule `/harden security`.
**Gate:** the named network e2es + `audit:vue` all green; `/harden security` scheduled.

## 3. Security & Adversarial Considerations
- **Threat model:** the asset is per-scope privacy (who received/sent what) + execution integrity (a tx only ever
  binds to the authorizing scope). Attackers: a malicious dApp (drives sends + rapid session changes), a
  shoulder-surfer exploiting a switch flash, a local attacker replaying storage.
- **Cross-scope leak:** structurally closed by slice routing (a record can't reach a foreign slice). Filters +
  assertions are defense-in-depth. The e2e MutationObserver (Phase 1) proves no transient paint.
- **Execution trust boundary:** the fence is the boundary; abort-on-drift enforces "authorize-scope == bind-scope
  or abort". Residual check→submit window is mutex-narrowed + documented, not hand-waved.
- **Abort as a DoS/UX surface:** a malicious dApp can't force-abort a *user's own* wallet-initiated send (those
  don't cross the dApp boundary); it can only get its OWN request aborted by inducing a switch — which is the
  user's action, and the correct outcome. The warning copy must not leak the other scope's identity.
- **Aztec note provenance:** owner is the trusted `NoteDao.owner`; delegated discovery legitimately differs — do
  NOT reintroduce the reverted `content.owner` drop.
- **Supply chain / crypto:** no new deps expected; if a property-test lib is added it must clear the 7-day min-age
  gate. No crypto rolled. `bun.lock` committed; frozen-lockfile CI.
- **Storage as attacker-controlled:** the durable counter/tombstone store is treated as hostile on read (a
  tampered high-water could suppress real events — but that's a self-DoS on the local user's own view, not a
  cross-user leak; presence-guard + clamp, don't trust blindly).

## 4. Assumptions
**Facts (verified this session / in-repo):**
- Phase 1 shipped #314 (780cdec1 on dev): sync-clear-on-switch + generation-guarded fetches + scope-filtered
  ingest + fail-closed visibility. (`useIncomingTransfers.ts`, `app.store.ts`, `activity-rows.ts`,
  `RecentActivityView.vue`, `incoming-transfer/service.ts`.)
- The 5 codex rounds (r1–r5) located H1–H7 at the exact files/lines in the hazard catalog (see
  `research/audit-codex-p1a-*.md`).
- Dispatcher NO_FROM rule is index-sorted wallet order (`dispatcher.ts:1349-1385`).
- p1a branch `a6ed183` has a reference abort-on-drift + fence impl to crib from.
- Pre-production ⇒ no numbered migration required (CLAUDE.md account-address-freeze / migrations section).

**Inferences (attack these):**
- (I1) A single Pinia store owning all slices is the right seam — vs. leaving state in `app.store` + composables.
  If the store forces a big rewrite of stable Phase-1 code, a thinner "route to per-scope refs" design may be
  lower-risk. NEEDS the auditors' read.
- (I2) Durable per-source counters can live in `chrome.storage.local` behind the facade without a perf hit on the
  hot event path (batched writes). Unverified.
- (I3) The mutex-key-on-fence.profileId fully serializes the shared lane so no concurrent-switch interleave occurs
  between builder-check and submit. Needs a concurrency audit against `concurrent-sendtx`.
- (I4) LRU eviction of cold slices won't user-visibly regress instant-cache for realistic scope counts.

**Asks (surface at gate):**
- (Q1) Confirm DROP of the dApp-card re-enable (decision 2 — planned dropped; final confirm).
- (Q2) Confirm ONE big PR despite it touching the shared execution lane (blast radius) vs. a 2-PR split
  (presentation slices first, execution abort second). User chose one PR; re-confirm given F's regression list.
- (Q3) Colliding-address strategy for the e2e (re-import same mnemonic across profiles vs deterministic reuse).

## 5. Decision ledger
- **Abort-on-drift (chosen) vs thread-captured-scope-through-execution (rejected):** user decision 1; abort is far
  smaller blast radius and doesn't require every downstream (mutex, builder, getAccountContract, SDK call) to
  accept an out-of-band scope. Cost: a switch mid-send loses that send (acceptable — user chose to switch).
- **Slices (chosen) vs guards-only (Phase-1 status quo, rejected as the primary barrier):** slices make
  containment structural + deliver instant-cache; guards stay as defense-in-depth. Cost: more moving state +
  memory (mitigated by LRU).
- **Durable protocol as a pure spiked module (chosen) vs inline in the store (rejected):** isolatable property
  testing is the whole point; inline can't be exhaustively property-tested.
- **ONE PR (user-chosen) vs split:** mitigated by F's explicit regression list + keeping Phase-1 code as
  defense-in-depth so a slice bug fails safe.

## 6. Bug-finding answers (self-attack)
- *Can a producer route to the active slice by mistake?* Only if it computes the key from `active*` instead of the
  record's own scope. Mitigation: `sliceFor(record)` takes the RECORD, never the store's active key; a lint/test
  asserts no producer reads `activeScopeKey` on the write path.
- *Switch mid-snapshot lose/dupe a record?* The watermark makes snapshot application per-record-monotonic;
  property test covers snapshot-vs-newer-event and delete-during-snapshot.
- *Does the epoch cover SW-restart + re-import?* Restart rehydrates counters from durable store (no reset-to-0);
  re-import bumps epoch so the old incarnation's late events drop. Both are property-tested.
- *Abort-on-drift airtight?* Closes check→build; residual check→submit is mutex-narrowed + documented. The
  honest residual is called out, not hidden.
- *Malicious dApp weaponizing aborts?* It can only abort its own request by inducing a user switch — correct
  behavior; copy leaks no other-scope identity.
- *One-PR blast radius?* F names the exact shared-lane e2es that must stay green; Phase-1 code stays as a
  fail-safe under the new structural layer.
