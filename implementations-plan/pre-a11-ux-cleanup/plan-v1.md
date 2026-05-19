# Pre-A11 UX cleanup arc — plan v1

Date: 2026-04-27
Scope: 4 user-flagged UX rough edges to land before the A11 Vue decomposition arc starts.

> Note: this plan is scoped to "ship before A11" because A11 will rewrite the popup-window mount points. Anything we do here either stays small enough not to conflict with A11, or gets called out as deferred.

---

## Tracks (independent PRs)

### Track A — Unify dApp-approval and Send transaction lifecycle UI

#### Problem (from user)

> When a transaction (via approval and not "send pop up / transfer") is in loading state it's very different than when the transaction is actually sent. The title `{appName} - action` with subtitle as status, and then changes completely after sent, is kinda weird. Can we make them the same / more alike?

#### Concrete divergence (verified)

- `windows/execute/index.vue` (dApp approval, **separate browser window**):
  - Pre-confirm: dApp hostname + "wants to execute…" + per-operation cards with embedded `FeeSettingsCard`.
  - Confirm button: `"EXECUTING"` while `isLoading`.
  - Window **closes** when `approveInteraction()` resolves (line 272 `closeWindow(true)`). There is no in-window post-submit state.
  - **No operation-journal entry** is created for dApp-driven txs.
- `pages/send.vue` (user-initiated transfer):
  - Pre-confirm: token picker + amount + recipient + `FeeSettingsCard`.
  - Confirm button: `"CONFIRMING"` while `isSending`.
  - On submit: toast `"Transaction submitted"` + immediate `leaveSend()` navigate-back.
  - **Operation journal** picks up the in-flight tx; `TransactionAwaitingCard` on the General page shows progress.

So the approval flow has **no continuity** with the rest of the app's lifecycle UI: window closes blind, user has no idea the tx is being proven/submitted, and the dApp's own UX may or may not surface it.

#### Convergence target

A shared "transaction lifecycle" model with consistent header copy across both flows. Phase-keyed copy:

| Phase | Header (left) | Header (right / subtitle) |
|---|---|---|
| `idle` | (flow-specific) | — |
| `awaiting-confirm` | (flow-specific) | "Review and confirm" |
| `signing` | (flow-specific, **kept**) | "Preparing transaction…" |
| `submitted` | (flow-specific, **kept**) | "Submitted to network" |
| `failed` | (flow-specific, **kept**) | "Failed: {short reason}" |

Key invariant: **the title stays put through the lifecycle; only the subtitle/status changes.**

#### Plan

1. **Extract `TransactionStatusHeader.vue`** at `popup/components/modules/transaction/TransactionStatusHeader.vue`:
   - Props: `title: string`, `subtitle?: string`, `phase: 'idle' | 'awaiting-confirm' | 'signing' | 'submitted' | 'failed'`, optional `dapp?: { hostname, action }` for dApp framing.
   - Single visual treatment matching the existing brutalist header style.

2. **Wire into `pages/send.vue`**:
   - `<TransactionStatusHeader :title="\`Send \${activeToken.symbol}\`" :phase="phase" />`
   - `phase` is a computed derived from `isEstimating`, `isSending`, journal state.
   - Visible difference today vs. after: the subtitle changes through the flow rather than the form just disappearing. No major restructure.

3. **Wire into `windows/execute/index.vue`** (the bigger change):
   - Add `phase` ref tracking `idle → awaiting-confirm → signing → submitted → failed`.
   - **Keep window open through `signing` and `submitted`**. Today the window closes immediately on `approveInteraction()` resolve — change this to wait for the tx to be submitted to the node (we already get this signal from the execution service), show a brief "Submitted" state for ~1.5s, then close.
   - Failure case: stay open, show error, don't close until user dismisses.
   - This gives the dApp-approval flow the same "I see what's happening" comfort as the Send flow.

4. **Operation-journal parity** (audit-found, additive):
   - Today: dApp txs do not appear in the operation journal. After this change, surface them too — single source of truth. Re-opening the popup after the window closes will show the in-flight dApp tx in the same `TransactionAwaitingCard` row that user-initiated sends use.

#### Risks

- Keeping the window open through `signing` is a UX bet — adds 5–10s of "pending" UI before close. Codex audit may push back. Alternative: close fast but write a journal entry so the popup reflects status. Both should be evaluated.
- Multi-operation rendering in the approval window (`v-for` over `operations`) means the header is per-window, not per-operation — works for the common case (1 op) but degrades for batched approvals.
- `TransactionAwaitingCard` already exists; I haven't read it. Need to verify it accommodates dApp-origin txs (different metadata).

#### Estimated size

2–3 days. Most risk is in the `windows/execute/index.vue` close-deferral.

---

### Track B — Fee estimation noise + redundancy

#### Problems (from user, three distinct)

1. **Fee dropdown spinner on open** — when the approval popup opens, the fee-source dropdown spins for ~500–1500ms even before the user touches it. Subtitle: "very random, why does that happen? Can we avoid it?"
2. **Two-spinner UX** — dropdown spinner finishes, then *another* spinner kicks in for the fee-amount estimate.
3. **Estimating fee blocks confirm** — "estimating fee is non-blocker for confirming transaction. I'm not sure that's the best UX."
4. **Redundant post-confirm estimation** — "Once the transaction gets approved by the user we have a step that's 'estimating fee'… shouldn't we use the previously calculated stuff? Or is it a completely different pipeline and I'm just saying nonsense?"

#### Verified call sites

- **Dropdown init** — `FeeSettingsCard.vue:285-323` `runInit()` does `Promise.all` of:
  - `executionService.getGasBalances()`
  - `tokenBalanceService.getTokenBalances()`
  - `fpcService.getFpcs()`
  Three round-trips just to populate the dropdown. Spinner driven by `isLoading`.
- **Amount estimation** — `pages/send.vue:317-368` watcher with 800ms debounce calls `executionService.estimateTransferFee()`. Spinner driven by `isEstimating`. Same pattern in `windows/execute/index.vue:533, 603` for `estimateOperationFee()`.
- **Post-confirm re-estimate** — `executionService.executeSendTransaction()` (service.ts:594) calls `buildAndEstimateTxRequest()` (service.ts:597-600) **again**, discarding the prior estimate. Same pattern in `executeAztecSendTx()` (service.ts:1220).

The user's intuition about post-confirm redundancy is correct: it IS a duplicate fee-estimation pipeline run on the same parameters.

#### Plan (4 sub-steps; ship a/b together, c next, d on a separate flag)

**(a) Pre-warm the dropdown via cached state.**
- Move `getGasBalances + getTokenBalances + getFpcs` out of `FeeSettingsCard.runInit()`. Hoist into a Pinia store (`useFeeSourcesStore` or extend existing `useAppStore`) populated:
  - on profile open / active-network change (proactively),
  - on receive of `onTokenBalanceUpdated`, `onGasBalanceUpdated`, `onFpcAdded/Removed` events (incrementally).
- `FeeSettingsCard` reads from the store synchronously. Spinner gone for the dropdown.
- First-load latency unchanged but moved to popup-mount/general-page-load context where it overlaps with other work.

**(b) Single-spinner UX.**
- Don't show dropdown spinner. Show `isEstimating` skeleton over fee amount only.
- Default fee method (auto-selected sponsored FPC) populates synchronously from cached state.

**(c) Reuse the pre-confirm estimate.**
- `executeSendTransaction()` and `executeAztecSendTx()` accept an optional `precomputedEstimate?: TxRequestEstimate` parameter.
- If present and **fresh** (defined: same params + within last 30s + same fee-method + same priority), skip `buildAndEstimateTxRequest()` entirely and proceed straight to `proveTx`/`submitTx`.
- If stale or missing, fall back to the current path. **Conservative default**: any divergence forces re-estimation.
- Saves 1–3s on the post-confirm "Estimating fee…" step.

**(d) Non-blocking confirm — DEFER, ship separately.**
- Allow Confirm button while estimating, show "Estimating fee…" as a phase. Mostly harmless when fee method is sponsored (no actual cost). For non-sponsored paths the user would see "Confirm → estimate → submit" rather than "estimate → Confirm → submit". User-perception bet.
- Ship on its own flag with toggleable rollout. Don't bundle with a/b/c.

#### Risks

- (a) Cache invalidation. Token/gas/fpc events already exist; trust them. But if any path mutates these without an event, the cache goes stale. Audit: list every mutation site and confirm event coverage.
- (c) "Fresh" definition. The 30s window is a guess. Audit-suggest: instead of a TTL, validate the precomputed estimate against the current `feePayer`/`gasSettings`/`globalVariables` proof inputs at `proveTx` time. If those changed (block boundary, network swap, fee-method change), recompute.
- (c) Privacy nuance: in the dApp-approval flow, the tx params are dApp-controlled. If the dApp re-sends the same params, we shouldn't reuse a cached estimate cross-request — only within a single popup session.

#### Estimated size

(a) + (b): 1–1.5 days. (c): 1.5–2 days. (d) deferred.

---

### Track C — Sender registration ↔ contacts integration

#### Problem (from user)

> On Aztec you need to register the sender of some token if you have not interacted yet. We do have that in place, but it's very unintuitive. I think we should add automatically as a sender any contact we add into our contacts book. Additionally, I think maybe on the tokens on the asset view we should mention "receiving from someone? add them as a sender" or something like that into the copy and into the three-dotted menu on tokens.

#### Verified state today

- **Sender service**: `AccountStateService` (`account-state/service.ts:52-89`) wraps PXE `getSenders/registerSender/removeSender`. Source of truth = PXE per-network IndexedDB.
- **UI surface**: `Settings → Advanced → Account State → Senders` page + `NewSenderPopup`. Manual entry only.
- **Contacts**: `ContactService` (`contact/service.ts`) + `NewContactPopup`/`EditContactPopup`/`ImportContactsPopup`. **Zero tie-in to senders today.**
- **Friction**: a user adds Alice as a contact; Alice sends them a private USDC transfer; user opens wallet, sees nothing (PXE can't decrypt without `registerSender(alice)`); user has no in-product hint.

#### Plan

**(1) Auto-register on contact-add (every entry path).**
- `NewContactPopup` `onSubmit` — after `contactService.addContact()` resolves, fire `accountStateService.addSender(activeNetworkId, address)`. Failure is non-fatal (toast: "Contact saved · sender registration pending"). Rationale: contact saves succeed even when PXE is down; user can re-register manually.
- `EditContactPopup` — when address changes, register the new address. Don't deregister the old one (historical sender registrations don't hurt).
- `ImportContactsPopup` — for each imported contact, queue `addSender`. Use a single batch with concurrency cap (3 in flight) to avoid spamming PXE.

**(2) Backfill on profile open / network switch.**
- Add a one-time-per-(profile, network) sync: enumerate contacts → diff against `getSenders()` → register the missing ones silently.
- Triggered in the `onActiveNetworkChanged` and `onActiveProfileChanged` handlers in `AccountStateService` (or wherever the post-switch hook lives).
- Idempotent. No-op for users with empty contact books.

**(3) Discovery hint on token detail page.**
- `pages/tokens/[id].vue` three-dot menu: add a `DropdownItem` "Manage senders" linking to `/popup/settings/advanced/account-state/senders`.
- Below the balance card on the token detail page, when the displayed balance is 0 (private), show a one-line `Banner` (collapsible, dismissable per token): "Expecting a private transfer? Add the sender as a contact (or via Settings → Senders)."
- Copy may iterate; user can challenge.

**(4) Sender-status surfacing in EditContactPopup.**
- Show "Registered as sender on {network.name}" with a checkmark, OR "Not registered — register now" CTA. Live feedback that the contact↔sender link is healthy.
- Reads from the cached senders list — don't re-fetch on every contact open.

**(5) Naming.**
- Keep the page at `Settings → Advanced → Account State → Senders`. Don't move; contacts and senders are conceptually related but distinct (privacy primitive vs address book).

#### Risks

- Privacy: senders are network-scoped PXE state. If the user switches between networks (Mainnet ↔ Devnet), do contacts auto-register on each? **Recommendation**: only auto-register on the active network when contact is added. Backfill handler runs on network-switch, so coverage extends naturally.
- Contact import storms: if user imports 100 contacts, that's 100 sequential `addSender` calls. Concurrency cap addresses; audit will sanity-check the choice.
- "Auto-register" exposes contacts to PXE state more aggressively than today. But the threat model is unchanged — contacts are already plaintext at rest in `chrome.storage.local`. No new info leak.

#### Estimated size

2 days. Mostly additive wiring. The backfill is the one piece that needs care (idempotency + timing).

---

### Track D — Notes page bug investigation

#### Problem (from user)

> I think there might be a bug in the "notes" part of the settings. I think the rows might not be showing, but I am not entirely sure. Can you double check?

#### Investigation result

**The page is structurally fine but the data path is suspicious.**

`note/service.ts:63-70` `parseNote` only populates:

```ts
{ contract, storageSlot, txHash, rawContent }
```

It does NOT populate `type`, `location`, or `content` (all optional in `spec.ts`). The Vue page consumes these:

```vue
<span :class="$style.type">{{ note.type ?? 'Custom Note' }}</span>
<span v-if="note.location">{{ note.location }}</span>
<div v-if="note.showingContent">…</div>     <!-- showingContent = parseNoteContent(note.content); always null -->
<div v-else>                                  <!-- always falls through to raw -->
  <span v-for="el in note.rawContent">{{ el }}</span>
</div>
```

So **every note renders as the raw fallback**: header reads `"Custom Note · 0xABCD…"` and body shows the encoded items as a list of hex strings. To a user, this can read as "broken" — there's nothing recognizable on screen.

Pre-Nulo (legacy upstream era) likely had a type-detection step that populated `type`/`location`/`content` from known contract patterns (token Balance/PublicBalance notes, etc.). That logic was lost during the upstream Schnorr migration (commit `4ee1b8d` per memory).

#### Plan

**(1) Confirm hypothesis with user**: ask whether they see (a) zero rows or (b) rows with raw content only. The bug fix differs.

**(2a) If zero rows**: instrument `fetchNotes` and `parseNote` with a one-line `[notes]` console log; ship to user; they reproduce. From the log, find whether `getNotes` returned empty, threw, or returned items that failed to render.

**(2b) If raw-content rows**: re-implement type detection. Match contract addresses against known token contracts (we already have `tokenService.getTokens()`); for each, decode the note via the known ABI (Balance / Nonce / etc. patterns from the upstream `@aztec/noir-contracts.js`). Populate `type` + `content` fields. Ship as a separate PR.

**(3) Either way**: also add a "Refresh" button on the notes page that re-fetches (we have one on authwits via the registry-status row; add the same affordance to notes for symmetry).

#### Risks

- (2b) the type-detection map needs to be maintained as new tokens / standards land. Defer to a registry-driven approach if it gets unwieldy.

#### Estimated size

Diagnosis: 0.5 days (instrumentation + user feedback). Fix: 0.5–2 days depending on which branch.

---

## Sequencing

| # | Track | Why this order | Depends on |
|---|---|---|---|
| 1 | **D — diagnose notes** | Cheapest. Could be a no-op. Unblocks knowing scope. | — |
| 2 | **C — sender↔contacts** | Self-contained, additive, high user value. | — |
| 3 | **B-1 (a+b: pre-warm + single-spinner)** | UX polish, low risk, no behavior change. | — |
| 4 | **B-2 (c: estimate reuse)** | Pipeline refactor. Test-heavy. | none, but better after B-1 lands |
| 5 | **A — lifecycle UI unify** | Touches both popup-window and Send page; biggest visual change. | better after B-1 to avoid spinner double-fix |
| 6 | **B-3 (d: non-blocking confirm)** | DEFERRED. Separate session, A/B-able. | A landed |

Estimated total: **6–9 days** of focused work for items 1–5.

## Verification per PR

Standard gates: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e` (smoke). For Track A and Track C, manual QA on Chrome unpacked. For Track B-2, full network e2e (mint-token + send) to catch fee-pipeline regressions.

## Out of scope / explicit non-goals

- A11 Vue decomposition is a separate arc and not part of this. Anything that would conflict with A11's planned mount-point rewrite gets called out and deferred.
- M4.7 migrations.
- M4.11 encrypted metadata at rest.
- Page-promotion of Send/Receive popups (already done — Send is `pages/send.vue`).
- Replacing Puppeteer with Playwright (M5.4).

## Decisions to confirm with user before implementation

1. **Track A — close-on-submit vs hold-through-submit for the approval window.** User intuition was "make it the same as Send" — but Send navigates away immediately. Two readings:
   - "Same UI grammar (header pattern, copy)" — minimal change, ship the shared header but keep close-on-approve.
   - "Same lifecycle visibility (stay open until submitted)" — bigger change, more honest UX, slight friction for happy path.
2. **Track B-d** — keep deferred? Or fold in?
3. **Track C** — auto-register on EVERY network at backfill time, or only the active network?
4. **Track D** — does the user see (a) zero rows or (b) rows with raw content?
