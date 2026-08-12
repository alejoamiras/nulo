# Codex iteration loop — consult log (post-implementation, pre-PR)

## Round 1 (2026-08-12, gpt-5.6-sol xhigh, fresh, full diff origin/dev...HEAD)

**Verdict: iterate** (0 Critical, 1 High, 4 Medium, 2 Low). All folded same-session:

| # | Finding | Disposition |
|---|---|---|
| H1 | Balance write TOCTOU: queue's re-read→write window could resurrect a row deleted mid-sync | **FOLDED** — deletion fence (`invalidatedBalanceIds`): ids added BEFORE every awaited `repo.delete`, checked SYNCHRONOUSLY before both queue writes (no await between check and dispatch — single-threaded ordering makes write-after-delete impossible); released on id reuse in `createTokenBalance`. Two interleaving pins added. |
| M1 | Absolute deadline exceeded page-side (forced 100ms attempts, +1s/+2s race graces, service clock after init) | **FOLDED** — preflight skips attempts under 100ms remaining, races at the exact budget; registration races at the exact remainder; service computes `deadlineAt` BEFORE `ensureInitialized`. Timing pin updated ([5000,5000,5000]). |
| M2 | Collector throws on non-object result entries post-finalize | **FOLDED** — object guard; `[null, undefined, 42]` collapses into ONE constant record; test added. |
| M3 | `networks` argument un-validated at the trust boundary | **FOLDED** — array-required, 64-cap, `NetworkSchema.safeParse` filter; invalid entries behave as absent networks. |
| M4 | Marker deletion ordered before session close + pending-secret zeroization in `deleteProfile` | **FOLDED** — marker delete moved to the fallible tail (after close + zeroize); a failure leaves the tombstone for crash-resume. Rejecting-remove pin added (session closed anyway). |
| M5 | Smoke test's two waits not one true 90s deadline | **FOLDED** — `routeRemainder()` throws on exhaustion and feeds BOTH waits the remainder of `submittedAt + 90_000` (literal unchanged; only ever TIGHTER). |
| L1 | Imported `syncFailure.message` unbounded at the schema | **FOLDED** — schema-level truncate-not-reject transform (200 chars). |
| L2 | Rehydration accepted a generation-mismatched marker without purging | **FOLDED** — best-effort purge on the silent path too; restart pin added (session survives + marker gone). |

Round-1 "looks right" confirmations covered every prior audit condition (probe abort, caps,
per-launch deadline, marker bracket, settled race, zeroization, testids, e2e stubs).

## Round 2

*(pending — resumed session on the folds)*
