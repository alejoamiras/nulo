# Phase 1 — the duplicate-aggregator mechanism does not hold up

## What we believed (round 2, ledgered)

> Opening a PR with `--label`s fires `opened` + one `labeled` per label; the concurrency
> group cancels the duplicates, but their aggregator status jobs (`if: always()`) conclude
> FAILURE on the same head SHA. GitHub resolves required checks latest-per-name, and the
> duplicates' failure check-runs can WIN over the real runs' successes → mergeStateStatus
> BLOCKED with every visible gate green.

Round 2 hit BLOCKED on #360, #362 and #364 and cleared each with an empty commit for a
fresh head — three full CI cycles, a 25-45 min network suite among them each time.

## What P1 measured (PR #367, 2026-08-13)

#367 was opened WITH `e2e:smoke`, deliberately manufacturing the burst on unmodified smoke
YAML, then polled continuously from open through survivor completion:

```
21:39:17  mergeStateStatus: <none> -> BLOCKED     (survivors still running)
21:39:39  network-e2e-status|completed|failure    (cancelled duplicate)
21:40:00  network-e2e-status|completed|success    (survivor)
21:48:59  smoke-e2e-status|completed|success      (survivor)
21:49:09  mergeStateStatus: BLOCKED -> CLEAN      <-- duplicate FAILURE still on the SHA
21:50:37  ALL-TERMINAL-AND-STABLE merge=CLEAN
```

**Proven:** a stale duplicate FAILURE, sitting on the same SHA as a later survivor SUCCESS
of the same check name, does not by itself keep a PR unmergeable. That is the entire claim
this experiment supports.

## What the ordering data says about the proposed mechanism

On every round-2 "blocked" head, both conclusions exist per aggregator name, and the
FAILURE completed 6-11 minutes BEFORE the SUCCESS (a cancelled run's status job exits in
~3-5s; the real suites take minutes):

| head | aggregator | failure completed | success completed |
|---|---|---|---|
| `5b692beeab` (#360) | quality-status | 14:49:56 | 14:55:55 |
| `5b692beeab` (#360) | smoke-e2e-status | 14:49:54 | 14:59:50 |
| `5b692beeab` (#360) | network-e2e-status | 14:49:55 | 15:00:54 |
| `a967757f70` (#362) | all three | 16:50:4x | 16:56:51 / 17:00:23 / 17:01:38 |
| `168137549d` (#364) | all three | 18:15:3x | 18:21:29 / 18:25:07 / 18:26:29 |

So the duplicate's FAILURE was always the OLDER check-run, and #367 shows an older FAILURE
losing to a newer SUCCESS. "The duplicate wins latest-per-name resolution" is not supported.

## What is still UNEXPLAINED — do not paper over this

The obvious follow-on story ("round 2 just remedied before the survivor landed") is
**false**. The remedy commits post-date the last survivor success on every PR:

| PR | last survivor success | remedy commit | gap |
|---|---|---|---|
| #360 | 15:00:54Z | 15:04:49Z | +3m55s |
| #362 | 17:01:38Z | 17:05:18Z | +3m40s |
| #364 | 18:26:29Z | 18:27:10Z | +41s |

Round 2 therefore observed BLOCKED after all three aggregators had gone green, and this
arc has no explanation for that. Candidates not ruled out: `mergeStateStatus` recomputation
lag (plausible at +41s, weak at +4m); a different required condition being unsatisfied at
that moment; or an observation error in round 2 (a single `gh pr view` reading, never
re-queried). **The empty-commit remedy is therefore NOT demonstrated to be a placebo — it
is demonstrated to rest on a mechanism that does not hold.** Those are different claims and
the ledger keeps them apart.

Consequence for future sessions: when a PR shows BLOCKED with every gate terminal-green,
**capture the evidence before remedying** — full `/commits/<sha>/check-runs`, repeated
`mergeStateStatus` reads over ≥2 minutes, and `gh api repos/:owner/:repo/branches/<base>/protection`.
Round 2 remedied immediately and round 3 could only reconstruct fragments; a third arc
should not have to.

## Disposition (pre-committed decision table, "transient" row)

**1a ships and nothing else.** `pr-quick.yml` drops `labeled`/`unlabeled`: nothing in that
workflow reads labels, so those deliveries can only duplicate work already done for the
SHA. That justification is independent of the trap question — it removes waste and a
confusing transient red either way. Verified live on #367: `quality-status` has exactly one
check-run on the head SHA where smoke and network each carry the duplicate pair.

No `cancel-in-progress` expression, no aggregate-status script, no `actions: read`, no
change to how any gate concludes — there is no measured problem for them to solve, and
every such design was rejected in plan audit as a potential wrong-ALLOW path. P2
(queue-replacement) is moot; P3 (per-SHA association) is separately confirmed by #360's own
remedy head `6ffa7b306f`, which ended with all three aggregators FAILURE while the PR
merged fine on the later head.

**Known gap this change introduces:** a PR retargeted to `dev`/`main` fires `edited`, not
`opened`/`synchronize`, so `quality-status` can sit at "Expected" forever. A stray label
event used to be an accidental recovery. Adding `edited` to the triggers is NOT a safe fix:
its payload cannot be filtered at the trigger level, and a title edit would run the
aggregator over skipped needs and post a green `quality-status` that tested nothing. The
recovery is `gh workflow run pr-quick.yml --ref <branch>`; ledgered as an OPEN CI item.

## Lessons

1. **A self-limiting condition and a real one look identical through a single sample.** The
   whole round-2 diagnosis, and then my first draft of this write-up, rested on one
   `mergeStateStatus` read. The fix for that is a timeline, not a better guess — the same
   sample-vs-signal error this arc is fixing inside the e2e helpers.
2. **Check the timestamps before asserting causality.** "The duplicate wins" survived a
   whole arc because nobody queried `completed_at`; "they remedied too early" survived
   half a day of this one because I didn't query the commit times. One API call killed each.
3. **Preserve the evidence before applying the remedy.** Both arcs destroyed the state they
   were diagnosing by pushing a fresh head. The remedy is cheap; the observation is not.
4. **Write down the outcome that ships the least, in advance.** The pre-committed decision
   table made "your premise is wrong" a success condition rather than a setback, and kept a
   falsified premise from turning into shipped complexity.
