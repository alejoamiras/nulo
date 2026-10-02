# Phase 2 — seed status surface

**Gate (2026-09-17):** `bun run lint` exit 0 · `bun run typecheck:all` exit 0 · `bun run --cwd apps/extension test src/wallet/services/token src/wallet/runtime` 20 files / 269 tests passed (includes the composition-level "fresh runtime … resumes a due default-token retry exactly once"). Beyond the gate: `bun run --cwd apps/extension test src/wallet src/e2e src/utils` 233 files / 3185 tests passed.

## Inference I5 — verified, with a simpler shape than planned

No alarm listener was added. The journal reaper's periodic alarm already wakes a closed-popup service worker every minute, and every wake boots a fresh runtime, so the hook is one line at the end of `armPostStartWork`: `tokenService.resumeSeeding()`. The continuation is derived from the marker alone (`nextAttemptAt`), so "after a pass" and "in a fresh service worker" are the same code path (`armContinuation`). A stranded retry is bounded by one alarm period. The order pin in `runtime.post-start.pins.test.ts` now ends with `seed:resume`.

## Decisions taken while implementing

- **`nextAttemptAt` is written WITH the attempt, not after the failure.** The plan said "armed only after an attempt that was actually made and failed". Writing it only in the `catch` leaves a hole: a service worker killed mid-preview has `attempts: 1`, no retry time, and nothing to resume from. Recording it next to the attempt counter (same write, before the slow work) closes that. The zero-account pass still writes nothing, so the "no wake loop" property holds.
- **Every pass honors the backoff, not only the timer.** Profile/network/account triggers and `ensureSeeding` skip a seed whose `nextAttemptAt` is in the future. Otherwise a popup reconnecting against a flapping service worker spends the three attempts in seconds. Existing cap tests now move the clock between `run()` calls.
- **A far-future `nextAttemptAt` is ignored, not clamped.** First draft clamped to `now + 60 s` at read time — which is relative to each read and therefore never comes due (caught by its own test). A value beyond the longest delay the seeder writes cannot be the seeder's; it is dropped and the seed is due immediately.
- **`retry` accepts only `failed`.** That single status check subsumes tombstone, seeded, rejected, in-flight (`seeding`) and pending; the reservation covers the window between acceptance and the pass reaching the seed. The `attempting` mark is set synchronously before the attempt write queues on the marker lock, which is what makes "no counter reset after work starts" hold.
- **Two hot-loop guards on the continuation:** no timer without an account (that pass consumes nothing and the entry stays due), and a 1 s floor.
- **A purge re-arms rather than clears** the continuation: the purged scope may not be the active one, and no trigger follows a purge.
- **Tombstones survive corrupt sibling fields** in `parseMarkerEntry` — dropping the entry would resurrect a user-deleted default.
- `TokenSeeder.dispose()` exists because a failed attempt arms a real timer and the unit suites share one fake storage; `seeder.harness.ts` disposes every seeder in `afterEach`.

## Found outside the gate

- `src/e2e/chrome-storage-token-seeds.test.ts` pins the e2e seed shape exactly and is NOT inside the Phase 2 gate paths. `displayName` is now pinned in the reader (`"TestToken"`), and the test asserts storage cannot supply it — it is rendered before the chain answers.

## Open for the owner (goes in the PR body)

- `displayName` literals: `"Clean USDC"` (live-captured name, per the comment in `default-tokens.ts`) and `"Test USDC"` (`apps/tools/public/testnet-bridge.json`) are verified. **`"USD Coin"` for the mainnet bridged USDC is NOT verified** against the chain — the mainnet manifest carries no name field. It is only a pre-load label, but if the chain says otherwise the row text changes when the token lands.
