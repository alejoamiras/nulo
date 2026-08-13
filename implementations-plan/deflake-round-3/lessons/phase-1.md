# Phase 1 — the duplicate-aggregator "trap" was a misdiagnosis

## What we believed (round 2, ledgered)

> Opening a PR with `--label`s fires `opened` + one `labeled` per label; the concurrency
> group cancels the duplicates, but their aggregator status jobs (`if: always()`) conclude
> FAILURE on the same head SHA. GitHub resolves required checks latest-per-name, and the
> duplicates' failure check-runs can WIN over the real runs' successes → mergeStateStatus
> BLOCKED with every visible gate green.

Round 2 hit this on #360, #362 and #364 and "fixed" each with an empty commit to get a
fresh head. That is three full CI cycles (quality + smoke + a 25-45 min network suite,
each time) spent on a remedy that was never needed.

## What the measurement shows (P1, PR #367, 2026-08-13)

PR #367 was opened WITH `e2e:smoke`, deliberately manufacturing the burst on unmodified
smoke YAML, and polled continuously from open through survivor completion:

```
21:39:17  mergeStateStatus: <none> -> BLOCKED     (survivors still running)
21:39:39  network-e2e-status|completed|failure    (cancelled duplicate)
21:39:39  network-e2e-status|in_progress          (survivor)
21:40:00  network-e2e-status|completed|success    (survivor)
21:48:59  smoke-e2e-status|completed|success      (survivor)
21:49:09  mergeStateStatus: BLOCKED -> CLEAN      <-- with the duplicate FAILURE still present
21:50:37  ALL-TERMINAL-AND-STABLE merge=CLEAN
```

**The duplicate FAILURE check-run is still on the SHA and the PR is mergeable.** The block
was the ordinary "a required check has not reported success yet" window, not the duplicate.

## Why round 2 got it wrong — the ordering data

Every round-2 "blocked" head carried both conclusions per aggregator name, and in EVERY
case the FAILURE completed minutes BEFORE the SUCCESS (cancelled duplicates die in ~3-5s;
real suites take 6-11 min):

| head | aggregator | failure completed | success completed |
|---|---|---|---|
| `5b692beeab` (#360) | quality-status | 14:49:56 | 14:55:55 |
| `5b692beeab` (#360) | smoke-e2e-status | 14:49:54 | 14:59:50 |
| `5b692beeab` (#360) | network-e2e-status | 14:49:55 | 15:00:54 |
| `a967757f70` (#362) | all three | 16:50:4x | 16:56:51 / 17:00:23 / 17:01:38 |
| `168137549d` (#364) | all three | 18:15:3x | 18:21:29 / 18:25:07 / 18:26:29 |
| `#367` (today) | smoke-e2e-status | 21:39:19 | 21:48:59 → **CLEAN** |

Latest-per-name resolution therefore always resolved to the SUCCESS. The duplicate's
FAILURE could never win: it is always the EARLIER check-run, by construction (a cancelled
run's status job exits within seconds, while the run it duplicates is still executing).
Round 2 observed BLOCKED *during* that window and pushed the remedy before the survivor
landed, so it never learned the state would clear on its own.

A second, independent confirmation of per-SHA association: #360's own remedy head
`6ffa7b306f` ended with all THREE aggregators FAILURE (it was itself push-cancelled by the
next commit) — and #360 merged anyway, on the later head. A stale head's failures do not
follow the branch.

## Disposition (pre-committed decision table, "transient" row)

**Ship 1a only.** `pr-quick.yml` drops `labeled`/`unlabeled`: nothing in that workflow reads
labels, so those deliveries could only duplicate work already done for the SHA, and each
duplicate burns runner minutes and paints a transient red on the PR. Verified live on
#367: `quality-status` has exactly ONE check-run on the head SHA.

**Nothing else ships.** No `cancel-in-progress` expression, no aggregate-status script, no
`actions: read`, no change to how any gate concludes. P2 (queue-replacement) and P3
(per-SHA association) existed to de-risk the `cancel-in-progress` variant; with that
variant unnecessary, P2 is moot and P3 is already answered by the #360 history above.

**The label-gated suites keep both trigger types** — their gates genuinely read labels.
Their duplicates stay harmless-but-noisy; the cheap practice fix (open the PR unlabeled,
then one `gh pr edit --add-label a,b`) is documented rather than enforced.

## Lessons

1. **A remedy that "works" proves nothing when the disease is self-limiting.** The empty
   commit appeared to fix the block every time, which is exactly what a placebo looks like
   against a transient condition. Nothing in round 2 tested the counterfactual.
2. **`mergeStateStatus` is a lagging, composite signal.** Reading it once, while required
   checks are still in flight, cannot distinguish "blocked by a stale failure" from
   "waiting for a real check". The diagnosis needed a TIMELINE, not a sample — the same
   sample-vs-signal error this arc is fixing inside the e2e helpers.
3. **Order matters more than presence.** The whole theory rested on a duplicate FAILURE
   "winning"; one query of `completed_at` would have shown it always loses, because a
   cancelled run's aggregator is always the first to finish.
4. **Prefer the experiment that can refute you.** The pre-committed decision table is what
   made this cheap: the outcome that shipped the LEAST work was written down in advance, so
   finding "your premise is wrong" was a success condition rather than a setback.
