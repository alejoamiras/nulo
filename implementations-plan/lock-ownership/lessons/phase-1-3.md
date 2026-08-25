# Implementation lessons — lock-ownership (phases 1-3 + post-impl)

- **The compiler is the cheapest caller-auditor**: making `leave(ticket)` mandatory let `typecheck:all` machine-verify recon's "zero raw callers" claim across every package in one run — no grep sweep needed. The runbook's "audit split enter()/leave() callers" resolved to: none exist (the one split site is `ReadWriteGuard` in pxe, verified already-safe by recon).
- **The gate's rejection-branch spec matched code that already existed**: codex's round-3 "compensate → read-back → confirmed/unconfirmable" branch turned out to be `open()`'s EXISTING structure (B-01 memory-first + the indeterminate-write compensation). The fence wrapped it; the bump-last landed after the schedule. Lesson: when an auditor derives a contract from first principles and the codebase already implements it, that convergence is strong evidence both are right.
- **Revert-probing is now standard practice** (batch-3's lesson operationalized): five probes during implementation (fence bump + identity guard; N-17 both sites; plus the reviewer's own eight). The independent max review STILL found a silently-revertible mechanism — bump-last — because both rejection tests omitted the pending-close leg the plan specified. The discriminator needed the exact production shape (a close whose head predates the open, queued behind it via the lock-emit listener reentrancy). Fixed + probed red in `35e9478e`.
- **Fake-timer composition works in the scenarios harness**: the composed N-17 pins drive the REAL serviceLock watchdog handoff (5-min advance) against a parked deferred PXE await with the queued deletion — the exact production hazard, deterministic, no sleeps.

## Independent max review (Fable agent, 8 revert-probes): REQUEST-CHANGES → all six addressed

Implementation verdict: "correct, complete against the plan's mechanics"; findings were tests/docs only: (1) bump-last unpinned [the big one — see above]; (2) fence ordering 7 missing (park at wrapPair, close completes, B lands); (3) backfill re-check unpinned (probed red after adding the backfill composed pin); (4) doc sweep 2/3 undone (purge-rows.ts — the plan's path was wrong, it lives at services/purge-rows.ts — two profile/service comment frames, ARCHITECTURE.md's wrong-path + never-existed `MAX_HOLD_MS` static); (5) `LockTicket` unbranded (now `symbol & brand` — bare symbols no longer typecheck); (6) the two load-bearing `maxHoldMs: null` constructions comment-guarded only (config pins added for the network lock + artifact mutex).

Codex final-diff sign-off pending (resumed gate session).

## Codex final-diff loop (resumed gate session): REQUEST-CHANGES → APPROVE

Round 1 (post-review-hardening diff): one technical catch — the `LockTicket` brand's OPTIONAL property was vacuous (a bare `symbol` still assigned; the documented compile-time guarantee was false). Verified everything else clean: no missed runtime interleaving (close-before-open, onChange-queued close, bump-last, both rejection branches, double-close, arbitrary force-release chains), review commit confirmed runtime-inert. Fixed in `dfc6dcc9`: required brand member, single trusted mint-site cast, `@ts-expect-error` compile pin, repo-wide typecheck green; plus the stale plan §Security artifact-watchdog line. Round 2: **APPROVE** ("ready for PR, subject to the stated green battery").

Consult tally for batch 4: plan gate 3 rounds (dual audit + final pass, 12 findings adopted, 1 disagreement resolved unanimously) + final-diff 2 rounds (1 finding adopted) — all in session `01a0377c-e5b7-7eb0-8fdc-404326250345` post-gate; zero unresolved disagreements.

## Network mass-fail: self-inflicted contention (2026-08-25)

First network run mass-failed 10+ unrelated specs, all `localhost:8080 unreachable` (sandbox death mid-suite). Root cause: I launched the standalone final-tree `audit:vue` IN PARALLEL with the battery's network stage — violating the suite-runs-alone rule for exactly the load class the repo memory warns about. The batch-3 gate-narrowing lesson (unit-vitest load is tolerable) does NOT extend to audit:vue's typecheck∥units∥lint∥build burst against a live sandbox. Re-run solo. Durable rule: the network stage shares the host with NOTHING I launch, including my own audits — sequence them.
