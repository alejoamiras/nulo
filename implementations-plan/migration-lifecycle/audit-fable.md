# Fable audit — round 1 (plan review)

Auditor: fable Plan agent, fresh context, source-verified. Verdict: **conditional approve** (5 conditions). Dispositions in plan.md's ledger.

## Adversarial / security
- **HIGH-1 — terminal short-circuit destroys self-heal-on-update.** Today a terminal block heals when an update ships a FIXED migration (engine re-runs every wake; success clears attempts `migrator.ts:176` + blocked `runtime.ts:185`). An engineless terminal rethrow makes terminal permanent — a shipped fix is dead on arrival. Fix: stamp blocked status with engine maxVersion (or manifest version); pre-check treats version mismatch as not-blocked.
- **HIGH-2 — the 30-min backstop still auto-escalates**: 3 autonomous runs ≈ 90 unattended minutes → terminal with zero gestures, contradicting the plan's own success criterion. Fix: runtime-owned `backstopRuns` cap (< final attempt; last attempt gesture-only) — and/or H1 making a reached terminal recoverable on update.
- Pre-check widens nothing (every blocked path still throws pre-registration, `runtime.ts:157-175`). Retry-key abuse bounded (extension-context writers; worst case = today's per-wake behavior). Fail-open read hole bounded (all-reads-failing → engine's own outer catch → retryable needs-recovery WITHOUT a bump — bump needs working I/O). Stale one-shot consumed by an ambient wake: acceptable semantics (one tap = one durable attempt; success heals before return), but terminal branch should also CONSUME a lingering key (hygiene).

## Assumption attack
- Facts confirmed: probe both-reads session (`runtime.ts:340-342`) vs journal in local; wake triggers; resume-success bumps nothing; `clock` in deps; the barrier's raw-storage allowlist is PATH-based so a WRITE passes the ban (`storage-facade-ban.test.ts:18,:30`).
- **FALSE fact — "armed journal ⇒ killed up()" exclusivity.** A same-boot restore-THROW deliberately KEEPS the journal (`migrator.ts:236-241`) — resume-success also follows restore-throw boots, where the counter is `{v,"restore",n}` and an `"up"` bump RESETS it via phase-mismatch (`:358`), wiping accumulated restore failures. Bound still converges; justification must be corrected + pinned (restore-throw → resume-success → counter state), and the `:317-321` stamped-clear path must NOT bump (completed-migration debris, not a failed attempt).
- **Runtime harness half-wrong**: `apps/extension/src/wallet/runtime.test.ts` EXISTS (194 lines) but file-wide `vi.mock("@nulo/wallet-core/migration")` stubs the Migrator — the real-engine pin needs a sibling file (e.g. `runtime.migration-gate.test.ts`) or a restated pin against the `migratorRuns` stub + persisted-status assertions.
- `lastAttemptAt` no-migration claim holds (barrier reads only `.terminal`; blob rewritten whole).

## Implementation critique
- A over B: correct (B falsifies the barrier copy; 3-min alarm math kills pure cool-down). Backstop-inside-A right, modulo the H2 cap.
- `"up"` phase choice: correct; split-counter evasion argument sound; bump-before-clear convention matches `:244-246` (a kill between double-counts conservatively).
- Runtime-layer proof adoption: **legitimate, not a weakening** — the audited invariant is invocation policy, which lives where invocation lives; keep the audit copy RED + PR-body note. Condition: the runtime pin must assert PERSISTED non-terminal status, not only run-count.
- No simpler alternative found; the maxVersion stamp is the one forced addition and is smaller than any alternative terminal-escape hatch.

## Verdict
**conditional approve** — conditions:
1. maxVersion/manifest stamp on blocked status + mismatch-invalidation in the pre-check (terminal never outlives the code that produced it).
2. Cap autonomous backstop runs below the final attempt (`backstopRuns` on the status) — last attempt gesture-only.
3. Correct the exclusivity claim; add the restore-throw→resume-success pin; no bump on the `:317-321` path.
4. Fix the Phase-2 test-home per the existing `vi.mock` constraint (sibling real-engine file).
5. Consume/clear the retry key on the terminal branch too.
