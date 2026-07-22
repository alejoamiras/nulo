# Account-switch cross-account isolation (item 3 / PR-D) — v2

**Tier:** `/blueprint deep` (rubric: 2 HIGH — security/privacy + blast radius). **Status:** v2, post-double-audit
(codex `reject` v1 + Opus `conditional approve` v1 — both persisted in `audit-codex.md`/`audit-fable.md`;
every finding folded in below). Awaiting the final fresh codex pass. Consolidated from three independent drafts
(`plan-draft-{main,fable,codex}.md`) grounded in `research/surface-map.md`.

**v1→v2 changelog (audit-driven):** raw-slice-placement structural proof (was: delete-ingest-filter, which a
render guard masked); per-record sequence numbers + cross-source atomic revisioning + causal ordering +
tombstone-checked event reducers (was: per-source revisions only); task↔journal binding promoted to an explicit
design phase (`OperationRecord.taskId` does not exist today); `(scope,nullifier)` incoming key + wire-event
validation + in-lock membership revalidation; corrected owner-check semantics + §5 Fact; corrected gate commands
(test:components excluded the real tests; race cmd lacked `NULO_E2E_PROVERLESS=1`; no negative-grep); e2e SW→test
ack channel + arm-ordering + per-surface runs; Phase-2 optional-schema + per-row-tolerant codec; A1 reframed to
per-document scope; A2/A3/A5 promoted to adopted-with-constraints; off-ramp reframed (ship-now, not stable endpoint).

---

## 1. Problem + root cause

On **account switch within a profile**, the tx feed leaks account A's state into account B's view. The feed is
assembled from **flat active-view state** (`transactions`, `awaitingTransactions` in `app.store.ts`;
`journalOps`, `executingTask`, `executingSubtasks`, `pendingCancelJobIds`, `incomingTransfers` local to
`RecentActivityView.vue`/`useIncomingTransfers.ts`) mutated by **broadcast events + async fetches keyed on
"whatever account is active NOW"**, not the account the data belongs to. The feed mounts with **no account
`:key`** (`general.vue:27`, `tokens/[id].vue:210`) → never remounts → all state survives.

**Four facets (all in scope):** (1) stale history persists; (2) **incoming-transfer leak (privacy core)** — the
service polls all accounts, emits in `scanContract`'s locked commit (`service.ts:684-686`), `sendEvent`
broadcasts to every client unfiltered (`packages/extension-messaging/src/background/service.ts:84-93`), the
composable appends with no account check (`useIncomingTransfers.ts:61-69`), and only journal is render-scoped
(`utils/activity-rows.ts:57`) leaving tx+incoming unscoped; (3) task/cancellation mis-scoping
(`clearExecutingTaskIfPendingCancelTerminal` jobId-only `:480-486`; dApp `isExecutingTask` kind-only `:568-580`;
`ExecuteOperationContent` no account `task/spec.ts:76-83`); (4) data-model gap (root) — flat active-view state
has nowhere correct to put a late A result; **broader than first framed:** `transactions` + `incomingTransfers`
are also flat. Full inventory: `research/surface-map.md`.

---

## 2. Chosen approach — staged structural migration, guards-first

All three planners converged on staged-structural; **the main draft alone preferred scoped guards as the final
state — recorded honestly in §6.** Do NOT big-bang. **Phase 1 ships a COMPLETE containment layer (a real ship-now
privacy fix).** Phases 2–4 migrate producers into per-account composite-scope slices **behind the live guards**,
each proven by a **raw-slice-placement invariant** (§3). **Off-ramp:** Phase 1 is a legitimate ship-now privacy
fix, but it is NOT claimed as a stable end state — it is the guards-as-final-state posture the ledger flags as
fragile; stopping there is a deliberate ship-vs-harden tradeoff, not "correctness guaranteed forever."

### 2.1 Isolation model (the correctness core)

- **Composite scope, never account-alone:**
  `type ActivityScope = { profileId: string; networkId: string; chainId: number; accountAddress: string }`.
- **Per-document scope, not a global.** `account` is a plain `ref` (`app.store.ts:49`), NOT synced; popup and
  side panel each have their own store and CAN diverge. Every scope reads the **document's own store**, never the
  global `nulo:ui:activeAccount` value. Each document is self-consistent; its ingest filter drops the other
  account's broadcast. (Corrects v1 A1.)
- **Trusted key = `record.accountAddress`** — the PXE account the wallet chose to scan, stamped from the poll
  param (`service.ts:574,776`); PXE only decrypts a note under the account whose viewing keys match, so a sender
  cannot make a note surface under a different `accountAddress`. **`owner` (`service.ts:780`) falls back to that
  same trusted `accountAddress` when absent** (NOT to any "active account" — there is none in the scan context).
  `owner` is sender-settable and persisted as unconstrained `z.string()` (`spec.ts:91`): **canonicalize-or-drop
  it at ingest, and add a static guard that no render/scope/dedup path reads `owner`.** Dedup on `siloedNullifier`
  (cryptographically unique, `spec.ts:9,34`) is safe.
- **Fail-closed:** malformed/unscoped/ambiguous → dropped, never assigned to the active account. Ambiguous legacy
  records hidden from account feeds, never shown broadly.
- **Synchronous clear in the mutation path.** The visible-ref clear MUST live in the centralized active-account
  setter (or use `watch(..., {flush:'sync'})`) — NOT the default async `app.vue:87` watcher, which flushes on
  `nextTick` and leaves a one-tick window where A renders under B (breaks §7's "absent immediately").

### 2.2 Concurrency algorithm (rewritten per audit — the part v1 got wrong)

A captured-generation token alone is insufficient (it gates only awaited fetches that capture it — not broadcast
events, reconnects, cross-source mutations, A→B→A, delete-during-snapshot, or a delayed-old-event vs newer-state).
The durable design:

1. **Composite-scope ownership** — every record lives in the slice for its own `ActivityScope`, routed from its
   own payload, never from "active now."
2. **Causal ordering via monotonic service sequence numbers** — the incoming/journal/tx services stamp each
   emission with a per-scope monotonic `seq` (NOT `updatedAt`, which isn't available/comparable across sources).
   A reducer applies an event only if its `seq` exceeds the record's last-applied `seq`; a delayed OLD event is
   dropped. (Requires adding `seq` at the service boundary — an explicit Phase-1 sub-task.)
3. **Per-record tombstones** — a delete records a tombstone `{id, seq}` in the slice; a later add/update with a
   lower-or-equal `seq` is rejected (can't resurrect). Tombstones are bounded/aged.
4. **Snapshot vs event reconciliation (delete-safe):** register listeners BEFORE the snapshot; capture the
   scope's `seq` high-water-mark at fetch start; on resolve, if the scope is tombstoned OR the request is no
   longer latest → discard. **If ANY event (esp. a delete) arrived during the fetch → do NOT merge-by-ID
   (merge can't tell "absent because deleted" from "present at fetch"); reschedule a fresh authoritative
   snapshot.** Only when zero events arrived may the snapshot replace the source rows.
5. **Cross-source atomicity** — a mutation touching multiple sources (e.g. `onTxAdded` removing an awaiting
   placeholder; journal-terminal cleanup of awaiting/task/cancel) advances **every affected source's** high-water
   `seq` atomically, so a concurrent snapshot of any of them can't restore the removed row.
6. **Tombstone-checked event reducers** — event reducers (not just fetches) drop writes to a tombstoned/invalidated
   scope. Critical: re-importing the same mnemonic yields the SAME scope key, so a late A event after A's deletion
   must not resurrect a row under the "new" account.
7. **The service keeps polling inactive accounts** (notifications/awaiting) — switching changes presentation, not
   discovery; no scheduler torn down.

---

## 3. Phases + validation gates

Real commands (verified in `apps/extension/package.json` + `scripts/e2e/agent.sh`). **Corrected per audit:**
- Unit/component for popup + composable tests: **`bun run test <path>`** (the root `test` runs the full extension
  vitest project). `test:components` filters `src/components/**` and would MISS `src/popup/**` + `src/composables/**`
  tests — do NOT rely on it for these.
- Network race test: **`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts`**
  (`NULO_E2E_PROVERLESS=1` is REQUIRED — it's what compiles the poll gate in; without it the gate isn't built).
- Production negative-grep (gate absent from a real build): **`bun run --cwd apps/extension build:chrome` then grep
  the `dist/chrome` bundle for the gate marker + session key → must be ABSENT** (mirror `_build-extension.yml`).

### Phase 0 — Deterministic race-test infrastructure + baseline verification (test-only)
The leak remains until Phase 1. **Blocker first: verify the network-suite baseline** — `tests/e2e/README.md`
describes a partially-failing baseline; run the current required network suite and record the actual green
baseline (Ask A6) so no later gate is declared green against red.
1. **e2e-only incoming-poll gate with a bidirectional ACK channel** (corrects v1's "exactly the proof-gate" —
   the existing `ChromeStorageProofGate` is ONE-WAY). Two `chrome.storage.session` keys: test→SW `hold` (armed for
   `profile+network+account+contract+expected txHash`) and **SW→test `status`** (`armed → discovery-held(txHash) →
   released → committed/emitted`). Hold point inside `scanContract` AFTER `getNotesRaw`, BEFORE the first storage
   critical section (`service.ts:586`→`:612`), never while `serviceLock` held; safety timeout **well under the 30s
   network `testTimeout`** that releases + loudly errors. Armed strictly inside `if (E2E_PROVERLESS)`
   (`src/e2e/config.ts:29-40`) → DCE'd from prod; marker+both keys added to the `_build-extension.yml` negative-grep.
2. **Strengthen e2e helpers:** `switchToAccount(page,{name|address})` waits until BOTH `nulo:ui:activeAccount ===
   target` AND a feed-root scope DOM marker matches (fail with expected+observed); `createSecondAccount`. Extend the
   Aztec mint helper to **return the submitted tx hash**.
3. **Test observability:** a stable non-secret active-composite-scope marker on the feed root; incoming-row
   correlation by tx-hash/nullifier. Reactive appStore test harness (current `RecentActivityView.test.ts:101` mocks
   a STATIC store).
4. **Harness test:** a real private note reaches PXE; the gate `status` reports `discovery-held(txHash)` for the
   exact A note; nothing commits while held; release → A's incoming row appears.

**Gate 0:** `bun run lint` · `bun run typecheck:all` · `bun run test` · `bun run test:e2e` ·
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts`
(harness portion executes, not skips; `status` proves poll held after discovery, before commit) · negative-grep
(gate absent from `build:chrome`). **Pass:** all exit 0; baseline recorded; no new console/page errors. **Layers:**
gate unit, component, smoke, real network.

### Phase 1 — Complete containment (FIRST RELEASABLE SECURITY FIX — all four facets)
Verifies the **account+chain** invariant (the same-network A→B leak). The full profile/network composite invariant
lands in Phase 2 once tx records carry `profileId`/`networkId` — Phase 1 does not overclaim it.
1. **Canonical scope + synchronous switch boundary.** Shared `ActivityScope`/scope-key helper (structured, not
   ambiguous delimiter strings). Centralize active-identity mutation (writers `app.store.ts:55-76,84-90`,
   `NewAccountPopup.vue:54-59`, profile/network/bootstrap/reset); the setter owns persistence. On every effective
   change: synchronously (§2.1) increment `activityGeneration`, clear visible active-view refs (what B can SEE; do
   not delete A's durable/in-flight work), mark loading, then snapshot the captured scope.
2. **Add per-scope monotonic `seq`** at the incoming/journal/tx service emission boundaries (§2.2.2) — the
   foundation the reducers need.
3. **Transaction containment (`app.store.ts`).** Capture scope+generation before `getTransactions`; commit only if
   current; filter rows to captured account+chain. `onTxAdded` updates the active view only when tx scope == live
   scope; placeholder cleanup by `tx.account` + the placeholder's captured scope. `onTxUpdated` requires account
   **plus** hash (hash-only updates the wrong account's row). Symmetric delete via tombstone. Fix `send.vue`:
   unique awaiting-placeholder ID + captured scope; rejection removes that exact ID from that scope.
4. **Incoming containment (`useIncomingTransfers`, shared by both surfaces).** Synchronous scope-tuple watcher:
   clear the visible ref on change; capture `{scope, requestVersion, seq}` before refresh; reject stale responses;
   accept Added/Updated/Deleted only when profile+network+accountAddress exactly match live scope AND pass the
   §2.2 seq/tombstone checks; never infer a missing account; deregister on dispose. One impl for
   `RecentActivityView.vue` AND `activity.vue`.
5. **Journal/task/cancellation containment.** Ingest-filter journal by exact scope; snapshot by all scope fields;
   reject stale by seq/request-version; hide scope-ambiguous journal records. **Task↔journal correlation is an
   undesigned protocol today** (`OperationRecord.taskId` does NOT exist; dApp journals precede task creation,
   transfer tasks precede journal creation — see Phase 1a). **Until an atomic binding lands, fail closed: disable
   ALL uncorrelated TaskService cards AND journal enrichment** (not merely orphan cards — a kind-only dApp task can
   still decorate B's journal card). Journal cards remain the progress source.
6. **Defensive final filter.** `buildActivityRows` requires active scope for all three row types (defense-in-depth).
7. **Incoming trust-boundary validation (fail-closed, WIRE-LEVEL).** Zod-on-records is insufficient — the messaging
   client dispatches events unparsed. Add: service-side param validation, client-side result validation, and an
   **event-dispatch validation override** so every wire event is parsed before the handler runs. At scan time
   (revalidated INSIDE the locked commit, not only before PXE I/O): account ∈ requested profile+network; note
   contract == the scanned registered token; **`content.owner`, when present, == captured accountAddress (absent →
   OK, uses the trusted fallback)**; reject `renderError`/malformed-note-render fallbacks (never convert to a
   record); canonical address/hash/nullifier; non-negative u128 amount; non-negative safe-int indexes; **identity
   keyed by `(scope, siloedNullifier)`, not a global nullifier** (avoids cross-scope collision). Drop+minimally-log
   malformed events without recording contents/amounts/addresses.
8. **Fail-closed visibility.** Change `isVisibilityEnabled` (`service.ts:692-701`) from fail-open to **fail-closed
   for UI emission/read while retaining records** for recovery. (Promoted from Ask A2 to adopted.)

**Gate 1:** lint · typecheck:all · `bun run test <store/composable/component test paths>` (late A snapshot after
A→B can't change B; A→B→A rejects the older request; onTxUpdated account+hash; scoped placeholder cleanup;
delete-during-snapshot does NOT resurrect (reschedule path); a late old-`seq` event is dropped; cross-source
placeholder-removal survives a concurrent awaiting snapshot; wire-event validation drops malformed) ·
`bun run test:e2e` (both switch entry points) ·
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts`
(**RED before, GREEN after**) · full `NULO_E2E_PROVERLESS=1 bun run e2e:agent` · negative-grep.
**Pass:** all exit 0; the race test passes with retry disabled; no A incoming/settled appears in B (account+chain);
malformed/wrong-scope dropped. **Layers:** unit, component, smoke, deterministic network.

> **Privacy milestone: Phase 1 closes the leak for the same-network case.** Phases 2–4 harden (regression risk,
> not new leak) and extend to the full profile/network composite invariant.

### Phase 1a — Task↔journal binding protocol (explicit design + impl; gates the task facet's structural fix)
Because no shared correlation ID exists, design an **atomic** binding: mint a correlation ID at task creation and
carry it onto the journal record (and vice-versa for the paths where the journal precedes the task), covering both
orderings (transfer: task→journal, `transfer-executor.ts:82-115`; queued dApp: journal→task, ID attached when
claimed). **Gate:** unit tests proving every task has a resolvable journal correlation at switch time (and the
absence case is fail-closed). Until this passes, Phase 1.5's "disable all uncorrelated task cards" stands.

### Phase 2 — Structural slices: migrate transactions + awaiting (keep Phase-1 guards)
New `activity.store.ts` coordinator (do NOT bloat `app.store.ts`); session-memory `Map<ActivityScopeKey,
ActivitySlice>` with readonly `activeSlice`, `ensureSlice`, scoped reducers, scoped snapshot begin/commit, and
scope invalidation (profile lock / account+network delete / reset → tombstoned so late writers can't resurrect).
Migrate `transactions`+`awaitingTransactions`: route by the record's OWN metadata. **Add `profileId`+`networkId`
to newly persisted tx records (Ask A3 → adopted), with two hard constraints (per audit): (a) the new TxSchema
fields are OPTIONAL so legacy rows still parse; (b) the storage codec is PER-ROW TOLERANT — a legacy/ambiguous row
is skipped, never thrown, so it can't brick the whole `transactions` load.** The tx repository is currently
**globally hash-keyed** — re-key by `(scope, hash)`. Thread `profileId`/`networkId` from execution (fence exists);
update backup/restore fixtures + lookup keys + legacy decode. Pre-production ⇒ no numbered migration (CLAUDE.md).
Apply §2.2 throughout.

**Gate 2:** full fast layers (correct paths) + `test:e2e` + `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 e2e:agent
[race file]` + full `e2e:agent`. **Pass:** consumers no longer mutate flat arrays; a late A tx event is retained in
A's inactive slice, absent from B; switch-back-to-A shows it without popup restart; deletion/lock prevents
resurrection; legacy rows parse (optional schema) and ambiguous ones are hidden; Phase-1 assertions green.

### Phase 3 — Structural slices: migrate incoming + journal + task + cancellation
Route every incoming/journal/task event from its PAYLOAD scope into the owning slice (even inactive; tombstone-
checked, §2.2.6). Move `journalOps`/task-enrichment/subtasks/`pendingCancelJobIds` into the coordinator; migrate
`activity.vue` to the same store (kill duplicate reload paths). Exact correlation `journalOpId ↔ taskId ↔
cancelJobId` (from Phase 1a). Keep ingest filtering + guards as permanent defense-in-depth.

**Gate 3 (raw-slice-placement structural proof — the v2 fix):** the isolation test asserts **which slice each
record lands in** (a metamorphic placement invariant: for an arbitrary mix of A/B records + events + a switch, the
active slice contains exactly the active account's records and every A record is in A's slice), **evaluated with ALL
runtime scope enforcement disabled simultaneously — the ingest filter AND `buildActivityRows`' render filter AND the
synchronous visible-ref clear** — so a render guard cannot mask a mis-route. Plus full layers. **Pass:** no flat
`journalOps`/`incomingTransfers`/`executingTask`/`pendingCancelJobIds` in either component; an A emission while B
active updates A's slice ONLY (asserted at slice level, not render); switch-back shows it; an A terminal can't
mutate any B task/cancel set; both feeds make identical scope decisions.

### Phase 4 — Remove compatibility state + adversarial cleanup
Remove flat compat APIs; remove duplicate scope/reload from both surfaces. Static regression guards: no
active-account fallback in reducers; no direct activity-array mutation; **no render/scope/dedup path reads `owner`**;
no unscoped task/journal creation for feed op-kinds. Codify legacy handling (scope-complete → migrate; ambiguous →
exclude, adopted A5). Verify every reset/lock/profile-switch/network-switch/account-hide-delete/SW-reconnect path
invalidates or reloads the correct scopes. Privacy-safe diagnostics only (counts + scope-gen IDs; never
addresses/amounts/payloads). **Then 2–3 independent codex auditors** (not `/harden`).

**Final gate:** lint · typecheck:all · `bun run test` · `bun run test:e2e` ·
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 e2e:agent [race file]` on **≥3 cold sandbox starts** ·
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 e2e:agent` (full suite) · negative-grep. **Pass:** all exit 0; race test
passes 3 cold runs zero-retry; gate code absent from the release bundle; auditors find no cross-scope write using
live active identity and no unvalidated incoming path. **Off-ramp:** stop after Phase 1 (ship-now privacy fix) or
Phase 3 if a structural phase's blast radius is judged too high at review.

---

## 4. Security & Adversarial Considerations

**Asset:** account unlinkability WITHIN a profile — B reveals nothing about A, especially received funds
(third-party sender). Leak exposes A's token relationship/amount/timing/tx-hash/cadence to a shoulder-surfer /
screen-share / support viewer of B.

**Threat actors.** (1) **Note sender (real adversary):** anyone can author an Aztec note to any account, controls
amount/owner/txHash/contract, influences decrypt timing → tries to land an emission in the switch window;
provenance untrusted end-to-end. (2) **Malicious dApp:** times `send_transaction` to occupy `executingTask` across
a switch (`origin.name` already render-sanitized `:173-180`); `register_token` spam gated by the trust FSM. (3)
**Shoulder-surfer/screen-share.**

**Trust boundary = `scanContract` ingest, revalidated inside the locked commit.** TRUSTED: `record.accountAddress`
(wallet chose the scan account; PXE per-account decryption makes cross-account surfacing impossible; `owner` falls
back to it when absent). UNTRUSTED: `owner` (sender-set, `z.string()` `spec.ts:91` — **canonicalize-or-drop, and no
path may read it**; static guard), amount, txHash, contract, note ordering, event-delivery order, PXE timing,
reconnect replay. UI says "Received," not "Received from X." **Wire-event validation** (service param + client
result + dispatch override) closes the unparsed-event hole. **`(scope, siloedNullifier)`** identity avoids
cross-scope collision. **Visibility fails closed** (retains records). Existing input validation kept (contract
watched AND trusted, FSM read fresh in-lock `:647`; `parseNoteAmount` null-guards).

**Least privilege:** feed gets one readonly `activeSlice`; reducers take explicit scope, cannot read
`appStore.account` as a write destination; cancellation verifies the job in the active slice before dispatch;
profile lock clears popup-resident slices.

**New attack surface = the e2e poll gate (now bidirectional):** contained by the proverless double-opt-in + DCE +
positive/negative bundle-greps (both keys). A shipped gate could stall the poller — contained by the same envelope
as the more-dangerous proverless proof gate; safety timeout bounds any stall. No new deps/permissions/crypto.

---

## 5. Assumptions

### Facts (file:line-verified)
- Emit broadcasts to every client unfiltered (`background/service.ts:84-93`); composable ingest unfiltered
  (`useIncomingTransfers.ts:61-69`); no reload on switch (:80-81); render scopes only journal (`activity-rows.ts:57`).
- Scan captures accountAddress at start, emits in lock (`service.ts:555,574,684-686`); **`owner ?? accountAddress`
  — fallback is the trusted scan `accountAddress`, NOT any "active account"** (`service.ts:780`; corrected from v1).
- `account` is a plain (unsynced) ref (`app.store.ts:49`; contrast `useSyncedRef` :165) → popup + side panel diverge.
- `selectAccount` mutates before awaiting persistence (`app.store.ts:71-75`), called un-awaited
  (`AccountsPopup.vue:30-33`); switch watcher async (`app.vue:87-95`); `syncTransactions` unconditional (:153-157);
  `onTxAdded` unconditional / `onTxUpdated` hash-only (:131-151); tx repo globally hash-keyed.
- `executingTask`/`journalOps`/`pendingCancelJobIds` flat component-local (`RecentActivityView.vue:128-129,201-203,
  253-254`); pending-cancel clear no identity (:480-485); dApp task no account (:568-580); **`ExecuteOperationContent`
  and `OperationRecord` share NO correlation ID** (`task/spec.ts:76-83`) — the binding does not exist.
- Incoming client unvalidated passthroughs + unparsed event dispatch (`client.ts:16-54`); schema generic strings
  (`spec.ts:84-101`); `isVisibilityEnabled` fails open (:692-701); `siloedNullifier` cryptographically unique
  (`spec.ts:9,34`).
- No account `:key` (`general.vue:27`); proof-gate is ONE-WAY (`chrome-storage-proof-gate.ts`); `E2E_PROVERLESS`
  double-opt-in (`config.ts:29-40`); network suite serial (`vitest.e2e.network.config.ts`); 30s default poll
  (`service.ts:30`); rows expose `data-account-address` (`AccountsPopup.vue:72-74`); `switchAccountByAddress`
  doesn't wait for target (`helpers.ts:333-343`).

### Inferences (attack these)
- [I1, high] A **third-party trusted, visible** incoming receive for A while B is active leaks persistently (v1's
  "ANY note" was overstated — dedupe/visibility/hidden-trust/prior-idempotency can suppress others).
- [I2, high] Captured-generation is necessary but insufficient → requires seq-ordering + per-record tombstones +
  cross-source atomic revisioning + tombstone-checked reducers (§2.2).
- [I3, CORRECTED] `OperationRecord.taskId` does **not** exist today → the task↔journal binding is a design task
  (Phase 1a), not a given.
- [I4, CORRECTED] The structural proof must disable ALL runtime scope enforcement (ingest + render filter + sync
  clear) or assert raw slice placement — a surviving render guard masks a routing gap.
- [I5, med] Pre-production ⇒ no numbered migration, BUT only with optional TxSchema fields + a per-row-tolerant codec.

### Asks
- **A1 [reframed]** Confirm each document scopes on its OWN store (never the global `nulo:ui:activeAccount`); popup
  + side panel legitimately diverge and each must stay self-consistent.
- **A2 [adopted → Phase 1.8]** `isVisibilityEnabled` fail-closed for UI while retaining records. (Confirm product intent.)
- **A3 [adopted → Phase 2]** Add `profileId`+`networkId` to new tx records with optional schema + per-row-tolerant codec.
- **A4 [open]** On switch, show B's records immediately from the per-account slice (Phase 3) or accept brief
  empty-then-refresh (Phase 1)? UX call — affects whether Phase 3 is hardening or required UX.
- **A5 [adopted → Phase 1.5/4]** Hide scope-ambiguous legacy records from account feeds.
- **A6 [Phase 0 blocker]** Verify the current green network-suite baseline (README describes a partially-failing one)
  before declaring any gate green.

---

## 6. Trade-off + decision ledger

| Approach | Impl risk | Residual privacy risk | Verdict |
|---|---|---|---|
| Targeted guards only (final state) | Medium | Medium–High | Fragile — every new listener is another place to forget a guard. **NB: Phase 1 == this posture; the off-ramp ships it deliberately as ship-now, not a claimed-stable endpoint.** |
| Big-bang per-account rewrite | High | Low (if correct) | Too many simultaneous changes; gates the privacy fix behind hardening. Rejected. |
| **Staged structural, guards-first (CHOSEN)** | **Medium (capped)** | **Low** | Phase 1 ships containment; producers migrate behind live guards; raw-slice-placement proof; clean off-ramp. |

**Decision ledger.** Staged-structural guards-first — ADOPTED (**codex + Opus drafts**; the **main draft preferred
guards-as-final-state**, recorded here honestly — v1's "all three converged" was inaccurate). Composite scope —
ADOPTED from codex (corrected account-only keying). Seq-ordering + per-record tombstones + cross-source atomic
revisioning + tombstone-checked reducers — ADOPTED from the audits (v1's per-source-revision model was unsound for
delete/cross-source/causal cases). Raw-slice-placement structural proof — ADOPTED from the audits (v1's
delete-ingest-filter proof was masked by the render guard). Scope on `accountAddress` never `owner` + canonicalize-
or-drop + static no-read guard — ADOPTED (both audits). Wire-event validation + `(scope,nullifier)` key + in-lock
revalidation + fail-closed visibility — ADOPTED from codex. Task↔journal binding as an explicit design phase +
disable ALL uncorrelated task cards until atomic — ADOPTED (both audits; the ID doesn't exist). e2e SW→test ack
channel + arm-ordering + per-surface runs — ADOPTED from the audits (proof-gate is one-way; v1's "exactly" was
wrong). Phase-2 optional-schema + per-row-tolerant codec — ADOPTED (Opus). A1 per-document scope — ADOPTED (both).
**Rejected:** big-bang; account-only keying; generation-token-alone; merge-by-ID under an intervening delete;
short-poll timing e2e. **Still open:** A4 (empty-then-refresh vs cached slice — affects the Phase-3 boundary).

---

## 7. Network-e2e design (deterministic — the ship gate)

`apps/extension/tests/e2e/network/account-switch-isolation.test.ts`, `skipIf(!hasConfig)`,
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0`. Deterministic via the **bidirectional** poll gate (test knows the emission
is pending before switching — the one-way proof-gate can't do this).
**Ordering (corrected — arm cannot precede the hash):** start `tokenReadyExtension` (Local Network, A, token
trusted); `createSecondAccount`→B (creation selects B → switch back to A, wait exact scope). **Submit** a private
mint to A from the independent EmbeddedWallet → **capture the returned tx hash** → **arm the gate** for
`profile+network+A+contract+that hash` → let it mine/discover. Poll the gate `status` until `discovery-held(hash)`.
Install a `MutationObserver` recording A's hash/incoming-marker whenever the feed root declares scope B.
`switchToAccount(B)`; wait persisted==B + feed-root-scope==B + A's settled tx absent immediately (sync-clear, §2.1).
`releaseIncomingPoll`; **wait `status===committed/emitted`** (proves the late event fired after the switch — a
negative DOM assertion without it is meaningless).
**Assert while B active:** A's settled hash never appears; A's incoming hash/nullifier never appears; no incoming row
created-then-removed (observer); B empty or B-only; no A cancel/task marker on B. Observe until emitted + Vue
microtasks flushed + one poll interval.
**Positive control:** switch back to A → A's settled tx + A's incoming (exactly once); persisted record carries A's
exact scope; B still has no copy.
**Recent Activity vs History are SEPARATE runs** (one emission can't live-test both, and History mounts a different
page) — parametrize the surface.
**Zero-timing primary pin:** `useIncomingTransfers.test.ts` — scope=B, `onAdded(recordForA)` dropped; scope-change
clears+refreshes; A→B→A no clobber; a late old-`seq` event dropped; delete-during-snapshot reschedules (no
resurrection). The network test is the integration proof.

---

## 8. Seeds (DRAFT — finalized post-approval)

See `eli5.html` for the pasteable `/goal` (recommended — per-phase gates make completion transcript-observable) and
`/loop 15m` fallback. Hard limits: never merge to dev/main, never publish, never weaken a validation gate, never
expand scope beyond this plan; post-impl = 2–3 independent codex auditors (NOT `/harden`).

---

## Audit verdicts
- **v1 codex (fresh):** `reject` — structural proof masked by render guard; concurrency underspecified (delete/
  cross-source/causal); taskId doesn't exist; global-nullifier key; wire events unvalidated; wrong gate commands;
  A1/A6 blockers. **All folded into v2.** (`audit-codex.md`)
- **v1 Opus (fresh):** `conditional approve` — C1 structural proof, S1/S2 delete+tombstone, S3 ack channel, C3 owner
  check; §5 Fact fix; per-document scope; sync-clear-in-mutation-path. **All folded into v2.** (`audit-fable.md`)
- **v2 final fresh codex pass:** _pending._
