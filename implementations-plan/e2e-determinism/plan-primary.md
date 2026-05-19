# e2e Determinism Plan — primary draft

Awaiting parallel-claude's plan; this is my independent take. Codex audit after consolidation.

## TL;DR

8 fixed-time sleeps in the test code totaling ~22s per network suite run (with 5 callsites for the 5s/`sendTransfer` × 4-8 calls = up to 40s). Most can be replaced with state signals that ALREADY EXIST in the wallet — `chrome.storage.local` mutation, DOM testids, the `awaitingTransactions` ref, or simple `waitForSelector` on a known-mounted element. One or two need a small wallet-side addition. The biggest single win is **`waitForTxConfirmation`'s 10s sleep × 4 calls in `transfers.test.ts` (40s)** — replaceable with a `chrome.storage.local` poll for `status !== "Pending"`.

The deepest insight: most of these sleeps were added because the test was reading a DOM signal that fired before the underlying SW work landed. The fix is **wait for the SW's write to chrome.storage.local, not the DOM**. Storage writes are deterministic; DOM renders happen on Vue's reactivity timing which can lag.

## The 8 sleep sites — verified inventory

| # | File:line | Sleep | Purpose (per comment) | Risk if replaced |
|---|---|---|---|---|
| S1 | `helpers.ts:398` | 500ms | wait for `tokens-menu-trigger` dropdown to render after click | Low — replace with `waitForSelector` on the menu item |
| S2 | `helpers.ts:541` | 3000ms | wait for PXE sync after `refreshBalances` (private-from sendTransfer) | Low — downstream `input-enabled` wait already covers |
| S3 | `helpers.ts:607` | 5000ms | "Give PXE a moment to fully sync after fee estimation before proving" | **Medium** — codex flagged. Real PXE-anchor sync race. Needs wallet signal or live with it |
| S4 | `helpers.ts:627` | 10000ms | `waitForTxConfirmation` — tx-confirmed signal | Low — storage poll on `nulo:core:txs@*` `status` field |
| S5 | `helpers.ts:652` | 500ms | wait for fee-method dropdown to render after click | Low — `waitForSelector` |
| S6 | `helpers.ts:659` | 500ms | wait for fee-method selection to apply (trigger text update) | Low — wait for trigger text containing selected method |
| S7 | `helpers.ts:762` | 100ms | "Let Vue process the @update:modelValue → setValue → re-render" for privacy toggle | Low — wait for `data-toggle-active` matching desired |
| S8 | `helpers.ts:806` | 200ms | `navigateByHash` Vue mount after hash settles | Low — same pattern as `navigateToSettings` we already dropped in PR-C; should remove |
| S9 | `extension.ts:676-684` | (triple-nav) | `openPopup` SW handshake workaround | Medium-High — make conditional on fast-path failure |

(Plus the 1500ms loop sleeps in fixture polling loops at `extension.ts:343,422,560` — those are correct as polling cadences, not "wait then proceed" sleeps. Leave alone.)

## Per-signal designs

### S4 — `waitForTxConfirmation` (BIGGEST WIN: 10s × 4 = 40s)

**What's waiting:** the wallet's `TransactionService` worker (`packages/extension/src/wallet/services/transaction/service.ts:176-260`) polls the chain and updates `tx.status` from `"Pending"` → `"Proposed"`/`"Checkpointed"`/`"Proven"`/`"Finalized"` as the tx settles. Each transition writes to `nulo:core:txs@<hash>` in `chrome.storage.local` AND emits `onTransactionUpdated` on the service.

**Signal:** poll `chrome.storage.local` for transactions belonging to the test's account; count those with `status === 0` (`TxStatus.Pending` is a NUMERIC enum — verified at `spec.ts:13-20`). Wait until it's 0.

**Why this works:**
- The transfers test submits one tx at a time, waits for it, then submits the next.
- `status === "Pending"` flips deterministically when PXE sees a block containing the tx.
- Storage write is durable — no in-popup state. Works even when no popup is open.
- The "0 pending" condition is monotonic for the duration of a single waitForTxConfirmation call (no new submits in between).

**Implementation:**
```ts
export async function waitForTxConfirmation(page: Page, account: string, timeout = 30_000): Promise<void> {
    await page.waitForFunction(
        async (acc: string) => {
            const all = await chrome.storage.local.get(null)
            const pending = Object.entries(all)
                .filter(([k]) => k.startsWith("nulo:core:txs@"))
                .map(([, v]) => (typeof v === "string" ? JSON.parse(v) : v))
                .filter((tx: any) => tx.account === acc && tx.status === 0 /* TxStatus.Pending */)
            return pending.length === 0
        },
        { timeout, polling: 250 },
        account,
    )
}
```

Worker cadence verified at `service.ts:176-194`: worker polls every 1s, awaits `txs.set(...)` BEFORE emitting `onTransactionUpdated`. So storage update lag ≤ ~1s after the aztec node has the receipt. Plenty of headroom for our 250ms polling.

Caller change: `waitForTxConfirmation(page)` → `waitForTxConfirmation(page, tokenReadyExtension.accountAddress)`.

**Wallet code changes:** none.

**Validation:**
- Unit: TransactionService test asserting status transitions write to `nulo:core:txs@<hash>` with correct values. (Likely already exists; check.)
- e2e: `transfers.test.ts` (4 calls) — should still pass; total scenario wall time drops from ~140s to ~100s.

**Risk:** if a tx confirms but storage doesn't get the write yet (race between PXE update and EntityStorage.set), we could read 0-pending and proceed too early. **Counter:** the writes are awaited (`await this.txs.set(...)` then `this.emit(...)`); the storage write completes before the worker advances. Safe.

**Edge case:** previous tests' confirmed txs from prior fixture state could populate the storage. We filter by account, and the test's `tokenReadyExtension` account is fresh per-fixture-build. Safe.

### S3 — `sendTransfer` 5s post-fee-estimation sleep

**What's waiting:** "PXE to fully sync after fee estimation before proving" — the fee estimation triggers a `simulateTx` which updates PXE's internal state. The submit's `proveTx` needs the PXE at a synced anchor.

**Signal candidates:**

(a) **Drop the sleep entirely; rely on the submit-enabled wait.** The submit button is gated on `pe.value` (per `send.vue:160-170`), which is gated on `validateSendAmount` + `feeEstimate` being defined + `feeSettings` being set. If PXE's anchor is stale, the proveTx should fail at submit time with a clear error. Codex specifically warned this might surface a real race; user has said honest failure is preferred.

(b) **Wait for the wallet's internal block-sync signal.** Wallet doesn't expose this today. Would need a small addition to `PxeServiceClient` to expose `isBlockSynced()`. ~30 LOC. Higher confidence but more code.

**Recommendation:** **try (a) first.** Drop the sleep, run the transfers scenario 3× locally + on CI. If proveTx errors appear, switch to (b).

**Wallet code changes:** option (a) none; option (b) ~30 LOC.

**Validation:** transfers scenario (uses `sendTransfer` 4×) + fee-methods.test.ts (5 calls). 3× local each.

**Risk:** real proveTx anchor race appears under cumulative load. Detectable as a specific error from the SW; not a silent failure.

### S2 — `sendTransfer` 3s post-refresh (private-from path)

**What's waiting:** PXE write of refreshed private balances.

**Signal:** the downstream `tokenBalanceByType > 0` (input-enabled) wait at `helpers.ts:559-565` ALREADY checks this. The 3s sleep is double-defense.

**Implementation:** drop the sleep. The downstream wait has 60s budget + 2s polling.

**Wallet code changes:** none.

**Validation:** transfers scenario step 4 (private → public) + step 5 (private → private).

**Risk:** none I can see. The downstream wait is the real signal.

### S1, S5, S6 — dropdown render + selection 500ms × 3

**What's waiting:** Vue dropdown component to mount/update after click.

**Signal:** `waitForSelector` on the actual element being clicked next. Already a deterministic state-driven signal.

**Implementation:**
- S1: after `tokens-menu-trigger` click → `waitForSelector('[data-testid="tokens-menu-import"]', { visible: true, timeout: 2_000 })` BEFORE the next click.
- S5: same pattern for `send-fee-method-trigger` dropdown.
- S6: after fee-method selection click, wait for the trigger text to change. Specifically: `waitForFunction(() => document.querySelector('[data-testid="send-fee-method-trigger"]').textContent.includes(selectedSubtitle))`.

**Wallet code changes:** none (existing testids).

**Validation:** all tests using `importToken` (every network fixture) + tests using `selectFeeMethod` (fee-methods.test.ts).

**Risk:** none. State-driven.

### S7 — privacy toggle 100ms

**What's waiting:** Vue reactive update after toggle click.

**Signal:** the toggle component exposes `data-toggle-active="true"/"false"` (added in PR #70 per the historical context I read). Wait for that attribute to match desired state.

**Implementation:**
```ts
await page.waitForFunction(
    (sel: string, target: string) => document.querySelector(sel)?.getAttribute("data-toggle-active") === target,
    { timeout: 2_000, polling: 50 },
    `[data-testid="privacy-toggle-${key}"]`,
    String(newValue),
)
```

**Wallet code changes:** verify `data-toggle-active` is on the privacy-toggle component (likely yes, PR #70 added across Toggle.vue).

**Validation:** settings-crud.test.ts or wherever setPrivacySetting is used.

**Risk:** none.

### S8 — `navigateByHash` 200ms

**What's waiting:** Vue route component mount after hash settles.

**Signal:** none needed — the caller does its own `waitForSelector` for the landed page's elements (same pattern we already validated for `navigateToSettings`).

**Implementation:** drop the sleep.

**Wallet code changes:** none.

**Validation:** appearance.test.ts + security.test.ts (both use `navigateByHash`).

**Risk:** if a caller doesn't follow with `waitForSelector`, race. Audit the callsites; only ~6.

### S9 — `openPopup` triple-nav

**What's waiting:** SW first-popup handshake. The 2nd+3rd navs are defensive — give the SW time to be "ready" for the popup's client.

**Signal candidates:**

(a) **Conditional fallback.** Try one goto + 2s wait for non-empty hash. If that fails, fall back to the about:blank dance. Worst-case 2s slower than today; happy-path ~500-800ms faster.

(b) **Wait for the wallet-bridge to have connected.** The popup's wallet-bridge client logs "Client disconnected" on failure; on success, it sets some readiness state. Could expose this as a `window.__nulo_popupReady` flag (test-only). Cleaner long-term.

**Recommendation:** start with (a). Measure on smoke (75+ invocations). If consistently ~500ms saved per call without flakes, ship; that's ~37s per smoke run wall time.

**Implementation:**
```ts
await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
try {
    await page.waitForFunction(
        () => window.location.hash !== "#/" && window.location.hash !== "",
        { timeout: 2_000, polling: 100 },
    )
    return  // happy path
} catch {
    // SW handshake didn't land; do the dance
    await page.goto("about:blank")
    await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
        () => window.location.hash !== "#/" && window.location.hash !== "",
        { timeout: 15_000, polling: 200 },
    )
}
```

**Wallet code changes:** none for (a). ~5 LOC for (b).

**Validation:**
- Smoke 3× local + 1× CI. Measure wall time delta.
- Network 3× local. Confirm fixture builds still work (they all use openPopup).

**Risk:** if the SW handshake fails AT 2s exactly, we double-nav unnecessarily. Acceptable.

## Phase / PR strategy

Smallest blast radius first; each PR independently revertable.

**PR-A (low risk)** — Drop dead sleeps + state-driven dropdown waits
- S1, S2, S5, S6, S7, S8: replace with `waitForSelector` / state checks
- ~6 sleeps gone, ~1.5s saved per network suite + ~1s smoke
- Helper code only; no wallet changes
- Validates the pattern

**PR-B (medium risk, biggest win)** — `waitForTxConfirmation` storage poll
- S4: replace 10s sleep with `chrome.storage.local` `status !== "Pending"` poll
- ~40s saved on transfers scenario
- Helper change only; signature changes (need account address)
- Helper unit-tested by running transfers scenario 3× locally

**PR-C (experimental)** — Drop `sendTransfer` 5s post-fee-estimation
- S3: drop the sleep; run scenario 3× to see if proveTx anchor race fires
- If green: ship. If breaks: revert and design wallet-side `isBlockSynced` signal in a follow-up.

**PR-D (highest blast radius)** — `openPopup` conditional fast-path
- S9: try single-nav; fall back to triple-nav if SW handshake hasn't landed
- 75+ invocations per smoke run; measure wall time impact
- Standalone PR with metrics in the description

## Tests to modify

**Network:**
- `transfers.test.ts` — 4 callers of `waitForTxConfirmation` need updated signature (account arg)
- `fee-methods.test.ts` — uses `sendTransfer` 5 times (S3 + S2 indirectly)
- `tokens.test.ts` — uses `importToken` (S1)
- All fixtures using `importToken`: `tokenReadyExtension`, `feeJuiceReadyExtension`, `feeJuiceImportedExtension`

**Smoke:**
- `appearance.test.ts`, `security.test.ts` — use `navigateByHash` (S8)
- `settings-crud.test.ts` — privacy toggle (S7)
- Every test transitively — `openPopup` (S9)

**Unit:**
- `transaction-service.test.ts` (if exists) — verify status transitions hit storage
- New helper `waitForTxConfirmation` doesn't need a unit test — it's a CDP wrapper; e2e is the test.

## Tests NOT to modify

- `batch-partial-failure` (cluster F, deferred)
- `connect-locked-queue` (cluster G, deferred — separate "queued-signal" follow-up)
- The fixture polling loops at `extension.ts:343,422,560` — already at the right cadence (polling, not "wait then proceed")

## Questions for the user

1. **PR ordering.** A-B-C-D (smallest → biggest) or do the biggest-win (B: tx-confirm storage poll) first to maximize early payoff? My lean: A-B-C-D. B alone is ~40s saved on transfers; A is ~2s; but A is the low-risk validator for the pattern.

2. **S3 experiment risk.** Codex warned dropping the 5s sleep might surface a real PXE-anchor sync race that's currently masked. If it does, the right fix is wallet-side (`isBlockSynced` exposed via PxeServiceClient) — a small (30 LOC) but invasive change. **OK to design that wallet signal if S3 experiment breaks transfers?**

3. **S9 risk tolerance.** `openPopup` is called 75+ times per smoke run; a subtle regression in the conditional fallback could affect every test. **Land as its own PR with focused measurement, or roll into a broader speed PR?**

4. **Test deletion.** None of the modifications obsolete any test. **Same standing permission as before — delete with PR-description rationale if I find redundancy?**

5. **Codex audit prompt focus.** The audit should challenge: (a) the `chrome.storage.local` `nulo:core:txs@*` poll's atomicity (could we read mid-write?), (b) the conditional `openPopup` 2s fast-path budget, (c) whether dropping S3 needs the wallet signal up-front. **Other areas to push codex on?**

## What I verified mid-draft (open questions answered)

- **`chrome.storage.local` cross-context visibility**: `chrome.storage.local` is a chrome.* namespace, shared across SW + popup + content scripts. Writes from one context are visible from others. SW write → popup read works.
- **`tx.account` field**: it's `string` (account address as hex string per `spec.ts:96`). Filter by exact match against `tokenReadyExtension.accountAddress` works directly.
- **Terminal `Pending` risk**: `TxStatus` enum has `Pending, Dropped, Proposed, Checkpointed, Proven, Finalized`. Worker keeps polling pending txs forever (`pending` Map, no timeout) — but `getTxReceipt` returns *some* status; if the chain drops the tx, it goes to `Dropped`, not stuck `Pending`. The poll resolves on any non-Pending status.
- **`TxStatus.Pending === 0`** — numeric enum, no explicit values, so Pending is the first variant (0). The comparison must be `=== 0`, not `=== "Pending"`. Plan updated.

## What I didn't verify

- Whether the `openPopup` triple-nav's about:blank is needed for something OTHER than SW handshake (e.g., Chrome-extension lifecycle). Codex audit can spot-check the git log for the original commit that added it.
