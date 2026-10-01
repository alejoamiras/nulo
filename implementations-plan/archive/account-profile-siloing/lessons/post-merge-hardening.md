# Lessons — post-merge hardening (`fix/siloing-hardening`)

## The 7-run e2e flake hunt (baseline card-count in the isolation gate)

`account-switch-isolation` failed at the step-4 baseline (`expected 0 to be >= 1`) 5 times across 7 runs
on this branch while passing 2/2 on the dev tree. The path to the real cause, with the wrong turns kept:

1. **Wrong turn 1 — load-flake theory.** First 3 failures all ran concurrently with a codex xhigh session
   (CPU pegged); passes sat on either side. Plausible, matched the harness's documented failure mode —
   and wrong: run 5 failed fully idle.
2. **Wrong turn 2 — the "instrumented pass" wasn't.** The test file was reverted while run 4's sandbox was
   still building; vitest read the clean file. Conclusion drawn from that run was worthless. Verify WHAT
   actually executed before reasoning from a run.
3. **Wrong turn 3 — suppression-regression theory.** The branch's dedupe scoping change (fix 3) was the only
   runtime diff on the feed path; a third `public-event` record in the samples looked like a suppression
   miss. It was the fixture's own PUBLIC mint — a genuine record that exists on dev too.
4. **Instrumentation done right (attempts 3):** inline sampling between selector-wait and assertion HEALED
   the race (15s delay → pass); vitest swallows console output for PASSING tests, so passing runs yielded
   zero data. Final shape: background sampler at ORIGINAL assertion timing, `appendFileSync` to a tmp file.
5. **The data:** records stable, BOTH DOM counts stable at every 250ms sample — while an instant `page.$$`
   read 0 between two samples. The incoming list re-renders by array replacement; the instant read landed
   inside a sub-frame child swap. Product invariant intact; test assertion over-strict.

**Fix:** the two POSITIVE count assertions poll (`waitForFunction`); containment ZERO-counts stay instant
(a dip cannot false-fail a zero; the MutationObserver catches flashes). Never neutralized — re-shaped to
assert the actual product promise.

## Codex loop shape (what the rounds found — full ledger in plan §19)

Round-1 findings were product bugs; round-4's tail was triple-coincidence stale-row races. The severity
gradient is the stopping signal: when findings need multiple coincidences AND cannot produce a wrong
signature / cross-profile render / fund loss, record them (plan §19) instead of building. Design-first
(propose invariant + mechanism to the reviewer BEFORE coding) was adopted after round 2 for
concurrency-shaped fixes — it converted implement-review cycles into one design round + one verify round.
