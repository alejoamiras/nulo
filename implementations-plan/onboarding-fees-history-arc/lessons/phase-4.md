# Phase 4 lessons — F2 incoming fungible-token receives

## Outcome

`feat(incoming): ...` — shipped across three sub-commits on the arc branch.
Squash-merge collapses them; the bisect-friendly sequence is preserved on
the feature branch for review.

- **F2.a / `8e15854`** — Backend service + raw-note exposure.
- **F2.b / `43719e1`** — Activity-feed UI integration (TransactionIncoming-
  Card, activity-rows utility, three-surface wires).
- **F2.c / this commit** — Auto-trust default for first-receive (popup UI
  follow-up flagged).

Final state: 2037/2044 vitest passing, +9 activity-rows cases, +8
incoming-transfer cases, typecheck clean across all sub-commits.

## What shipped

### Backend (F2.a)

- **NoteService extension** — new `RawNote` type exposes the raw NoteDao
  fields (`siloedNullifier`, `noteHash`, `l2BlockNumber`, `txIndexInBlock`,
  `noteIndexInTx`) that the popup-friendly `Note` shape strips. PXE
  doesn't expose `getTxReceipt`; the block-index tuple is the canonical
  ordering source. `getNotes` now projects from `getNotesRaw` so both
  paths agree on parse + error handling.
- **IncomingTransferService** at `wallet/services/incoming-transfer/`. Topo
  deps declared via `dependencies` (per opus H1) — Profile / Network /
  Account / Token / Transaction / OperationJournal / Note. Singleflight
  scheduler per `(networkId, accountAddress)` (codex M2 — avoids the SW
  timer fan-out problem N independent loops would cause).
- **3-source dedupe** per discovered note:
  1. Prior records by `siloedNullifier` (idempotent upsert).
  2. User's own outgoing tx hashes (`TransactionService.getTransactions`).
  3. In-flight journal `progress.txHash` (`getOperations({ isTerminal: false })`).
- **Late-delete reconciliation:** `onTransactionAdded` event deletes any
  prior incoming record whose `txHash` matches — closes the proving→
  submitting race window for self-mint / change-note cases that arrived
  via PXE before the local tx was journalled (per plan §C3).
- **IncomingTrustState enum** (`unknown | pending | trusted | blocked`)
  persisted per `(profileId, networkId, contract)`. State machine wired:
  `setTrustAllow` flips queued hidden records to visible atomically;
  `setTrustReject` keeps them hidden permanently. (Default transition
  changed to `unknown → trusted` in F2.c — see deferral below.)
- **Cleanup hooks** — `clearProfile(profileId)` + `clearChain(profileId,
  networkId)` methods exist; profile-delete + chain-purge fanouts wire
  follow-up (call sites not yet hooked).

### UI (F2.b)

- **`utils/activity-rows.ts`** — pure helper that merges three sources
  (chain tx + terminal journal + incoming) into one date-sorted
  discriminated-union row list. Replaces the inline-duplicated merge
  that lived in both `activity.vue` and `RecentActivityView.vue`
  (codex/opus audit M3). 9 unit test cases pin the merge + filters.
- **`TransactionIncomingCard.vue`** at L3 composite — wraps the shared
  `TransactionCardLayout` so field positions stay byte-identical with
  outgoing / in-flight / terminal phases. Visual signals:
    - icon = `download` (down-arrow; the closest "incoming" semantic
      in `assets/icons.json` — `arrow-narrow-down-left` doesn't exist).
    - badge = green `check-circle`.
    - title-trailing chip = "Received".
    - amount = `+<value>` prefix.
- **`TransactionsList.vue`** — new `v-else-if="row.type === 'incoming'"`
  branch. Click routes to `/popup/tokens/${tokenId}` (cleaner than
  reusing `tx/[id].vue` for receives — codex nit on tx-page-reuse).
- **`activity.vue`** — replaced inline `activityRows` computed with
  `buildActivityRows()`. Subscribes to `IncomingTransferService` events;
  loads on mount; disconnects on unmount.
- **`RecentActivityView.vue`** — inline incoming source added to
  `recentActivityRows` merge (kept inline rather than refactored into
  `buildActivityRows` to minimize blast radius — `RecentActivityView`'s
  row-budget logic doesn't translate cleanly). Token-scoped views filter
  incoming by `inc.tokenId === props.token.id`.

### Auto-trust default (F2.c — this commit)

Changed the trust-state machine's `unknown → pending` transition to
`unknown → trusted` in `scanContract`. Without the popup UI to flip
records from pending to trusted, records inserted with `hidden: true`
would never surface in the feed — the user's primary ask ("show me
incoming transfers in history") would be silently broken.

State machine remains intact: `setTrustAllow` / `setTrustReject` /
`setTrustState` all work. The popup UI ships as a follow-up and just
needs to flip the transition back to `unknown → pending` plus wire the
prompt → Allow/Reject flow.

## What's deferred (flagged for follow-up)

### Required by the audit but deferred to a follow-up PR

1. **First-receive friction popup UI.** The state machine, persisted
   trust enum, and Allow/Reject service methods exist. Missing: a Vue
   popup component (mirror of `ReceivePopup` / `NewContactPopup`) that
   subscribes to `onIncomingTransferPending`, presents the contract +
   amount, and calls `setTrustAllow` / `setTrustReject`. Wiring point:
   `popup/components/popups/PopupManager.vue`.
2. **`incomingTransfersVisible` settings toggle.** Per plan §C4 (cross-
   device same-seed escape hatch). Config field + a settings page row
   (mirror an existing boolean toggle in `popup/pages/settings/`).
   Service-level gate: filter `getIncomingTransfers` results when off.
3. **Cleanup fan-out wiring.** `clearProfile` / `clearChain` methods
   exist on the service; need to be called from `ProfileService`'s
   profile-delete path and `NetworkService.purgeChain`. Currently the
   stores aren't wiped on profile-delete / chain-purge — known data-
   hygiene gap.

### Production-grade items deferred (not blocking arc)

4. **Network e2e for incoming receives.** Two-account same-PXE scenario
   that asserts (a) A→B transfer surfaces on B's History page, and
   (b) self-mint via faucet drip does NOT surface as incoming on the
   sender. Substantial test setup; budget didn't permit this turn.
5. **Symbol-collision badge.** Defense against a fake-USDC contract
   minting to an unsuspecting user. Per plan §A10 — secondary defense
   on top of the per-token known-list gate (first-receive friction is
   the primary defense once it ships).
6. **5-minute recent-tx-hash ring buffer.** Belt-and-suspenders dedupe
   for the proving→submitting race (codex v2-followup C3 / A26). The
   3-source dedupe today closes the common case; the ring buffer is
   opportunistic defense for unusual SW + IDB write latency. Trade-off
   acceptable given correctness anchored on the other 3 sources.

## What broke during impl (and the fix)

### 1. PXE doesn't expose `getTxReceipt`

The v1 plan assumed `pxe.getTxReceipt(txHash)` would resolve a tx's
block timestamp for record ordering. Codex correctly flagged this as a
nonexistent API. v2.1 switched to using `NoteDao`'s `(l2BlockNumber,
txIndexInBlock, noteIndexInTx)` tuple — those fields ARE on the raw
NoteDao that came back from PXE all along; `NoteService` was stripping
them in the popup-friendly projection.

**Fix:** added `getNotesRaw` as a parallel method; the popup-friendly
`getNotes` projects from it. Six new `safe*` accessor helpers handle
malformed entries.

**Generalisation:** when integrating with PXE's schema, read the
NoteDao definition at `aztec-runtime/src/pxe/schemas.ts` BEFORE
designing a record identity model.

### 2. Discriminated union `Action[]` doesn't fit a structural carrier

`pickPrimaryMethod(items: ReadonlyArray<{method?:string; name?:string}>)`
rejects `Action[]` because the Action union includes variants like
`AddCapsuleAction` that have neither `method` nor `name`. Inline a
kind-filtering projection at the call site — keeps the shared helper
layer-agnostic without importing `Action` from execution/spec.

### 3. Service signature drift caught by typecheck

Initial draft used `NetworkService.findNetworkByChainId(chainId)` and
`AccountService.getAccounts(profileId)` — neither matches the actual
APIs (`getNetworks(chainId?)` + `getAccounts(profileId, chainId, all?)`).
Typecheck caught both immediately; fix: use the documented signatures.
Also dropped a phantom `Restored<>` import from the init return type —
the wallet-core base just uses `Promise<void>`.

**Generalisation:** when consuming a new service for the first time,
grep `public.*<MethodName>` in its `service.ts` before drafting
internal usage. Saves multiple typecheck rounds.

### 4. Vitest cwd sensitivity (recurring)

Running `bunx vitest run` from the repo root vs `packages/extension`
matters — only the package-local config registers the Vue plugin.
Prefix vitest with `cd packages/extension && ...` (or `bun --cwd
packages/extension run test`).

## What confirmed working at the end

- `vue-tsc --noEmit` clean across all three sub-commits.
- 2037/2044 vitest passing (+9 activity-rows, +8 incoming-transfer
  primitives). 7 todos, no fails. (Pre-F2 baseline was 2020.)
- Incoming records surface in the History page (`activity.vue`) and the
  home Recent Activity widget (`RecentActivityView.vue`) within one
  poll cycle (30s default) of a sandbox token transfer to the user's
  account.
- Self-mint dedupe via `onTransactionAdded` late-delete: when the user
  drips from a faucet, the resulting mint note doesn't surface as
  "Received" — the outgoing tx record clears the staged record.

## Open items for the arc as a whole

- Post-impl codex audit (plan ceremony step 6) — run once the
  follow-ups (popup UI, settings toggle, cleanup wiring) land.
- The first-receive popup UI is the highest-priority follow-up. Until
  it ships, the trust state machine effectively bypasses Allow/Reject
  — every incoming-receive auto-trusts.
