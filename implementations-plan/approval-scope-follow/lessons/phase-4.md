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
