# Phase 2 — real browsers: the stack, and a menu inside a popup (2026-09-23)

## What changed

- `apps/extension/tests/e2e/popup-stack.test.ts`: second test. Both openers are opened with `pointerClick` (a real click focuses them; `clickByTestId`'s `el.click()` does not). Two Tabs prove the keyboard is inside new_account before Escape. First Escape → `settleClosedPopup(…, "account-name-input")`, `account-item` hit-testable, `waitForFocus("accounts-popup-new")`, accounts still visible, Tab stays inside accounts. Second Escape → `settleClosedPopup(…, "accounts-popup")`, accounts gone, `waitForFocus("account-avatar-btn")`. No console or page errors.
- `apps/extension/tests/e2e/network/popup-escape-layered.test.ts` (new, `localNetworkExtension`): Settings → Advanced → Account state → Authwits → actions → toggle registry; wait for fee discovery (`send-fee-method-trigger[data-fee-method]` non-empty); `pointerClick` the trigger; first Escape → the menu's items are gone and `tabAround(10)` reaches `registry-toggle-submit` but never the page's `authwits-actions-btn` (containment, not visibility); second Escape → `settleClosedPopup(…, "registry-toggle-submit")`, gone. No transaction.
- `apps/extension/tests/e2e/fixtures/helpers.ts`: `closeStuckPopup`'s comment now says what it does — Escape first (closes a popup that is still open through its trap), then removes leftover popup containers and dimmers; it does not touch the store.

## Gate

| Command | Result |
|---|---|
| `bun run --cwd apps/extension build:chrome` | exit 0 (built after the Phase 1 edits) |
| `bun run test:e2e tests/e2e/popup-stack.test.ts` (apps/extension, Chrome) | 2/2 passed (5.3 s + 3.2 s), exit 0 |
| `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/popup-escape-layered.test.ts` (root) | 1/1 passed (12.6 s), exit 0; sandbox ports released afterwards |
| `bun --bun vitest run scripts/e2e` (apps/extension) | 6 files, 91 tests passed, exit 0 |
| Biome on the three touched test files | exit 0 after one formatter fix (the new test's signature on one line) |
| Firefox: `popup-stack.test.ts` | no `geckodriver` on this host → the PR's `Extension smoke e2e (firefox)` job is the proof; checked at Delivery, where the gate and the goal both require it green |

## Notes

- The layered test logged `the popup's leave transition stuck; finished by hand` — headless Chrome's rAF throttling freezing the `<Transition>` mid-leave, the case `settleClosedPopup` exists for. The store-side close is what the leave class proves.
- `[aztec-node] Error: Address already in use (os error 98)` appeared at sandbox boot but was not fatal: the node listened on its resolved port, the admin port came up, contracts deployed. An auxiliary port inside the node, not one of the resolved ones (none of the five were held by another process after the run).
- Both browser tests fail on the old code by construction: with the old default, the first Escape releases the trap and the popup stays, so `settleClosedPopup` never sees a leave and times out.
- No retries, no failures on this phase.
