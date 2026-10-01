# e2e Determinism Plan — parallel-claude

Drafted independently from the repo state. Mergeable with the primary
investigator's plan; diverges where my reading of the evidence differs.

## TL;DR (5 lines)

- **Three of the five sleeps already have a deterministic signal in production code** — the operation journal (`nulo:journal@<id>`, `progress.stage`) and the tx store (`nulo:core:txs@<hash>`, `status`) carry the exact transitions tests are waiting for. Polling chrome.storage is the right replacement for sleeps 1+2+3.
- The 10s `waitForTxConfirmation` becomes `waitForTxTerminal({ account, since })` — poll `chrome.storage.local` for a tx whose `createdAt >= since` AND `status !== Pending`. No wallet code change required.
- The 5s post-fee-estimation sleep in `sendTransfer` is the highest-risk one — Codex previously flagged it as masking a real PXE-anchor race. The fix is **read-side**, not test-side: make the simulate→prove pipeline observe its own anchor freshness. Until that lands, treat the 5s as a known wallet bug pinned by a test comment, NOT a test-side TODO.
- The triple-nav in `openPopup` is hiding a real SW handshake bug (the SW's first-popup-on-fresh-tab message can be dropped). The correct fix is a wallet-side `nulo:popup:ready` storage write fired AFTER profile clients connect. The triple-nav stays as a fallback for one release.
- `waitForToast` is the lowest blast radius to replace and the highest ROI: post-mutation row/state signals already exist for every caller. Toast checking is purely a redundant tail.

## Per-signal designs

### Sleep #1 — `waitForTxConfirmation` (helpers.ts:626-628, 10s fixed)

**Async work being waited on.** Between `executeTransfer` resolving ("Transaction submitted" toast) and the next test step:
1. SW's `TransactionService.runWorker` polls `node.getTxReceipt` every 1s (service.ts:177-194).
2. When the receipt comes back non-pending, `updateTx` writes the new status to `nulo:core:txs@<hash>` in `chrome.storage.local` (service.ts:236) and emits `onTransactionUpdated`.
3. The popup's `app.store.ts:onTxUpdated` patches the in-memory `transactions[]`.
4. The journal's `progress.stage` transitions to `succeeded` / `failed` / `cancelled` and `terminalAt` is set (`nulo:journal@<id>` in `chrome.storage.session`).

**Proposed signal.** `chrome.storage.local` poll on `nulo:core:txs@*` keys; resolve when a tx record matches `(account === expectedAccount, createdAt >= startTs, status !== Pending)`. The journal alternative (`chrome.storage.session` for `nulo:journal@*` with `terminalAt !== null`) is equally valid; I'd pick tx-store because it survives SW restart and is the SAME storage the helpers already read from for `nulo:ui:activeAccount`.

```ts
export async function waitForTxConfirmation(
  page: Page,
  opts: { account: string; since: number; timeout?: number } = {},
) {
  await page.waitForFunction(
    async ({ account, since }) => {
      const all = await chrome.storage.local.get(null)
      for (const [key, raw] of Object.entries(all)) {
        if (!key.startsWith("nulo:core:txs@")) continue
        const tx = JSON.parse(raw as string)
        if (tx.account !== account) continue
        if (tx.createdAt < since) continue
        if (tx.status === 0 /* Pending */) continue
        return true
      }
      return false
    },
    { timeout: opts.timeout ?? 60_000, polling: 500 },
    { account: opts.account, since: opts.since },
  )
}
```

**Wallet code changes needed.** None. The `Pending → {Proposed,Checkpointed,Proven,Finalized,Dropped}` transition already lands in `chrome.storage.local`.

**Test code changes.** `sendTransfer` returns a `{ submittedAt: number }` so the caller can pass it to `waitForTxConfirmation({ since: submittedAt })`. Without that, two consecutive transfers can race — call #1's terminal signal could satisfy call #2's wait if it's still in the storage area. Alternatively, `sendTransfer` returns the tx hash (parse from journal record after submit), and `waitForTxConfirmation` filters by hash. Hash is the cleaner contract — eliminates the `since` race entirely.

**Failure mode.** If the SW dies between submit and confirm, the receipt poll stalls and we hit the 60s timeout. That's a real product failure surfacing as a real test failure — desirable. The current 10s sleep would happily proceed against a half-broken SW and fail downstream in a confusing place.

**Coverage need.** No new unit test. The existing `TransactionService` unit test already covers the `updateTx` path that writes the terminal status. Add a single integration test that drives a transfer in `transfers.test.ts` and asserts the hash-targeted wait resolves before the global timeout (it already does this, just via a sleep).

---

### Sleep #2 — `sendTransfer` 5s post-fee-estimation (helpers.ts:605-607)

**Async work being waited on.** Per the comment: "Give PXE a moment to fully sync after fee estimation before proving. Without this, proveTx may use a stale anchor block on slow networks." The simulate step has completed (button is enabled), but the SW's PXE may still be syncing the block referenced by the simulate's anchor.

**This is not a UI race — it's a wallet-internal race.** Per Codex's S2 audit (referenced in the prompt), this 5s masks a real bug: the prove pipeline doesn't gate on PXE having caught up to the simulate's anchor block. The test workaround papers over wallet behavior that any slow user network would also hit.

**Proposed signal.** Two layers:
1. **Wallet-side fix (correct):** the `executeTransfer` flow should re-check PXE block tip against the simulate's anchor and either wait or rebuild. This is the durable fix; the 5s sleep is a symptom.
2. **Test-side intermediate:** if (1) lands, this sleep disappears for free. If (1) is deferred, the test-side signal is `chrome.storage.local.nulo:journal@<id>.progress.stage` reaching `simulating` and then `pending` again (i.e., simulate-rerun-completed) — but the journal currently does NOT emit re-simulate transitions; it only tracks the submit lifecycle. So there is **no test-side signal that covers this** without wallet code change.

**Wallet code changes needed (correct path).** In `ExecutionService.executeTransfer`, before `proveTx`, await `pxe.getBlockNumber() >= simulateAnchorBlock` with a bounded timeout. Surface failure as a stage transition (`failed` with `kind: "stale_anchor"`). This is a refactor inside `packages/extension/src/wallet/services/execution/`.

**Test code changes.** None on test side if wallet fix lands. If wallet fix is deferred, **leave the sleep but rename it** `_PXE_ANCHOR_SYNC_WORKAROUND_SLEEP_MS = 5000` so future readers see it's not a test-design choice.

**Failure mode.** Today: tests are sometimes-green by luck. With (1): tests are deterministic. Without (1) and without the sleep: random 5-10% failures on slow networks proving against stale anchors.

**Coverage need.** Unit test for the anchor-gate in `ExecutionService` (assert that a stale anchor triggers re-simulate, not a stale prove). 10 cases — happy path, anchor-bump-mid-flight, timeout, rebuild-loop bound.

**Recommendation.** Don't touch this sleep in the determinism PR. Open a separate issue scoped to "PXE anchor freshness gate". Tag both the helper line AND the issue with a stable identifier.

---

### Sleep #3 — `sendTransfer` 3s post-`refreshBalances` (helpers.ts:541)

**Async work being waited on.** Per the comment: after `refreshBalances()` triggers a PXE fetch, the new private balance lands asynchronously. The downstream `waitForFunction` on `!input.disabled` (helpers.ts:562-568) already polls for the AmountCard's :disabled binding, which is gated on `tokenBalanceByType` being truthy.

**This sleep is likely redundant.** The very next wait checks `send-amount-input` enabled, which IS the post-refresh signal — the AmountCard re-renders when `tokenBalanceByType[type]` becomes non-falsy. Codex / Sonnet should both audit this empirically: remove the 3s, run the network suite 3× in row, see whether the input-enabled wait covers it.

**Proposed signal.** Drop it. The :disabled wait already provides the deterministic signal. If empirical runs show flakiness, the right fix is to add a `data-token-balance="<wei>"` attribute on the AmountCard so tests can assert on the EXACT balance the refresh landed (not just "non-zero"). DOM is the signal source; storage is the safety net.

```ts
// helpers.ts:536-541 → just delete the 3s sleep and the refreshBalances call's
// own commentary should make sense via the input-enabled wait alone.
if (opts.fromType === "private") {
  await refreshBalances(page)
  // No sleep — the `:disabled = !tokenBalanceByType` wait below is the
  // post-refresh signal.
}
```

**Wallet code changes needed.** Optional: add `data-token-balance` on `AmountCard.vue` for sharper test assertions. Not required to delete the sleep.

**Test code changes.** Remove the sleep. Empirically validate.

**Failure mode.** If the refresh genuinely doesn't land before the next test step, `send-amount-input` stays disabled past its 60s timeout. That's a real wallet bug surfacing as a real test failure — desirable.

**Coverage need.** None. The existing `setActiveSendType` poll loop + the amount-input wait already cover the failure mode.

**Recommendation.** Delete the sleep in the determinism PR. Run `transfers.test.ts` 5× locally to validate. If it goes red, REVERT and add the `data-token-balance` attribute.

---

### Sleep #4 — `openPopup` triple-nav (extension.ts:676-684)

**Async work being waited on.** Per the comment: SW's first popup connection on a brand-new tab can lose the wallet-bridge handshake. The "second navigate to about:blank + back" forces the SW to re-establish.

**This is hiding a real bug — but it's not a sleep, it's an extra navigation that adds ~500ms-1s per `openPopup` call** (75 calls/smoke run = up to 75s of wall time).

**Proposed signal.** Storage-write `nulo:popup:handshake-ready` from the popup once `isBackgroundConnected` flips to true AND `loadProfile()` has resolved (the popup's `onActiveProfileChanged` handler is the latest synchronization point). Then tests poll for that key and skip the triple-nav.

```ts
// app.vue addition (near isBackgroundConnected watcher):
watch(isBackgroundConnected, async (connected) => {
  if (!connected) return
  await loadProfile()
  await chrome.storage.session.set({
    "nulo:popup:handshake-ready": Date.now(),
  })
})

// openPopup() simplification:
await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
await page.waitForFunction(
  async () => {
    const r = await chrome.storage.session.get("nulo:popup:handshake-ready")
    return !!r["nulo:popup:handshake-ready"]
  },
  { timeout: 15_000, polling: 200 },
)
```

**Wallet code changes needed.** Modest. Add a single storage write in `app.vue` (popup-side, after the existing `loadProfile` chain). Could also live in `utils/core.ts:initAppServiceContext`.

**Test code changes.** Replace the `await page.goto(popupUrl)` → `goto("about:blank")` → `goto(popupUrl)` sequence with a single goto + the wait above.

**Failure mode.** If the popup never lands on a valid hash (e.g., true SW handshake failure), the new wait times out at 15s instead of the current behavior of waiting 30s for a hash that never comes. Symmetric, just more honest.

**Open question.** Why does the SW's first-popup-on-fresh-tab handshake fail in the first place? That's the *underlying* bug. The triple-nav is a workaround; the storage signal is an observability fix that lets us know when the workaround isn't needed and (eventually) tackle the root cause.

**Coverage need.** Existing `sw-resilience.test.ts` already exercises SW respawn. Add one case: "first popup open after SW boot lands on a valid hash within 15s".

**Recommendation.** Land this in a SEPARATE PR after the tx-signal work. Order matters: if the signal is buggy, every fixture breaks at once. The tx signal failure mode is localized to transfer tests.

---

### Sleep #5 — `waitForToast` brittleness (helpers.ts:677-683)

**Async work being waited on.** Toast appears 2s after the underlying mutation succeeds. Tests use it as a post-mutation success signal.

**Problem.** The toast is a *redundant tail* — the actual mutation is observable upstream:
- "Contact is added" → contact-row already rendered.
- "Token added" → token-card already rendered + balance projector ran.
- "Transaction submitted" → journal record exists at stage `submitting` or later, AND the SendPopup unmounts.
- "Password changed" → can be observed as the auth page navigation.

**Proposed signal per caller.** Audit every `waitForToast` site and replace with the upstream post-mutation signal:

| Caller | Current | Proposed |
|---|---|---|
| `addContact` | already waits for contact-row, then toast (redundant) | drop toast wait |
| `importToken` | toast at end | wait for `nulo:core:tokens@*` to contain the new contract, OR wait for token-card with `data-token-contract=<addr>` |
| `sendTransfer` | toast "Transaction submitted" | wait for journal record at stage `submitting` (or later) via `chrome.storage.session.get("nulo:journal@<id>")` — OR wait for popup unmount + `nulo:core:txs@*` to contain a new entry with the recipient |
| `changePassword` (callers) | toast | wait for the auth-or-settings router transition |
| any other `waitForToast` caller | toast | depends — audit per call site |

**Wallet code changes needed.** Optional but useful: add `data-token-contract` on `TokensCard.vue` and `data-tx-hash` + `data-tx-status` on the `tx-card` data-testid root. These attributes make assertions sharper without touching service logic.

**Test code changes.** Per the table above. The toast helper itself stays for cases where copy is genuinely load-bearing (toasts that report ERROR conditions — those don't have a parallel non-toast signal).

**Failure mode.** Per-caller. Most upstream signals are strictly more reliable than the toast (toast auto-dismisses in 2s; the underlying mutation persists).

**Coverage need.** None new. We're not adding tests, we're removing toast-coupling.

**Recommendation.** Land last, as smaller PRs per caller. The blast radius of changing `addContact`'s helper alone is small; changing every toast wait at once is large.

---

## Phasing / PR strategy

Order is **smallest blast radius → largest**:

| # | PR | Scope | Blast radius | Validation |
|---|---|---|---|---|
| 1 | `e2e/tx-confirmation-signal` | Replace sleep #1 (`waitForTxConfirmation`) with storage-poll. Add `data-tx-hash` + `data-tx-status` on TransactionCard. Have `sendTransfer` return the hash. | 3 tests use `waitForTxConfirmation` (all in transfers.test.ts). | Run `transfers.test.ts` 5× locally + 1 hosted CI. |
| 2 | `e2e/refresh-balance-signal` | Delete sleep #3 (3s post-refresh in sendTransfer). | Every `private`-from sendTransfer call. ~5 tests. | Run `transfers.test.ts` + `fee-methods.test.ts` 5× locally. |
| 3 | `e2e/popup-handshake-signal` | Add `nulo:popup:handshake-ready` storage write in `app.vue` + popup wait in `openPopup`. Drop the triple-nav. | EVERY e2e test. | Smoke + network suites 3× locally. Hosted CI rerun. |
| 4 | `wallet/anchor-freshness-gate` | Wallet-side: ExecutionService gates on PXE anchor before prove. (Separate from determinism PR.) Drops sleep #2 as side effect. | Every transfer + every dapp send. | Unit tests + network suite. |
| 5 | `e2e/drop-redundant-toasts` | Per-caller. One PR per ~3 callers. | Per-caller. | Smoke suite. |

Total budget estimate: **PRs 1+2 take ~1 day**, PR 3 is **2 days** (small change, large surface to validate), PR 4 is a **wallet feature** (multi-day with audit), PR 5 is **incremental** (no blocking dependencies).

## Tests to modify

**Network:**
- `packages/extension/tests/e2e/network/transfers.test.ts` — 4× `waitForTxConfirmation` calls; switch to hash-targeted signal.
- `packages/extension/tests/e2e/network/fee-methods.test.ts` — 2× 5s post-estimate sleeps; cover under PR4 (wallet fix), not test PR.
- `packages/extension/tests/e2e/network/fee-methods.test.ts:71,75,138,142` — 4× 500ms toggle sleeps. These are inside the toggle-handler-guarded-by-cap-flags window; the helper `setActiveSendType` (helpers.ts:504-521) already polls correctly. These 4 sleeps can be DELETED in favor of the helper. Out of scope for this plan, but a free cleanup if we land it alongside PR2.

**Smoke / fixture-level:**
- `packages/extension/tests/e2e/fixtures/extension.ts:676-684` — triple-nav in `openPopup` (PR 3).
- `packages/extension/tests/e2e/fixtures/extension.ts:343,422,560` — three 1.5s polling intervals in `tokenReady/feeJuiceReady/feeJuiceImported` fixtures. These are deliberate — they pace `refreshBalances` calls against PXE sync. Out of scope; the comment already explains why.
- `packages/extension/tests/e2e/fixtures/helpers.ts:398,652,659,762,806` — 100-500ms "let Vue process" sleeps. Each one is a discrete micro-investigation; not part of this plan.

## Tests to add

**Unit:**
1. `TransactionService.test` — already covers the storage-write path. Add ONE case: "tx with `(account, hash)` becomes observable in `chrome.storage.local` after `updateTx`" — explicitly nails the e2e contract. <10 LOC.

**Integration:**
1. `app.vue.test` — assert `nulo:popup:handshake-ready` is written after `isBackgroundConnected` + `loadProfile` resolve. <30 LOC.

**E2E:**
- None new. The existing transfer + fee-method tests are the validation surface; we're tightening their signals, not adding coverage.

## Tests to delete (or collapse)

- The 500ms sleeps after toggle clicks in `fee-methods.test.ts:71,75,138,142` are stale — `setActiveSendType` already exists and is the right helper. Replace those inline `evaluate({...click})` + `setTimeout(500)` blocks with `setActiveSendType(page, "send-from-type", "public")`. Free win.
- `waitForToast("Transaction submitted")` in `helpers.ts:618` becomes redundant once journal-record-at-stage-`submitting` is the signal. Drop it from `sendTransfer`.

## Questions for the user

1. **PR4 ordering.** Is the wallet-side anchor-freshness gate (`ExecutionService.executeTransfer` → re-check PXE block before `proveTx`) a feature you want to do BEFORE the determinism PRs, or accept the 5s sleep as a pinned workaround for now? My recommendation: pin for now, file the issue, keep the test PRs small.
2. **Per-tx hash return shape.** Should `sendTransfer` return `Promise<{ hash: string; submittedAt: number }>` so `waitForTxConfirmation` is hash-targeted? This is the cleanest contract but changes every caller (~20 call sites). Alternative: keep the helper void-return and have `waitForTxConfirmation` peek at the journal for the most-recent op of the active account. Less surgical, fewer call-site changes.
3. **Storage-poll vs. event-driven.** The cleanest signal would be wiring the test page to subscribe to `chrome.storage.onChanged`, push events into an array via `page.exposeFunction`, and have the test consume from that array. This eliminates polling entirely. Worth the helper-infrastructure cost, or stick with the 200ms-poll convention you already have?
4. **Popup-handshake bug.** Do you want to land the storage signal AND open a wallet bug to investigate WHY the first-popup handshake fails? Or is the workaround acceptable indefinitely?
5. **`waitForToast` deletion budget.** Some toasts are the only success indicator — e.g. `Sender registration failed` is meaningful ONLY as the toast color. Should the helper survive for warning/error cases and only the success cases get removed?

## Things I didn't investigate

- **`sw-resilience.test.ts` SW respawn paths.** Their relationship to PR3 (handshake signal) — if the SW is killed mid-test, the storage key from a prior popup mount could be stale. The popup remount after respawn needs to RE-write the key, not just rely on the prior value. I didn't read those tests deeply.
- **`passkey-paths.test.ts` and the substrate-too-slow comment.** These tests have their own per-test budgets; my plan doesn't touch them.
- **`dApp` interaction popups** (`discover-allow-btn`, `verify-allow-btn`). These are exit popups that auto-close on click resolution, and `clickByTestId` already swallows `TargetCloseError`. No sleeps there to address.
- **`global-setup.ts` 100/250/500ms sleeps.** Those are in CI-runner orchestration, not in tests proper. Different problem domain.
- **`aztec.ts` 2s sleeps in test wallet setup.** Those are sandbox-network sync pauses; outside the popup test scope.
- **`fee-methods.test.ts:5000ms` sleeps** (line 104, 172). These are the same PXE-anchor race as sleep #2 — covered by PR4.

I did NOT run the e2e tests to validate any of these proposals empirically. The plan is design-only per the prompt; the validation steps live in each PR's checklist.
