# deflake-round-3 certification campaign (2026-08-14, PR #370)

> **The first campaign below was INVALIDATED by its own success.** After three qualifying
> greens, the next commit's canary run failed with `ensureUnlocked`'s diagnostic — the
> transient window where an unlocked wallet still shows the lock screen because `app.vue`
> routes to `/popup/auth` before bootstrap completes. The predicate handles that state; the
> budget I had preserved (5s, inherited from a question that resolves in milliseconds) did
> not give it time. Fixing it changed a helper the e2e suites depend on, so the three greens
> no longer describe the merged tree, and the campaign was re-run from zero. Recorded rather
> than quietly re-labelled: a certification that survives a change to what it certified is
> worthless.

## Campaign 1 — INVALIDATED (kept as the record)

Rules: e2e-deflake Phase 6 — 3 consecutive empty-commit triggers on the frozen tree, all
three suites green at `run_attempt=1`, zero vitest-retry markers in runtime logs, zero
exit-86 annotations, no wrongly-skipped jobs, each run completing before the next trigger.
Any non-qualifying run resets the count.

| Run | Head | Quality | Smoke | Network | Verdict |
|---|---|---|---|---|---|
| content (not counted) | `6a01b8c7` | pass | pass | **shard 3 red** | pre-existing import-wait lapse (see below) |
| content (not counted) | `b543da18` | pass | pass | pass | clean, incl. shard 3 |
| trigger 1/3 | `3e5ef1be` | 31759081965 ✓ | 31759081806 ✓ | 31759082053 ✓ | **QUALIFYING** |
| trigger 2/3 | `af91d9bf` | 31759683560 ✓ | 31759683555 ✓ | 31759683581 ✓ | **QUALIFYING** |
| trigger 3/3 | `39b9bc15` | 31760262223 ✓ | 31760262285 ✓ | 31760262316 ✓ | **QUALIFYING** |

Zero resets. Every trigger verified with `scripts/ci-cd/verify-cert-run.sh`, which for each
head requires all three workflows present and successful at attempt 1, every workload job
green BY NAME (quality's unit + lint, smoke's test job, the eight network agents), no
failed/cancelled/non-terminal jobs, and no retry or exit-86 markers in any successful job's
runtime log — failing closed if any of that evidence cannot be fetched.

**The labels are load-bearing here.** This PR's diff is scripts + docs, which does not trip
the e2e paths filters, so without `e2e:smoke` + `e2e:network` both suites would have
resolved `run=false` and produced green "passed or was skipped" aggregators. The verifier
refuses that (it demands the workload jobs by name), which is exactly how the gap was found
— the first version of the tool would have certified three runs in which no e2e test
executed.

## The one red, and why it did not reset anything

The first content run's shard 3 failed at `importFullBackup`'s 300s route wait
(`import-drivers.ts:182`, from `backup-restore-sw-restart.test.ts:444`). Content runs are
not counted, so the campaign had not started. It matters for a different reason: this is the
SECOND occurrence of that exact lapse (round 2's #365 content run was the first), it is not
caused by round-3's changes, and it is the recurrence the ledger watch was waiting for. The
item is escalated from deferred to required work for the next arc.
