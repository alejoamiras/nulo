# PR-5 certification campaign (2026-08-13, PR #365)

Rules: e2e-deflake Phase 6 — 3 consecutive empty-commit triggers on the frozen tree, all
three suites green at run_attempt=1, zero vitest-retry markers in runtime logs, zero
exit-86/infra-reboot annotations, no wrongly-skipped jobs (all 8 network agents ran), each
run completing before the next trigger; any non-qualifying run resets the count.

| Run | Head | Quality | Smoke | Network | Verdict |
|---|---|---|---|---|---|
| content (not counted) | 08ceef45 | pass | pass | shard-3 red | flake (see below) |
| trigger 1/3 | ba33d81b | 31736439686 ✓ | 31736439758 ✓ | 31736439716 ✓ | QUALIFYING |
| trigger 2/3 | b164b56e | 31737356073 ✓ | 31737356119 ✓ | 31737356062 ✓ | QUALIFYING |
| trigger 3/3 | c6ce1264 | ✓ | 31738289732 ✓ | 31738289764 ✓ | QUALIFYING |

All verified with the scripted checker (per-run: status+conclusion+attempt via the runs
API, per-job conclusions, runtime-log greps for `(retry x` and exit-86 warnings, network
agent-count ≥ 8). Zero resets — first campaign attempt certified.

## Content-run red (not counted, triaged anyway)

`backup-restore-sw-restart` (shard 3, run 31734785738): the designed-retry re-import's
`waitForHash` 300s lapsed on a runner that had already fired the test's own slow-runner
marker ("post-kill fork unobserved in 45s"). Every parallel import-path test on the same
head was green (smoke import-paths + backup-migration; network backup-restore-integrity +
backup-migration-roundtrip). Classified slow-runner flake — ledgered as an OPEN watch with
the causal-signal prescription if it recurs. The trigger-1 fresh head doubled as the
flake re-check (green ×3 after).

## Duplicate-aggregator trap, observed shape this arc

At labeled-PR OPEN the `opened`+`labeled` double event spawned FIVE run sets (1 genuine +
4 concurrency-cancelled); the cancelled sets' aggregators report FAILURE and initially win
gh's latest-per-name check view. Push triggers fire single events — every subsequent head
had exactly one run set. The merge-time remedy (empty-commit fresh head) was never needed
this time because certification triggers ARE fresh heads.
