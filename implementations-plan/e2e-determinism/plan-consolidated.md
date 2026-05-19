# e2e Determinism Plan — consolidated

Merges `plan-primary.md` (mine) + `parallel-claude-plan.md`. Where the two plans diverged, this resolves via verified evidence from the source. **This is the plan codex will audit.**

## What parallel-claude won

- **Hash-targeted `waitForTxConfirmation`** beats account+since-targeted (mine). Eliminates the race where call #1's terminal storage state satisfies call #2's wait. Cleaner contract; cost is ~20 call-site changes.
- **Wallet-side anchor-freshness gate** for the 5s post-fee-estimation sleep — not test-side. Mine proposed "drop and see"; theirs is "this is a wallet bug, pin with a rename, file the issue, don't touch the test." Codex pre-flagged this in earlier audits. Correct framing.
- **Wallet-side `nulo:popup:handshake-ready` storage write** for the triple-nav workaround — cleaner than my conditional fallback. Adds ~5 LOC to `app.vue`; drops the triple-nav entirely in test code.
- **Existing operation-journal** at `chrome.storage.session.nulo:journal@<id>` (verified: `packages/extension/src/wallet/services/operation-journal/service.ts:54`) is a richer signal source than I knew. Tracks `progress.stage`: "simulating" → "submitting" → "pending" → "succeeded"/"failed"/"cancelled". Either tx-storage or journal works; tx-storage is simpler.
- **Found 4 extra stale 500ms sleeps** I missed: `fee-methods.test.ts:71,75,138,142` are inline toggle-click + setTimeout that should use the existing `setActiveSendType` helper.
- **Found ANOTHER 5s sleep** at `fee-methods.test.ts:104,172` — same PXE-anchor race as `helpers.ts:607`. Both pinned under the wallet anchor-gate.

## What primary won

- **Verified evidence**: `TxStatus.Pending === 0` (numeric enum, not string). Both plans assumed string initially; mine corrected mid-draft via `spec.ts:13-20` read.
- **Worker cadence verified**: TransactionService worker polls every 1s, awaits `txs.set(...)` before emit. Storage update lag ≤ 1s after receipt arrival.
- **`chrome.storage.local` cross-context visibility verified**: SW writes are visible from popup reads.

## What both agree on

- Drop S2 (`helpers.ts:541`, 3s post-refresh). Downstream input-enabled wait covers.
- Drop S8 (`helpers.ts:806`, 200ms navigateByHash). Same pattern we already validated.
- Replace S1/S5/S6 (500ms dropdown waits) with `waitForSelector` on the next element.
- Replace S7 (100ms toggle wait) with `data-toggle-active` poll.
- `waitForToast` is a redundant tail; replace with upstream signals per-caller, last.

## Consolidated signal designs

### Signal 1 — Tx confirmation (BIGGEST WIN: 10s × 4 = 40s on transfers scenario)

**Async work:** `TransactionService.runWorker` polls `node.getTxReceipt(hash)` every 1s. On non-Pending status, writes `nulo:core:txs@<hash>` to `chrome.storage.local` with new status, awaits the set, emits `onTransactionUpdated`. Worker cadence verified at `service.ts:176-194`.

**Signal:** hash-targeted. `sendTransfer` returns `{ hash: string; submittedAt: number }`. `waitForTxConfirmation` polls `chrome.storage.local.get("nulo:core:txs@" + hash)`; resolves when `status !== 0` (`TxStatus.Pending`).

**Helper signature:**
```ts
// helpers.ts
export async function sendTransfer(...): Promise<{ hash: string; submittedAt: number }> {
    // ... existing flow ...
    // After "Transaction submitted" toast, read the new tx from chrome.storage.local
    const submittedAt = Date.now()
    const hash = await page.evaluate(async (acc, since) => {
        const all = await chrome.storage.local.get(null)
        for (const [key, raw] of Object.entries(all)) {
            if (!key.startsWith("nulo:core:txs@")) continue
            const tx = typeof raw === "string" ? JSON.parse(raw) : raw
            if (tx.account === acc && tx.createdAt >= since) return tx.hash as string
        }
        throw new Error("sendTransfer: tx not found in storage after submit")
    }, accountAddress, submittedAt - 5000)  // 5s lookback for safety
    return { hash, submittedAt }
}

export async function waitForTxConfirmation(page: Page, hash: string, timeout = 60_000): Promise<void> {
    await page.waitForFunction(
        async (h: string) => {
            const r = await chrome.storage.local.get(`nulo:core:txs@${h}`)
            const tx = r[`nulo:core:txs@${h}`]
            if (!tx) return false
            const parsed = typeof tx === "string" ? JSON.parse(tx) : tx
            return parsed.status !== 0  // TxStatus.Pending
        },
        { timeout, polling: 250 },
        hash,
    )
}
```

**Call sites to update:**
- `transfers.test.ts` — 4 calls to `waitForTxConfirmation`. Pattern: `const { hash } = await sendTransfer(...); await waitForTxConfirmation(page, hash)`.
- Other `sendTransfer` callers (no `waitForTxConfirmation` follow-up): update to discard the returned hash.

**Wallet code changes:** none.

**Validation:**
- Unit: existing `transaction-service.test.ts` covers the storage-write path. Add ONE case: "tx with `(account, hash)` is observable in `chrome.storage.local` after `updateTx` resolves" (per parallel-claude's recommendation, ~10 LOC).
- e2e: `transfers.test.ts` scenario 5× local. Wall time should drop from ~140s to ~100s.

**Risk:** if PXE re-emits with same status (no-op update), worker SHORT-CIRCUITS at `service.ts:223-226` and doesn't write to storage. But the initial Pending → first-non-Pending transition always writes. The poll catches it. Safe.

**Edge case:** prior transfers' confirmed txs from a fresh `tokenReadyExtension` fixture build won't have `createdAt >= submittedAt`, so the hash-target lookup post-submit only returns OUR tx. Safe.

### Signal 2 — `sendTransfer` 3s post-refresh (private-from)

**Async work:** PXE writes refreshed private balances post `refreshBalances` click.

**Signal:** downstream `input-enabled` wait (`tokenBalanceByType > 0`) covers it. Drop the 3s.

**Caller change:** delete the sleep at `helpers.ts:541`. Optional: add `data-token-balance="<wei>"` to `AmountCard.vue` for sharper test assertions if the input-enabled wait proves insufficient.

**Wallet code changes:** none required; the `data-token-balance` is an opt-in improvement.

**Validation:** transfers scenario (private steps) + fee-methods 5× local. If goes red, restore + add `data-token-balance`.

**Risk:** if PXE refresh doesn't land before the downstream wait, the input stays disabled past 60s timeout. Honest failure, not silent.

### Signal 3 — `openPopup` triple-nav

**Async work:** SW + wallet-bridge handshake on first popup connection on a fresh tab. Sometimes the SW's first response is dropped; the about:blank dance forces a fresh handshake on the 2nd goto.

**Signal:** add `chrome.storage.session.set({"nulo:popup:handshake-ready": Date.now()})` in `app.vue` after `isBackgroundConnected` flips true AND `loadProfile()` resolves. Test polls for that key.

**Wallet code change (small, single file):**
```ts
// packages/extension/src/popup/app.vue (near the isBackgroundConnected watcher)
watch(isBackgroundConnected, async (connected) => {
    if (!connected) return
    await loadProfile()
    // Test-observable signal that the SW handshake completed AND profile services
    // are bound. Replaces the test-side triple-nav workaround at fixtures/extension.ts:676-684.
    await chrome.storage.session.set({"nulo:popup:handshake-ready": Date.now()})
})
```

**Test code change** (`fixtures/extension.ts:676-690`):
```ts
await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
await page.waitForFunction(
    async () => {
        const r = await chrome.storage.session.get("nulo:popup:handshake-ready")
        return !!r["nulo:popup:handshake-ready"]
    },
    { timeout: 15_000, polling: 200 },
)
// Defense in depth: still wait for Vue router to land on a real hash.
await page.waitForFunction(() => window.location.hash !== "#/" && window.location.hash !== "", {
    timeout: 15_000,
    polling: 200,
})
```

**Validation:**
- Add `sw-resilience.test.ts` case: "first popup after SW boot lands on a valid hash within 15s, observed via `nulo:popup:handshake-ready`."
- Smoke 3× local. Network 3× local.
- Critical: validate that the SW respawn tests (`sw-resilience.test.ts:52,93,125,186`) still pass — the storage key from a prior popup mount needs to be cleared on SW respawn OR the popup needs to overwrite it with a fresh timestamp. Currently `chrome.storage.session` is cleared on SW death, so the new popup's write is fresh. Safe.

**Wallet code changes:** 1 file, ~5 LOC.

**Risk:** if `loadProfile()` hangs (e.g., locked profile), the signal never writes. Tests time out at 15s. Currently this would manifest as "popup stuck at #/auth" — the new behavior is "wait fails at 15s." Symmetric.

### Signal 4 — Misc small sleeps (S1, S5, S6, S7, S8)

Replace each with `waitForSelector` or attribute poll. No wallet changes.

| Sleep | Replacement | Risk |
|---|---|---|
| S1 (`helpers.ts:398`, importToken 500ms after menu open) | `waitForSelector('[data-testid="tokens-menu-import"]', { visible: true, timeout: 2_000 })` | None |
| S5 (`helpers.ts:652`, fee-method dropdown 500ms) | `waitForSelector` on the menu's first option | None |
| S6 (`helpers.ts:659`, fee-method selected 500ms) | `waitForFunction(() => trigger.textContent.includes(selectedSubtitle))` | None |
| S7 (`helpers.ts:762`, privacy toggle 100ms) | `waitForFunction(() => toggle.dataset.toggleActive === String(target))` | None |
| S8 (`helpers.ts:806`, navigateByHash 200ms) | Drop. Same pattern as `navigateToSettings` we already dropped in PR-C. | None |
| `fee-methods.test.ts:71,75,138,142` (4× inline 500ms) | Replace with `setActiveSendType(page, ...)` helper calls | None |

### Pinned (NOT touching in this work)

**Sleep #3 in primary plan (`helpers.ts:607`, 5s post-fee-estimation):**

Parallel-claude is right: this is a wallet bug, not a test bug. The simulate→prove pipeline doesn't gate proveTx on PXE having caught up to the simulate's anchor. Test-side mitigation is impossible without wallet changes.

**Action:**
1. **Rename the sleep constant** to make it visible:
   ```ts
   // Pinned workaround for a wallet bug: ExecutionService.executeTransfer doesn't
   // gate proveTx on PXE anchor freshness. Tracked: [issue link].
   const PXE_ANCHOR_SYNC_WORKAROUND_MS = 5_000
   await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))
   ```
2. **Open a wallet bug** for the anchor-freshness gate in `ExecutionService`. Separate PR, separate scope, requires multi-day wallet work + unit tests.
3. **Same rename** in `fee-methods.test.ts:104,172`.

**Sleep deletion: `waitForToast` brittleness (S5 in primary plan):**

Per-caller audit. Each toast has a stronger upstream signal:
- `Contact is added` → contact-row rendered (already covered)
- `Token added` → token-card rendered + balance projector ran (storage write to `nulo:core:tokens@*`)
- `Transaction submitted` → tx exists in `nulo:core:txs@*` (covered by Signal 1)
- `Password changed` → router transition to auth or settings

**Approach:** land last, as incremental small PRs per ~3 callers. Keep `waitForToast` helper for error/warning toasts (failure messages have no upstream signal).

## PR strategy (consolidated)

Stack of 5 PRs onto `dev`. Independently revertable.

| # | PR | Scope | Validation |
|---|---|---|---|
| **PR-A** | `e2e/det-misc-sleeps` | S1, S5, S6, S7, S8 + the 4 stale 500ms in fee-methods. ~7 sleeps gone, ~5s saved. Helper code only. | Smoke + network 3× local. |
| **PR-B** | `e2e/det-refresh-signal` | Drop the 3s post-refresh sleep (signal 2). | Transfers + fee-methods 5× local. |
| **PR-C** | `e2e/det-tx-confirmation` | Hash-targeted `waitForTxConfirmation` (signal 1). `sendTransfer` returns `{ hash, submittedAt }`. Update transfers.test.ts call sites. ~40s saved on transfers scenario. | Transfers 5× local + 1× CI. Add unit test for the storage-write contract. |
| **PR-D** | `e2e/det-popup-handshake` | Wallet `app.vue` writes `nulo:popup:handshake-ready`. `openPopup` drops triple-nav. 75+ invocations/smoke run; potentially ~30-40s smoke wall time. | Smoke + network 3× local + 1× CI. Add `sw-resilience.test.ts` case. |
| **PR-E** | `e2e/det-toast-audit` (incremental, can be split into smaller PRs) | Per-caller `waitForToast` → upstream signal. Keep helper for error toasts. | Smoke per-caller. |

**Out of scope (separate wallet PR, multi-day):**

- `wallet/anchor-freshness-gate` — `ExecutionService.executeTransfer` gates proveTx on PXE block tip ≥ simulate's anchor. Drops the 5s sleep in helpers.ts:607 + fee-methods.test.ts:104,172 as side effect. Add 10-case unit test for the gate (happy path, anchor-bump-mid-flight, timeout, rebuild-loop bound).

## Tests to modify (consolidated)

**Network:**
- `transfers.test.ts` — Signal 1 (4 calls to `waitForTxConfirmation`)
- `fee-methods.test.ts` — stale 500ms × 4 + future 5s pin × 2
- All fixtures using `sendTransfer` return (~20 sites)
- All tests transitively — `openPopup` triple-nav removed

**Smoke:**
- `appearance.test.ts`, `security.test.ts` — Signal 4 (S8 dropped)
- `settings-crud.test.ts` — Signal 4 (S7 dropped)
- `sw-resilience.test.ts` — Signal 3 (new "handshake-ready observable" case)

**Unit:**
- `transaction-service.test.ts` — add Signal 1 contract test (~10 LOC)
- `app.vue.test` (if doesn't exist, create) — Signal 3 popup-handshake-ready write (~30 LOC)

## Tests NOT to modify

- Fixture polling loops at `extension.ts:343,422,560` — already at the right cadence (the 1500ms is per-iteration polling, not "wait then proceed")
- `batch-partial-failure` (cluster F, deferred)
- `connect-locked-queue` (cluster G, separate "queued-signal" follow-up)
- All `passkey-*` tests — substrate timing, not signal design

## Open questions for the user (deduped)

**Q1 — Anchor-gate ordering.** The 5s sleep is a wallet bug. Two paths:
- (a) **Pin + ship determinism PRs** (parallel-claude's recommendation, my agreement) — file the wallet issue; this stabilization scope stays test-side.
- (b) **Anchor-gate first** — multi-day wallet feature with audit, then this stack on top. Higher confidence but blocks the determinism work.

My lean: **(a)**. The 5s sleep isn't blocking anyone; it's just an opaque wait.

**Q2 — `sendTransfer` return shape.** Hash-targeted approach requires changing `sendTransfer` to return `{ hash, submittedAt }`. ~20 call sites need updates (most just discard the return). Alternative: keep void-return; have `waitForTxConfirmation` peek the most-recent tx for the active account. Less surgical, race-prone. My lean: **hash-targeted**, despite the call-site churn.

**Q3 — Storage-poll vs. event-driven.** `chrome.storage.onChanged` + `page.exposeFunction` would eliminate the 200ms polling in our signal waits. New infrastructure. My lean: **stick with polling** for now (matches existing convention); event-driven is its own PR if we want it.

**Q4 — Popup-handshake root cause.** Adding the storage signal works around the symptom. Should I also file a wallet bug to investigate WHY the SW's first-popup handshake fails? My lean: **yes**, file separately. The workaround is acceptable but the root cause is unknown.

**Q5 — `waitForToast` survival.** Keep the helper for error/warning toasts (no upstream signal); remove for success toasts. **OK?**

**Q6 — PR ordering.** A → B → C → D → E (small to large)? Or do C first (biggest single win)? My lean: **A → B → C → D → E**. A+B validate the pattern; C compounds; D is the highest blast radius; E is incremental.

## Audit lineage

- `plan-primary.md` — my draft
- `parallel-claude-plan.md` — independent agent's draft
- `plan-consolidated.md` (this file) — merged, evidence-verified
- Next: send to codex for critical audit
