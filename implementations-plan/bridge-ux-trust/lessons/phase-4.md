# P4 — smoke + polish + gates (lessons)

## 2026-06-09 — P4 COMPLETE
- `tests/e2e/bridge-smoke.test.ts` (jsdom, real journal engine + real localStorage, fake chain deps, testid-only selectors): legacy keys deleted on init; persisted records render as cards with NOTHING auto-claiming (`resumeSessionWork` fired against rediscovered records ⇒ zero claim/sign calls); an explicit CLAIM drives the record to done THROUGH the engine — which required the fake to flip its simulate to message-gone after send, because the tx-identity probe correctly refuses `done` while the message still simulates claimable (the anti-spoof check caught my own lazy fake — good sign); the form flip swaps `data-chain`.
- Logging sweep: no secret/envelope/signature material in any log call (one benign copy-string hit).
- Gates: `bun run audit:faucet` exit=0 · `bun run audit:vue` exit=0 (both in the transcript).

## 2026-06-09 — post-impl: /code-review max --fix (separate commit `4656f8f`)
Max-effort self-review of the net diff found 3 real correctness bugs, fixed + pinned:
1. `deploymentMatches` skipped `chainId` (the L4 contract says chainId+portal+bridge).
2. Wallet-reconnect mid-deposit race: `resumeSessionWork` → `runDepositClaim` on a sessionLive record with NO `leafIndex` ⇒ gate-polls on leaf 0 holding the record lock ⇒ the flow's own claim later skipped as a duplicate (claim starved). Fixed with a leafIndex bail in `runDepositClaim`.
3. The same sweep tagged a LIVE provisional withdraw (mid-exit-prompt) `unknown-outcome`. Fixed: the sweep skips mid-flight records (no-leaf deposits, provisional withdraws).
Tests 174 + smoke 9 green after the fixes.

## 2026-06-09 — codex post-impl audit
Verdict: PENDING (running; folded on completion below).

LESSONS_FILE=implementations-plan/bridge-ux-trust/lessons/phase-4.md
