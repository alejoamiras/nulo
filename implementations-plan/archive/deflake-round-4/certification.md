# Certification — deflake-round-4 fix stack

Frozen tree at `b6ff6d88` (stack top `deflake-r4/docs-close`; post-impl codex
audit APPROVED at this exact tree). All runs solo (nothing else local),
`NULO_E2E_RETRY=0`, detached with owned pgids.

## Campaign: 3× consecutive proverless two-file runs

Command per run: `NULO_E2E_PROVERLESS=1 bun run e2e:agent
tests/e2e/network/backup-restore-sw-restart.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts`

| Run | Scenario A | Scenario B | Matrix + contracts | Total verdict |
|---|---|---|---|---|
| 1 | ✓ 53,535ms | ✓ 20,208ms | ✓ | 6/6, attempt-1 |
| 2 | ✓ 53,215ms | ✓ 20,144ms | ✓ | 6/6, attempt-1 |
| 3 | ✓ 53,732ms | ✓ 20,496ms | ✓ | 6/6, attempt-1 |

Zero vitest retries, zero exit-86, zero re-runs in all three ("retry" grep
hits are the scenario-A test NAME only). Scenario A's spread across the
campaign is 517ms — the deterministic rendezvous doing exactly what it was
built for.

## Prover-ON leg

Command: `bun run e2e:agent tests/e2e/network/profile-reimport-matrix.test.ts`
(no PROVERLESS — real bb proving; the crash file is `@requires-proverless`
and runner-refused by design, so the matrix carries the prover-ON coverage of
the shipped fixes per ledger row 14). Result: **3/3 passed** (both matrix
legs + the agent contract).

## Unit + static gates at the frozen tree

`bun run test`: 4318 passed / 2 skipped / 7 todo across 344 files.
`bun run lint`: clean (35 baseline warnings). `bun run typecheck:all`: clean.

## What this certifies

The crash-truth surface is deterministic and green END TO END on the fixed
product: a real mid-restore SW kill rolls back through the liveness gate and
the designed retry converges on-chain (scenario A — green for the first time
in the suite's history); a post-finalize kill retains and recovers (scenario
B — 11 consecutive greens across the arc counting evidence runs); delete +
same-id re-import stays sync-alive through the fence + hardened provisioning
in BOTH proving modes (matrix).
