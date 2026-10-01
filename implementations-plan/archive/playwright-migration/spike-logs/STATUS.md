# Spike status board — Puppeteer → Playwright?

> FINAL (post split-batch + codex review). Last updated: 2026-05-17 18:42
>
> Full writeup: `../spike-results.md`

## DECISION (unchanged through all corrections): PARK THE MIGRATION

The migration's flake-fix justification doesn't hold. Whether it's worth
porting for H2 (helper-LOC reduction) is still open — not tested in this
spike.

## What we learned — DIAGNOSIS SHIFTED after split-batch

```
  v1 read (before codex):   Theory 3 wins — Aztec accumulation
  v2 read (after codex):    Shared-run infra; Aztec leading candidate
  v3 read (after split):    Popup-discovery latency variance is the
                            best fit. Accumulation is at most secondary.

  Why the shift?
  Split-batch ran the late-half tests on a FRESH sandbox.
  Prediction (if accumulation): late-run victims now pass → 0-1 failures
  Actual:                       3 NEW failures (DISJOINT from baseline late-half)
                                Baseline's 2 late-half failures DID pass fresh
  Net: fresh sandbox still produces ~similar-rate failures with
       completely different victims. Not a clean accumulation story.
```

## Progress

```
[✓] PHASE 1  Pre-flight                                          5min
[✓] PHASE 2  Baseline (54/61 pass)                              12min
[✓] PHASE 3  Isolate suspects                                    1min
[✓] PHASE 4  Pre-experiment sanity check                         2min
[✓] PHASE 5  Scope-flip experiment    ★ falsified H1            13min
[✓] PHASE 6  pool=forks experiment    ★ falsified H2            13min
[✓] PHASE 7  First aggregate + decide                            5min
[✓] PHASE 7.5 Codex review of spike                              5min
[✓] PHASE 7.6 Apply codex factual corrections                    3min
[✓] PHASE 7.7 Split-batch experiment  ★ weakened Theory 3        5min
[✓] PHASE 7.8 Revised interpretation in spike-results.md         3min
[ ] PHASE 8  Final summary + commit                            (next)
```

## All 4 runs

| Metric                    | Baseline    | Scope-flip   | pool=forks  | Split-batch |
|---------------------------|-------------|--------------|-------------|-------------|
| Test files                | 45          | 45           | 45          | 23 (late ½) |
| Tests passed / total      | 54/61 (89%) | 54/61 (89%)  | 51/61 (84%) | 18/23 (78%) |
| Failures                  | 5           | 5            | 8           | 3           |
| Wall-clock                | 745s        | 764s         | 795s        | 265s        |
| Same failures as baseline?| —           | NO (shifted) | NO (mostly) | NO (entirely shifted) |
| Fresh sandbox?            | yes         | yes          | yes         | yes         |

17 unique tests in the failure roulette across all 4 runs. Failure sets
have very small intersection.

## The expanded smoking gun

```
                                       Base   Scope   pool   Split-batch
                                       line   flip    forks  (positions 23-45)
authwit-variants                       FAIL   pass    pass   not in batch
data-addressBook                       FAIL   pass    pass   pass
meta-getAccounts-pregrant              FAIL   pass    FAIL   pass
meta-getChainInfo                      FAIL   pass    pass   not in batch
multi-account-from                     FAIL   pass    pass   not in batch
─────────────────────────────────────────────────────────────────────
fee-methods · transfer public FJ       pass   FAIL    FAIL   not in batch
fee-methods · transfer private FJ      pass   FAIL    FAIL   not in batch
fee-methods · gas balance non-zero FJ  pass   FAIL    FAIL   not in batch
meta-getAccounts (non-pregrant)        pass   FAIL    pass   pass
tx-sendTx-multicall-chunked            pass   FAIL    pass   not in batch
─────────────────────────────────────────────────────────────────────
tx-sendTx-multicall                    pass   pass    FAIL   not in batch
tx-sendTx-sponsoredFpc                 pass   pass    FAIL   not in batch
contracts-register                     pass   pass    FAIL   pass
contacts-sender · flip OFF migration   pass   pass    FAIL   not in batch
─────────────────────────────────────────────────────────────────────
batch-mixed                            pass   pass    pass   FAIL
cap-request-rerequest                  pass   pass    pass   FAIL
wallet-locked-mid-session              pass   pass    pass   FAIL
```

17 distinct tests have failed at least once across these 4 runs.
The set of failures is essentially noise on top of an underlying
~5-15% failure rate on popup waits.

## What the data ACTUALLY supports

```
SUPPORTED                                NOT SUPPORTED
─────────────────────────────            ─────────────────────────────
• Failures are popup-timeout-shaped      • "Aztec sandbox state piles up"
  (15s and 22s waits)                    • "Fork-per-file fixes it"
• Migration wouldn't help                • "Browser state piles up"
• 15s timeout catches a wide             • "5-failure load budget"
  latency-variance tail                  • "Theory 3 wins by elimination"
• The popup-discovery flow has
  high-enough latency variance to
  brush against the timeouts
```

## Final recommendation

1. **Park the migration as a flake fix.** Theory-1 and Theory-2 fixes
   don't help; runtime swap won't either. This is the decisive call.

2. **H2 (helper-LOC reduction) is still open.** If you want to know
   whether Playwright's auto-wait APIs save meaningful LOC vs the
   ~315 LOC of CDP workarounds in extension.ts:590-905, port ONE
   smoke test and measure. Cost ~1-2h. Decision: keep H2 closed
   OR revive the migration plan with a new primary hypothesis.

3. **The actual reliability fix is in the wallet/extension's
   popup-discovery flow**, not the test infrastructure. Profile
   the discover/verify/capabilities popup paths under sandbox load
   to find what's slow.

4. **Short-term mitigation:** selectively bump the 15s `waitForPopup`
   timeout to 20-25s on the files that exhibit load-shaped failures.
   Reversible. Goalpost-moving, but cheap.

5. **CI is fine as is.** Hosted CI runs fresh containers per job —
   the local cumulative-load phenomenon doesn't reach CI.

## Edits applied during the spike (all reverted)

```
- packages/extension/tests/e2e/fixtures/extension.ts
    (scope flip on dappConnectedExtension)                        REVERTED
- packages/extension/vitest.e2e.network.config.ts
    (pool: forks + isolate)                                       REVERTED
```

Source tree clean vs dev. Only the `implementations-plan/playwright-migration/`
directory is added (plans + analysis + status).

## What's in this directory after commit

```
implementations-plan/playwright-migration/
├── plan.md                  ← original migration plan (PARKED at top)
├── claude-plan.md           ← Claude's initial independent plan
├── agent-plan.md            ← subagent's initial independent plan
├── pre-flight-findings.md   ← phase 0 read of triage plan
├── spike-results.md         ← final evidence + interpretation
└── spike-logs/
    ├── STATUS.md            ← this file
    ├── scope-flip.diff.md   ← edit applied + reverted in run 2
    └── pool-forks.diff.md   ← edit applied + reverted in run 3
```

Raw `*.log` files (baseline.log, scope-flip.log, pool-forks.log,
split-batch-late.log, victims-isolated.log) are gitignored. The
analysis docs cite the key data from them; to regenerate logs, re-run
the experiments per the diff files.

## Codex sessions

- v2 plan review: `019e3796-57bf-75d1-a7c1-72248bcc1332`
- Spike review: `019e37d5-3049-7602-a1c5-17f7b9b6b0dc`

## Total spike time

~60 minutes (vs 4–6h budget). All 4 runs, both codex sessions, and
2 writeups (spike-results.md + STATUS.md).
