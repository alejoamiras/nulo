# e2e Determinism Plan — FINAL v3a (post-codex-audit + DOM-purity revision, settled-card edition)

Supersedes prior versions. Three revision passes:
1. **Post-codex-audit v1 (session `019e2c76`)** — switched Signal 1 from tx-store scan to journal correlation; dropped Signal 3 (popup handshake); kept `waitForToast` in `sendTransfer`; pinned the 5s sleep instead of touching it.
2. **DOM-purity v2 (user feedback)** — switched Signal 1 to observe the `TransactionAwaitingCard` lifecycle. *Codex audit (session `019e2cc5`) found this was semantically wrong*: the awaiting card unmounts at submit, not at chain confirmation.
3. **Settled-card v3a (this version)** — Signal 1 now observes the SETTLED `TransactionCard` matching `(amount, transferType, status)`. This IS the user's confirmation event. Three new testids on `TransactionCardLayout`/`TransactionCard`; no implementation coupling; tests survive journal/tx-store refactors.

Net changes from consolidated (after all 3 audit rounds):

- **Signal 1 reframed to use the settled `TransactionCard` DOM**, not the tx-store scan and not the operation journal. The user-visible confirmation event is the activity card's status icon flipping to confirmed; tests synchronize on that. v1's journal correlation was rejected on philosophical grounds (implementation coupling); v2's awaiting-card semantics were wrong (unmounts at submit, not chain confirmation); v3a observes what the user observes.
- **Signal 3 (popup handshake) dropped from this stack.** Codex flagged: `chrome.storage.session` survives MV3 SW suspension (not cleared on death); the watcher isn't `immediate: true` so it can miss the connect entirely; and the signal is observability, not a fix for the underlying handshake-drop bug. The triple-nav stays. If we want this win, it's a separate, more-careful PR with its own design.
- **Keep `waitForToast("Transaction submitted")`** in `sendTransfer`. Codex was right: it's the SW-ack diagnostic. The journal correlation reads happen AFTER the toast as a follow-up, not a replacement.
- **PR-C scope corrected:** ~5 `sendTransfer` callers total; only the 4 `waitForTxConfirmation` sites in `transfers.test.ts` need new logic. Bundle freely.
- **Validation budget revised:** there is no existing `transaction-service.test.ts`. Either skip unit tests and validate e2e-only (faster, less robust), or add a minimal test harness (more upfront, durable). My recommendation: e2e-only for now; harness for follow-ups.
- **Anchor-gate scope expanded:** dapp send paths share the same simulate→prove pattern. The wallet-side fix is a shared gate/helper, not a one-off in `ExecutionService`. Pin the sleep + file the issue with the full scope.

## Signal designs (revised v2)

### Signal 1 — Tx confirmation via settled TransactionCard (v3a, DOM-pure)

**Philosophy:** e2e tests synchronize on what the user can observe. The user observes: after a transfer, a settled `TransactionCard` appears on home (or activity) with the amount, transfer-type label, and a confirmed status icon. THAT card transitioning from "pending" to "confirmed" is the user's confirmation event.

**Why not the awaiting card (v2 reject):** codex audit (session `019e2cc5`) caught: the `TransactionAwaitingCard` unmounts when the wallet's execute phase completes (post-mempool-submit, journal `succeeded`), NOT when the tx confirms on chain. Using it as the signal would mean "submitted" not "confirmed" — and the next transfer's nullifier race would still hit.

**Async work + signal:**
1. After `sendTransfer` submits, `addTransaction` writes the tx to `nulo:core:txs` with `status: Pending`.
2. The popup's `RecentActivityView` renders a `TransactionCard` for the new tx (status: Pending).
3. SW worker polls receipts every 1s; on `status !== Pending`, writes the new status to storage and emits `onTransactionUpdated`.
4. The popup's TransactionCard re-renders with the new status (`isMined` true, `isSuccess` true, etc.).
5. Test waits for the CARD matching `(amount, transferType)` with `data-tx-status="confirmed"`.

**Required wallet changes (4 testids on one component pair):**

Add 4 new optional props to `TransactionCardLayout.vue` and bind them as `data-tx-*` attributes on the root Flex (which already carries `data-testid="tx-card"`):
- `txAmountDisplay: string` → `data-tx-amount-display`
- `txTransferTypeLabel: string` → `data-tx-transfer-type` (the **user-visible** label, not the enum)
- `txStatus: string` → `data-tx-status`
- `txHash: string` → `data-tx-hash` (for diagnostics; the user already sees a 4+4 hash slice, so this isn't new info)

In `TransactionCard.vue`, compute:
- `data-tx-amount-display = amountStr` (already computed)
- `data-tx-transfer-type` = `formatTransferType(transfer.value.type)` (e.g., `"Public → Public"`) — **the same string the user sees in the chip**, not the raw numeric enum (codex audit `019e2d36`). Per `tx-enrichment.ts:121-131`, the labels are `"Private → Private"`, `"Private → Public"`, `"Public → Public"`, `"Public → Private"`.
- `data-tx-status` = derived from existing computeds, with explicit `"unknown"` fallthrough (codex: Vue omits the attribute when bound value is `undefined`):
  - `isPending` → `"pending"`
  - `isSuccess` → `"confirmed"` (semantically: first-mined; user sees green check)
  - `isReverted` || `isDropped` → `"failed"`
  - else → `"unknown"`
- `data-tx-hash = props.tx.hash`

All four reflect what the user actually sees on the card: the amount text, the transfer-type chip label, the status icon, and the hash slice. Tests reading these attributes are observing the user-visible card state.

**Helper signature:**
```ts
// helpers.ts

// Internal — same shape as the wallet's TRANSFER_TYPE_LABELS at tx-enrichment.ts:122-131.
function transferTypeLabel(fromType: "public" | "private", toType: "public" | "private"): string {
    if (fromType === "private" && toType === "private") return "Private → Private"
    if (fromType === "private" && toType === "public") return "Private → Public"
    if (fromType === "public" && toType === "public") return "Public → Public"
    return "Public → Private"
}

export async function sendTransfer(page: Page, opts: SendTransferOptions): Promise<void> {
    // ... existing flow including waitForToast("Transaction submitted") ...
}

export async function waitForTxConfirmation(
    page: Page,
    opts: { amount: string; fromType: "public" | "private"; toType: "public" | "private"; timeout?: number },
): Promise<void> {
    const { amount, fromType, toType, timeout = 60_000 } = opts
    const label = transferTypeLabel(fromType, toType)
    // Wait for a card matching our submit's amount+type to reach a terminal
    // status. Terminal = "confirmed" (first-mined) OR "failed" (reverted/dropped).
    await page.waitForFunction(
        ({ a, t }: { a: string; t: string }) => {
            const card = document.querySelector(
                `[data-testid="tx-card"][data-tx-amount-display="${a}"][data-tx-transfer-type="${t}"]`,
            )
            if (!card) return false
            const status = card.getAttribute("data-tx-status")
            return status === "confirmed" || status === "failed"
        },
        { timeout, polling: 250 },
        { a: amount, t: label },
    )
    const meta = await page.evaluate(
        ({ a, t }: { a: string; t: string }) => {
            const card = document.querySelector(
                `[data-testid="tx-card"][data-tx-amount-display="${a}"][data-tx-transfer-type="${t}"]`,
            )
            return {
                status: card?.getAttribute("data-tx-status"),
                hash: card?.getAttribute("data-tx-hash"),
            }
        },
        { a: amount, t: label },
    )
    if (meta.status !== "confirmed") {
        throw new Error(
            `waitForTxConfirmation: tx ${label} ${amount} terminal as "${meta.status}" (hash=${meta.hash}), expected "confirmed"`,
        )
    }
}
```

**Caller change in `transfers.test.ts`:** same shape as the existing `sendTransfer` opts:
```ts
await sendTransfer(page, { fromType: "public", toType: "public", amount: "10", destination: ... })
await waitForTxConfirmation(page, { amount: "10", fromType: "public", toType: "public" })
```

The caller doesn't deal with the user-visible label string directly — the helper computes it. Tests still pass natural `(fromType, toType)` opts.

**Wallet code changes:**
- `TransactionCardLayout.vue` — 4 new optional props + 4 attribute bindings on the root Flex.
- `TransactionCard.vue` — pass the 4 props through with the derived values; `data-tx-transfer-type` binds the rendered LABEL (not the raw numeric enum).
- `TransactionAwaitingCard.vue` — no change (we're not using awaiting card for this signal).

**Helper scope caveat (codex `019e2d36`):** `RecentActivityView` suppresses pending tx cards while the awaiting card is up (`RecentActivityView.vue:48`). For the transfers scenario this is fine — each submit is sequential and the 4 `(amount, transferType)` pairs are unique. But this helper is NOT a safe generic primitive for parallel or repeated identical-shape submits, because a stale confirmed card from a prior submit could false-positive immediately. If we later use this outside `transfers.test.ts`, disambiguate with hash or pre-submit snapshot.

**Helper page-agnostic note:** `RecentActivityView` is mounted on `/popup/general` and `/popup/tokens/[id]`. For the transfers scenario, the page is at `/popup/general` after `sendTransfer` (because `send.vue` does `router.back()` to the previous route, which was general). Helper doesn't enforce or assume the page — just polls the DOM for a card matching the attrs. Callers from token-detail also work.

**Validation:**
- e2e: `transfers.test.ts` scenario 5× local. Expect wall time ~100-120s (was ~140s with 10s sleeps × 4 = 40s overhead).
- Unit: `TransactionCardLayout.test.ts` and `TransactionCard.vue.test.ts` (or equivalent) — add assertions that the 3 new data attributes render with expected values for each status case. ~6 new assertions across the existing unit tests; reuses harness.

**Risk:**
- If multiple txs share `(amount, transferType-label)` and overlap in the test, the matcher could resolve on the wrong card. **Mitigation:** the transfers scenario's 4 transfers all have unique `(amount, label)` pairs: `(10, "Public → Public")`, `(100, "Public → Private")`, `(50, "Private → Public")`, `(10, "Private → Private")`. Even though amount=10 repeats, the label disambiguates. The fixture setup mints 1000 to the account from an EXTERNAL test wallet (`extension.ts:303`); that mint doesn't render via this extension's tx store, so no spurious match. `importToken` and refresh also don't write to the tx store. Verified by codex (`019e2d36`).
- If a tx fails or is dropped, the helper throws with a clear "terminal as failed/dropped (hash=...)" message — better diagnostic than the 10s sleep's silent skip.
- If the TransactionCard's testid attributes regress (e.g., someone removes `data-tx-status`), tests fail immediately with "selector not found." Unit-test assertions catch this earlier.
- **`"confirmed"` semantics:** the user-facing label `"confirmed"` here means **first mined state** (`Proposed | Checkpointed | Proven | Finalized`), not on-chain finality. This matches what the user sees in the UI (green check appears at first-mined). Future tests that need finality-level confirmation will need a different signal.

**Why this is the right design (per the user's philosophical critique):**
- Truly tests user-perceivable state: the amount text, transfer-type chip, and status icon are ALL visible to the user on the activity card.
- Survives wallet-internal refactors (journal/tx-store reshape) as long as the rendered card's user-visible information stays intact.
- Catches UI regressions for free: if the card stops rendering for any reason, transfers tests catch it.
- The data attributes are direct reflections of user-visible info, not internal state — `data-tx-status="confirmed"` is the same fact the status icon communicates.

### Signal 2 — `sendTransfer` 3s post-refresh (private-from)

Unchanged from consolidated plan. Drop the sleep; rely on downstream `input-enabled` wait.

**Risk:** none — input-enabled is the real signal; the sleep was double-defense.

### Signal 4 — Misc small sleeps (S1, S5, S6, S7, S8) + the 4 stale 500ms in fee-methods

Unchanged from consolidated plan. State-driven replacements per the table. Free win.

### Pinned: 5s post-fee-estimation (helpers.ts:607 + fee-methods.test.ts:104,172)

**Rename and file the wallet bug.** Don't touch test-side.

```ts
// Pinned workaround for a wallet bug: the simulate→prove pipeline doesn't
// gate proveTx on PXE's anchor block having caught up to simulate's anchor.
// Same race appears in dApp send paths (ExecutionService + DappInteractionService).
// Real fix: shared anchor-freshness gate factored as a pure helper.
// Tracked: <issue link to be filed>
const PXE_ANCHOR_SYNC_WORKAROUND_MS = 5_000
await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))
```

### Dropped from this stack: Signal 3 — popup handshake

Reason: codex's audit revealed deep design issues (storage-area lifecycle assumption wrong, watcher misses initial connect, signal doesn't fix root cause). The triple-nav adds ~500ms × 75 calls = ~37s per smoke run — a real cost but smaller than I claimed in the consolidated plan, and the redesign needed is larger than expected.

Path forward (separate PR, when prioritized):
1. Wallet-side: add `popup-ready` write inside `initAppServiceContext` (not in a `app.vue` watcher) — runs on every mount, regardless of timing. Freshness-scoped: include the popup's mount timestamp in the value, and have the test compare against a pre-`goto` snapshot.
2. Test-side: try-fast-path-then-fall-back. Single goto + 2s wait for fresh-mount-stamp; if it doesn't land, do the about:blank dance.
3. Separate PR. Independent measurement (smoke wall time before/after).

Filed as follow-up.

### Dropped from this stack: `waitForToast` audit (Signal 5 in earlier drafts)

Same reason: the toast removal would degrade diagnostics on failure paths (codex's call). Audit can land as incremental follow-ups, per-caller, after the determinism PRs prove out.

## PR strategy (revised)

3 PRs onto `dev`. Independently revertable.

| # | PR | Scope | Validation | Lines |
|---|---|---|---|---|
| **PR-A** | `e2e/det-misc-sleeps` | S1, S5, S6, S7, S8 + the 4 stale 500ms in fee-methods. ~9 sleeps converted. Helper code only. | Smoke + network 3× local. | ~30 |
| **PR-B** | `e2e/det-refresh-drop` | Drop S2 (3s post-refresh in `sendTransfer` private-from). | Transfers + fee-methods 5× local. | ~3 |
| **PR-C** | `e2e/det-tx-settled-card` | DOM-pure `waitForTxConfirmation` via settled `TransactionCard` matching (amount, transferType-label, status). Add 4 testid props on `TransactionCardLayout` (`data-tx-amount-display`, `data-tx-transfer-type`, `data-tx-status`, `data-tx-hash`) + bindings in `TransactionCard`. Helper takes `{ amount, fromType, toType }` and computes the label internally. `transfers.test.ts` updated. ~20-30s saved on transfers scenario. | Transfers scenario 5× local + 1× CI. `TransactionCard` unit test gets ~8 new assertions for the data-tx-* attributes. | ~50 |

**Plus pin commit on PR-A:** rename 5s sleep to `PXE_ANCHOR_SYNC_WORKAROUND_MS` at both call sites + comment with issue link. ~10 LOC. Folds into PR-A or stands alone — doesn't matter.

**Out of scope:**
- `wallet/anchor-freshness-gate` — shared gate/helper for simulate→prove in `ExecutionService` AND dapp paths. Separate wallet PR, multi-day, requires unit-test harness build. File as issue; defer until determinism stack lands.
- Popup-handshake signal — separate PR with redesign per codex's notes.
- `waitForToast` audit — incremental, per-caller, after determinism PRs.

## Tests to modify

**Network:**
- `transfers.test.ts` — 4 `waitForTxConfirmation` calls + `sendTransfer` call-site updates (4×).
- `fee-methods.test.ts` — 4 stale 500ms inline blocks → `setActiveSendType` helper (PR-A); the 2× 5s sleeps get the rename (PR-A pin or PR-C, take pick).
- Fixtures using `importToken` get S1 swap (waitForSelector instead of 500ms sleep).

**Smoke:**
- `appearance.test.ts`, `security.test.ts` — S8 drop (`navigateByHash` 200ms gone).
- `settings-crud.test.ts` — S7 swap (toggle data-toggle-active poll).

**Unit:**
- None. No existing `transaction-service.test.ts` to extend; spinning one up is bigger than the validation budget for this stack.

## Tests NOT to modify

- `passkey-*` (substrate timing — separate concern)
- `batch-partial-failure`, `connect-locked-queue` (deferred clusters)
- `sw-resilience.test.ts` (until Signal 3 lands as a separate PR)
- Fixture polling loops (already at right cadence)

## Open questions for the user (post-audit)

**Q1 — Validation depth.** Plan validates Signal 1 (DOM-pure via settled `TransactionCard`) by extending the existing `TransactionCard` / `TransactionCardLayout` unit tests with ~8 new assertions for the 4 new `data-tx-*` attributes (one assertion per attribute × pending/confirmed cases) + e2e validation on transfers scenario 5× local. **No new unit-test harness needed**. Self-resolved; no decision needed.

**Q2 — Anchor-gate timing.** Codex says the wallet anchor-gate fix should be a shared helper covering simulate→prove in BOTH `ExecutionService` (UI transfers) AND dapp paths (`aztec_sendTx` etc.). That's bigger than the original "10-case unit test" estimate. **Pin and defer (my recommendation)**, or block determinism work on the anchor-gate landing first?

**Q3 — Popup-handshake redesign.** Dropped from this stack per codex's findings. Separate PR is feasible but needs a careful redesign (immediate watcher, freshness-scoped key, retain triple-nav fallback). **Schedule for after this stack**, or prioritize first because of the ~37s smoke savings?

**Q4 — PR order.** A → B → C (smallest to biggest) per usual pattern. Or do C first (biggest single win on transfers scenario)? **My lean: A → B → C.** A+B validate the pattern; C builds on confidence.

## Audit lineage

- `plan-primary.md` — my v0
- `parallel-claude-plan.md` — independent agent's v0
- `plan-consolidated.md` — first merge
- `audit-codex.md` — codex critical review (session `019e2c76`)
- `plan-final.md` (this file) — post-audit revision
