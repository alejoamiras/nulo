# Certification — import-stage-deadlines (Phase 6)

**PASSED 2026-08-18** — 3× consecutive solo runs, all attempt-1 green.

## Protocol

`NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent
tests/e2e/network/backup-restore-sw-restart.test.ts
tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts`
— tmux, nothing else local, `apps/**` tree frozen across all three runs
(every code commit predates run 1; only run-log/doc reads between runs).

## Results

| Run | Exit | Files | Tests | Wall |
|---|---|---|---|---|
| 1 | 0 | 3/3 passed | 8/8 passed | ~12 min |
| 2 | 0 | 3/3 passed | 8/8 passed | ~3.6 min |
| 3 | 0 | 3/3 passed | 8/8 passed | ~3.9 min |

Zero retries (retry=0 enforced — an attempt-2 pass is impossible by
construction), zero exit-86, zero non-zero exits. The reshaped stage-aware
wait ran inside every import in all three runs; its prover-ON coverage
comes from Phases 2–3's five prover-ON campaign runs (certification is
proverless because the crash file is proverless-only by runner refusal).

## Mechanical no-timeout-change record

Enumerated every numeric literal in `git diff origin/dev...HEAD --
'apps/extension/tests/**'`:

- The ONLY production `300_000` change: the same value wrapped in
  `withTimeoutMessage` (`import-drivers.ts` — value unchanged, hardcoded;
  the two other `+300_000` are unit-test fixture constants).
- `import-drivers.ts`: net-ZERO timeout-literal additions/removals (the
  submit-half extraction kept every `10_000` selector timeout in place).
- `crash-truth.ts`: four `10_000` REMOVALS — the dedup delegation to the
  shared submit half (no effective-behavior change; the shared half carries
  the same values).
- All other new numerics: probe sleeps/poll steps (new code, not bounds on
  existing waits), unit-test fixture timestamps, and a ms/s display
  threshold.

**No existing timeout increased; `300_000` remains the only import
success-wait ceiling.**
