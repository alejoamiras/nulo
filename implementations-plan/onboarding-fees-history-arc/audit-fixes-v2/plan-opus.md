# Audit-fixes-v2 plan — opus (parallel agent transcript)

> Verbatim transcript of the opus Plan subagent's response. Strong points
> consolidated into the final `plan.md`; opus's full reasoning kept here
> for posterity.

## Verdict on the brief

Brief is sound. Two adjustments I'm pushing back on:

1. **B1 scope is bigger than "moderate restructure".** The user says "moderate" but B1 also asks to "mirror `tx/[id].vue` info hierarchy" + "restyle to brutalist tokens" + "add categorical labels for B2". Mirroring `tx/[id].vue` means borrowing its hero-meta row, status-row, optional amount block, address cards, details box, calls box, dev panel — i.e. ~5 structural blocks plus full CSS module replacement. That's a >150 LoC commit. I'm calling that out so the phase isn't budgeted as a CSS-only diff.
2. **"Self-resolve UX" (silent popup-close on late-delete) is more dangerous than the brief implies.** Late-delete happens in the background service; the popup has to learn about it via `onIncomingTrustChanged` (a new "unknown" emit) AND we must ensure no other queued pending prompt for the same triple is sitting underneath. Otherwise we close the visible popup but the queue happily reopens it on the next tick.

## A. Trust-state reconcile invariant

> **Invariant (R):** For any `(profileId, networkId, contract)` triple, trust state = `pending` if and only if there exists at least one non-hidden-allowed record `r` with that triple where `r.txHash` is NOT in the union of (a) `TransactionService` hashes for `accountAddress` on `chainId`, (b) journal `progress.txHash` for in-flight ops with `(accountAddress, networkId)`, AND `r.hidden === true`.
>
> When that condition transitions to false, trust transitions back `pending → unknown` AND any open pending popup for that triple closes.

Enforced by a new private helper `reconcileTrust(profileId, networkId, contract, accountAddress)` invoked from FOUR sites:
- `scanContract` AFTER record insert (closes the race where the scan loop both creates a self-note record AND emits Pending in one tick).
- `onTransactionAdded` after each record delete.
- A NEW `onOperationUpdated` subscriber triggered when the journal record reaches `submitting` carrying a `txHash` (earliest dedupe signal).
- `hydrateSchedulers` end (idempotent ratification after every full re-init, including post-SW-restart).

`reconcileTrust` emits `onIncomingTrustChanged({state: "unknown"})` so the popup can detect "the contract I'm prompting for just lost its grounds" and auto-close.

## B. Phase breakdown — 14 commits

(see plan.md for the consolidated version; this transcript preserves opus's original 14-phase shape — most phases adopted, a few sequenced differently)

### P1 — Onboarding copy (A1-A4) — trivial, no tests
### P2 — Method-label D1 — trivial, one unit pin
### P3 — ARIA `aria-controls` (codex Low #1) — switch v-if to v-show
### P4 — `onTransactionAdded` reentrancy guard (codex Med #2) — per-hash Set
### P5 — PopupManager OFF→ON visibility seed-before-listen (codex Med #1) — listener registration INSIDE onMounted after seed
### P6 — `reconcileTrust` helper + late-delete reverts pending→unknown
### P7 — Reconcile on journal `submitting.txHash`
### P8 — Self-resolve UX: auto-close trust popup on `pending→unknown` (plus splice queued duplicates)
### P9 — C1 auto-trust via NEW `tokenService.onUserAddedToken` event (origin: "popup" only)
### P10a — C2 repro e2e (FAILING test first)
### P10b — C2 fix once repro confirms hypothesis
### P11 — B1 brutalist restyle + B2 categorical label helper
### P12 — Test backfill: codex Low #2 missing pins
### P13 — E1 profile-switch atomicity: reverse write order so appStore.profile is LAST
### P14 — Manual QA + lessons + PR checklist

## C. Security & Adversarial Considerations

Trust-state attacks:
1. Self-note PXE race — covered by P6+P7 dual reconcile.
2. Out-of-order EventHandler delivery — covered by P4 reentrancy guard (per-hash).
3. Re-discovered nullifier after delete — `outgoingTxHashes` + `inflightTxHashes` cover.
4. Cross-network same-contract — trust key already isolates.
5. SW-restart self-healing — P6's init-time reconcile pass.

P9 attack: dApp-driven `registerToken` flows through `popup/windows/execute/index.vue` → `interactionService.approveInteraction` → `tokenService.addToken({origin: "dapp"})`. The `origin` discriminator gates the new event so dApp registrations stay `unknown`. Verified at `popup/windows/execute/index.vue:196` + token service op-context wiring.

P11 risk: any new render path for `op.subtitle` MUST run through `sanitizeJournalSubtitle`. The new `categoricalLabel` helper consumes ONLY wallet-controlled fields (`op.kind`, `op.error?.kind`, `op.progress.stage`).

## D. Phase-to-issue matrix

(see plan.md)

## E. Assumptions

**Facts (verified):**
- `IncomingTransferService.onTransactionAdded` at `service.ts:366-379`.
- `EventHandler.invoke` at `wallet-core/src/utils/event-handler.ts:22-28` is sync-fires-async.
- `PopupManager.vue:122-160` — listener registered before seed (codex Med #1 root).
- `IncomingTrustPopup.vue:154` — `v-if="expanded"` (codex Low #1 root).
- `tokenService.addToken` at `token/service.ts:112-202` accepts `opContext.origin: "popup"|"dapp"`.
- `useProfileBootstrap.bootstrapActiveProfile:63-77` writes `appStore.profile = profile` FIRST (line 64) — E1 ordering bug.
- `auth.vue:101` direct write — duplicate that races with the listener.
- `select_profile` popup ONLY opened from `auth.vue:148`.
- `register_token` (dApp-driven) flows through `popup/windows/execute/index.vue:196` → `tokenService.addToken({origin: "dapp"})`.
- Journal `progress.stage === "submitting"` is when `progress.txHash` is populated; `operation-journal/service.ts:272`.

**Inferences (label clearly):**
- C2 root cause likely is "onConnected doesn't fire on first connect" — P10a will validate.
- MV3 SW survives popup-window close.
- `buildJournalTerminalCardProps` already handles dApp-controlled `op.subtitle` via sanitize.

**Asks:**
- A1 em-dash strategy: substitute or rewrite sentences?
- B2 chip placement: above status row or alongside?
- P9 event naming: `onUserAddedToken` vs `onTokenAddedByUser` vs `onUserTrustedToken`?
- E1 fix: option 3 (reverse-order, refactor `initNetworks`/`initAccount` to accept explicit profile arg) vs option 1 (`isProfileSwitching` flag)?
- P10b: what if repro reveals H2 is wrong?

## F. Open questions

1. Should `pending → unknown` transition emit `onIncomingTransferDeleted` for any remaining hidden records?
2. Is there a parallel v2 codex audit on the fix arc I should be reading?
3. PR strategy for 14 phases — single squash to dev?
4. B1 visual reference confirmation — journal records have no chain hash, drop the hero_link branch.
5. C2 repro definition — "close popup" = click-outside vs `chrome.windows.remove`?
6. D1 dead-code risk if FJWC is being removed in another PR.
