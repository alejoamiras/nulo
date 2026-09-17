# Phase 4 — e2e (2026-09-17)

- `tests/e2e/fixtures/helpers.ts`: `waitForTxCardByHash(page, hash, timeout)` and `hasTxCardByHash(page, hash)` key the settled `tx-card` by its `data-tx-hash` (the hash the dApp received back), case-insensitive.
- `tests/e2e/network/execute-scope-chain.test.ts` (one test, `dappConnectedExtensionWithTransactionCap`): connect funded on Local Network; snapshot the profile's `nulo:core:active-network@…` pointer; `switchToNetwork(page, "Testnet")` and assert the account pointer left the signer (each chain derives its own default account); close that popup before the send, the way the approval window taking focus closes the browser-action popup; drive `sendTx`; assert `execute-scope-banner[data-state="chain"]`; `approveExecute`; `waitForPopupClosed` (the window closes only after both writes); on a **fresh popup** assert the network pointer is back to the Local Network row id, the account pointer is the signer, and `network-button` reads `Local Network`; then the dApp's `txHash` mined and present as a `tx-card` on Home.
- `tests/e2e/network/execute-scope-account.test.ts` (one test, three steps, `dappConnectedExtensionWithFirstTwoAccountsCap`): A = the account the fresh wallet is on, B = the other granted account, funded. The dApp sends as B through the playground's `pg-input-from`. (i) *follow*: banner `account`, confirm, fresh popup on B; the awaiting card was at `simulating` when `switchAccountByAddress(page, A)` ran — the window was **caught** on both runs (`console.info` in the transcript), and the switch went through; back to B, the mined hash is a `tx-card`. (ii) *decline*: banner `account` → action → `account-declined`, confirm, fresh popup still on A; the hash is a `tx-card` under B and absent under A. (iii) *lock contention*: the wallet popup holds `navigator.locks.request("nulo:scope-follow", …)`; a send as B is confirmed; asserted while held: one **pending** request for the lock in `navigator.locks.query()`, a new `dapp_execute` record past `queued` (the approval resolved and the send runs), the execute window still open, the pointer still A; on release the window closes and the pointer moves to B.
- Every post-confirm assertion reads storage or a freshly opened popup, per §Phase 4.

## Attempts

1. Run 1 of the account test failed at the first `activity-feed-root` wait after switching to A: Home renders its feed root only when the account has activity or a token, and A has neither (only B was funded). Fix: the feed-scope waits and card assertions moved to the History page (`#/popup/activity`), whose root always renders — the same page `account-switch-isolation.test.ts` uses. No production change.
2. Run 2 green.

## Gate

- `bun run e2e:agent tests/e2e/network/execute-scope-chain.test.ts` → 1 passed, exit 0 (retry 0, solo, 42s test / 96s run).
- `bun run e2e:agent tests/e2e/network/execute-scope-account.test.ts` → 1 passed, exit 0 (retry 0, solo, 76s test).
- biome clean on the three files.

## Notes for the PR

- Banner screenshots for the arc 2 PR were captured with a throwaway e2e (not committed) that drives the four reachable states — `chain`, `chain-declined`, `account`, `account-declined` — against the live sandbox. `multi-signer` has no playground path (no two-signer batch button), so it is pinned by `scope-mismatch.test.ts` and the window test only.
- Four network tests still carry a local copy of a playground input setter (`setPgInputs`); the new tests use the fixture's existing `setPgInput`. Consolidating the copies is outside this plan.
- The `[aztec-node] Error: Address already in use (os error 98)` line at boot appeared on every run here and did not stop the node; it is unrelated to these tests (it shows before the extension is built).

## Arc 2 codex loop (GPT-6 Astra, `high`, static) — session `01a0b049-…`

### Round 1 (on `ab76e151`) → conditional approve

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM — two follows can still write a mixed pair without any other writer: window A follows to chain Y, window B (resolved on X, `networkMismatch: false`) then acquires the lock, skips the network write and writes its X account under Y; the two-follows test used two chain mismatches so it could not see it | yes | **Adopted**: the live row is read under the lock (`getActiveNetworkId`, wired to `getActiveNetwork()`), after the refresh and a fence check, and the network is written whenever it differs from the view's row. Chosen over codex's literal suggestion (always write the view's row): `setActiveNetwork` never short-circuits — it re-persists, recreates the node handle and emits the service event (no popup subscribes to it — plan Fact 4; round 2 corrected an earlier claim that popups re-run `setupActiveAccount` on it) — so an unconditional write on account-only follows would add persistence and node churn for nothing. Core tests: both directions of the live-row decision; the chain-then-account regression over a fake row the fake `setActiveNetwork` moves; abort during the read. Recorded in plan.md §Known limitations. |
| 2 | MEDIUM — the banner action stayed clickable after Confirm: with the follow queued behind a held lock, "Stay" flipped the copy to the declined text while the captured `declined=false` still moved the pointers on release | yes | **Adopted**: `toggleFollow` returns while `isLoading`. Window test: a click during a parked approval leaves `data-state="account"` and the pointer still moves. |
| 3 | LOW — the refresh-race core test invalidated before the fake lock had even started the callback, so it never exercised "during a suspended refresh" | yes | **Adopted**: waits for `refreshInFlight` to have been called first |
| 4 | LOW — comments: "Nothing to repair" overstated (bootstrap falls back to `accounts[0]`); plan.md guaranteed "new chain with the remembered account"; "never named or aimed at" (multi-signer copy names hidden signers); a tautological `scopeBannerState` doc; a three-line state intro | yes | **Adopted** all |

Held: copy verbatim in every state incl. chains-only and read-only; reject/cancel, fee handoff/rearm and cleanup order intact; the predicate runs after the barrier; the e2e observes real cross-realm contention; selectors by testid.

Fixes committed as `00815a70`; gate re-run: 16 files / 155 tests, typecheck + lint exit 0.

### Round 2 (resumed, on `00815a70`) → **approve**

Quoted: "**Approve — no new material findings.** Confidence: high from static review." Holds: the live-row read runs inside the lock with the fence checked right after; `getActiveNetwork()` throws when locked (its `requireActiveProfile`), so `null` means an absent or foreign pointer and mapping it to `undefined` correctly establishes the row first; the toggle guard covers the approval and the awaited follow; the revised refresh test invalidates during the suspended refresh. Correction taken: no popup subscribes to `onActiveNetworkChanged` (plan Fact 4) — the live-read rationale is persistence and node churn, not popup side effects.
