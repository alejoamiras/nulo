# Phase 0 findings — three runs, one unifying bug

Phase 0 ran three diagnostic e2e tests with [PHASE0:*] console probes inside `withPxeRead/Write`, the RPC client `disconnect()`, the `applySenderDelta` branches, `closeStuckPopup`, and `NewTokenPopup.handleAddToken`. All three runs reverted to a single unifying root cause that **neither audit predicted** and that **a timeout bump cannot fix**.

## Run 1: transfers > "balance shows minted tokens" (Cluster A)

```
[PHASE0:NewTokenPopup] handleAddToken ENTER avail=true contract=0x1e94…
[PHASE0:NewTokenPopup] parseTokenInterface CALL networkId=4d0e622a
[PHASE0:NewTokenPopup] parseTokenInterface OK isComplete=true elapsed=5192ms
[PHASE0:NewTokenPopup] addToken CALL
[PHASE0:NewTokenPopup] CATCH err=Cannot read properties of undefined (reading 'address') elapsed=5192ms
```

- `parseTokenInterface` is **fast** (5.2s, well under 60s budget)
- `parseTokenInterface` returns `isComplete: true` (kills the A2 hypothesis)
- The next line `await tokenService.addToken(profileId, networkId, **appStore.account.address**, parsingResult)` throws **synchronously** because `appStore.account` is `undefined`
- The popup's `try/catch` swallows the error and sets `error.value` instead of firing the toast
- Helper times out at 60s waiting for a toast that will never come

**A1 (slow PXE) and A2 (isComplete:false) are both wrong**, even though both audits leaned on them. R1 (PXE-guard serialization) is real — `simulateTx` took 3.6s, `registerContract` took 502–1005ms — but that's NOT what's blowing up the test. The test fails because the popup tries to read `.address` off `undefined`.

## Run 2: fee-methods > "transfer with public Fee Juice" (Cluster B)

Test failed at `extension.ts:514` — the **explicit 30s waitForFunction** that polls `chrome.storage.local["nulo:ui:activeAccount"]` for the prefunded address. The wait timed out.

```
const accountAddress = prefunded.accountAddress.toString()
await page.waitForFunction(
    async (expected) => {
        const r = await chrome.storage.local.get("nulo:ui:activeAccount")
        return r["nulo:ui:activeAccount"] === expected
    },
    { timeout: 30_000, polling: 500 },
    accountAddress,
)
```

**No LMDB error**. The fee-juice fixture's Phase 1 (`setupPreFundedAccount`) succeeded; Phase 2 fails because `nulo:ui:activeAccount` never settles on the imported address after `switchToLocalNetwork`.

- This kills opus's "Cluster B is a separate (d) sandbox cluster" framing.
- Codex was right: B is mostly the same cascade as A. LMDB is sporadic, not a deterministic class.

## Run 3: contacts-sender > "edit contact address with sender ON migrates" (Cluster C/D)

Test failed at line 135 — the **10s wait for the sender chip** to appear after `addContact(name, addr, { registerAsSender: true })`. The test never reached the edit/migrate flow.

```
[PHASE0:RPC] account DISCONNECT rejecting 1 pending
[PHASE0:RPC] account REJECT-PENDING id=1     ← but on `account` service, not `account-state`
[PHASE0:RPC] execution DISCONNECT rejecting 1 pending
[PHASE0:RPC] execution REJECT-PENDING id=1
[PHASE0:RPC] account-state DISCONNECT (clean, no pending)   ← addSender NOT cancelled
```

- Codex's "closeStuckPopup mid-RPC abort kills addSender" hypothesis is **NOT confirmed** for this path. `account-state` (which does `addSender`/`deleteSender`) disconnects CLEAN with NO pending. So `addSender` completed before the disconnect.
- The chip never renders despite `addSender` succeeding. Same flavor as Cluster A — the contacts page's chip rendering depends on `appStore.account` and the active-network senders list, both downstream of the same `accounts.value` path.
- **Two separate REJECT-PENDING events DID fire** (on `account` and `execution`), so the disconnect-cancels-pending pattern IS real, just not on the addSender path. Still worth fixing.

## The unifying root cause

**`switchToLocalNetwork` does not wait for the popup's account state to be populated for the new network.**

Mechanism (`app.vue:131-150`):
1. User clicks "Local Network" in the network popup
2. SW emits `onActiveNetworkChanged`
3. Popup's `watch(() => appStore.network)` fires
4. `accounts = getAccounts(profile, chainId)` — re-fetches accounts for the new network
5. `setupActiveAccount()` — picks `accounts.value[0]` if storage doesn't have one
6. **If accounts.value is EMPTY** (Local Network never had an account auto-created), `account.value = undefined` and `nulo:ui:activeAccount` stays null

The watcher comment at `app.vue:138-143` explicitly says auto-create lives ONLY in `initAccount()`, not in the network-switch watcher — to avoid a duplicate-account race during initial profile load. But that means **switching to a network that has no accounts leaves the popup with `account = undefined` indefinitely**.

This is what hits all three clusters:
- **Cluster A**: NewTokenPopup.handleAddToken accesses `appStore.account.address` → throws → silent catch → no toast → 60s timeout
- **Cluster B**: feeJuiceImported fixture's explicit waitForFunction times out at 30s waiting for `nulo:ui:activeAccount`
- **Cluster D**: contact-row renders but the sender chip's render path depends on the active-network senders list (which depends on `account` being set) → chip never appears within 10s

Cluster E (data-registerSender) is a separate fixture (`dappConnectedExtension`), not yet probed but very plausibly the same root.

## What this means for the Q2 / Q3 answers

Re-reading the decision matrix in light of Phase 0 data:

- **Q2 (RPC-abort fix)** — REJECT-PENDING does fire (twice in Run 3), but **not** on the addSender path that drives the failing tests. Still worth fixing because it's a real product bug (closing the popup mid-side-effect). But it's NOT what's blocking the network suite. Demoted from "fix R2 for C+D" to "fix R2 because correctness".
- **Q3 (bump timeouts)** — **Bumping timeouts will NOT fix any of A, B, or D.** The failure is a deterministic silent crash inside a swallowed catch (A) or an explicit wait that already polls 30s (B) or a never-rendering chip (D). The right fix is wallet-side: ensure account state is populated after `switchToLocalNetwork`.

The "perf improvement on another branch" you mentioned might still be worth landing for cold-PXE health, but it doesn't address the bug we found. Need to confirm.

## Proposed fix surface (one PR, as you chose in Q5)

### Wallet fixes

1. **`app.vue:131-150` — network watcher**: also call `ensureDefaultAccount` after re-fetching accounts when accounts is empty. The race-with-initAccount the comment warns about can be avoided by checking `appStore.accounts.length === 0 && !cooldownInProgress` — and ensureDefaultAccount is documented as idempotent + serialized so the worst case is a wasted SW round-trip.
2. **`NewTokenPopup.handleAddToken`** — guard the address access:
   ```js
   if (!appStore.account?.address) {
     error.value = "No account selected. Please switch networks again or restart the wallet."
     return
   }
   ```
   Plus disable submit button via `submitDisabled` when `!appStore.account`. Belt + suspenders so a user can never click and silent-fail.
3. **`NewContactPopup.handleAddContact`** — same guard for the addSender branch.
4. **`EditContactPopup.handleUpdateContact`** — same guard.
5. **`background/client.ts:69-87` (Q2 (i))** — change `disconnect()` to NOT reject pending requests; let them resolve via the existing onMessage handler. Pending response delivery on a disconnected port is already a no-op in chrome.runtime so this is safe. Real-product win for closes-mid-side-effect.

### Test-helper fixes

6. **`switchToLocalNetwork` helper (Q2 (ii))** — after the click + `closeStuckPopup`, wait for `nulo:ui:activeAccount` to be populated AND `appStore.account` to be set in the popup state:
   ```ts
   await page.waitForFunction(
     async () => {
       const r = await chrome.storage.local.get("nulo:ui:activeAccount")
       return !!r["nulo:ui:activeAccount"]
     },
     { timeout: 30_000, polling: 250 },
   )
   ```
7. **`addContact` helper** — when `registerAsSender: true`, ALSO wait for the sender chip on the row before returning. Right now it only waits for the contact row, which is a weaker signal.
8. **`closeStuckPopup` helper (Q2 (ii))** — best-effort wait for `accountStateService` / `contactService` to have NO pending requests before pressing Escape. This is harder; a CDP probe to read the `requests` map size on each client. May skip if (1) lands cleanly because (1) makes the disconnect non-cancelling.

### Tight-timeout bumps (smaller pieces)

9. **contacts-sender test 1 chip wait**: 10s → 30s.
10. **data-registerSender waitForPgResult**: confirm 30s is enough; bump to 60s if needed.

### Anti-scope

- No PXE-guard refactor. Performance numbers from Run 1 (`simulateTx 3.6s`, `registerContract` 1s) suggest there's headroom for perf work but it's NOT what's blocking the suite. Defer.
- No LMDB workaround. Run 2-1 had no LMDB error; codex was right that it's sporadic.
- Phase 0 instrumentation reverted before this PR opens (the `[PHASE0:*]` console.log markers + `phase0-diag.ts` get deleted).

## Status of unanswered probes

- Cluster E (data-registerSender) — not yet probed, but very plausibly the same root if it uses the same `localNetworkExtension`-like setup.
- The `account` REJECT-PENDING in Run 3 — which RPC was rejected? Worth one more probe to confirm what Q2(i) is actually fixing.
