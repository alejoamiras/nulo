# P4 — smoke + polish + gates (lessons)

## 2026-06-09 — P4 COMPLETE
- `tests/e2e/bridge-smoke.test.ts` (jsdom, real journal engine + real localStorage, fake chain deps, testid-only selectors): legacy keys deleted on init; persisted records render as cards with NOTHING auto-claiming (`resumeSessionWork` fired against rediscovered records ⇒ zero claim/sign calls); an explicit CLAIM drives the record to done THROUGH the engine — which required the fake to flip its simulate to message-gone after send, because the tx-identity probe correctly refuses `done` while the message still simulates claimable (the anti-spoof check caught my own lazy fake — good sign); the form flip swaps `data-chain`.
- Logging sweep: no secret/envelope/signature material in any log call (one benign copy-string hit).
- Gates: `bun run audit:faucet` exit=0 · `bun run audit:vue` exit=0 (both in the transcript).

LESSONS_FILE=implementations-plan/bridge-ux-trust/lessons/phase-4.md
