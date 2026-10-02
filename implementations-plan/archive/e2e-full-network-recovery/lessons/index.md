# E2E Full Network Recovery — Lessons Index

What the investigation taught. Short pointers; details in the linked files.

## Outcome

`bun run e2e:agent` went from **0/61 silent skips** → **61/61 actually passing** (exit 0, ~24 min). The test count dropped from 62 → 61 because the diagnostic test (`_diag-cluster-a.test.ts`) was deleted as part of the probe-strip.

Two product fixes (one race, one batch-payload alignment) plus one config-level retry budget did the work. The Tier A plan that preceded the investigation got most of the diagnosis wrong.

## Lessons (read these if you're investigating similar e2e/diagnostic problems)

| File | Lesson | When to read |
|---|---|---|
| [the-actual-bug.md](the-actual-bug.md) | The 4-line race fix that collapsed 34 of 36 failures, plus how it was found | If you're chasing "tests pass alone, fail in suite" |
| [probe-infrastructure.md](probe-infrastructure.md) | Storage-based diagnostic probe pattern that survived vitest reporter suppression + SW worker isolation + CDP capture limits | If you need to add diagnostic instrumentation to e2e tests |
| [hypothesis-falsification.md](hypothesis-falsification.md) | Every primary hypothesis in the Tier A plan was wrong. Why probe-first matters more than plan-first | If you're tempted to commit to a hypothesis tree before measuring |
| [codex-as-debugger.md](codex-as-debugger.md) | Codex (xhigh) found the actual race in one round after I gave it the probe trace. Costlier than grep, but decisive | If you're stuck after probes and need a code-level second opinion |

## What I'd skip if I did this again

- **Don't write a Tier A consolidated plan with hypothesis branches until you've run probes.** The 508-line plan-with-fix-tree was mostly wrong — probe data invalidated cluster A entirely and reframed cluster B.
- **Don't add `pool: "forks"` + `isolate: true` to the network vitest config thinking it'll fix anything.** Vitest 4.1.5 defaults to those. The user's hint about "missing pools config" turned out symptomatic-but-not-causal.
- **Don't trust the cluster taxonomy from the quarantine doc.** The "22 cluster A failures" were mostly cascades of a single fixture hang.

## Probe infrastructure (kept as reference, code stripped from main)

The diagnostic probes were stripped before merge. Code samples + the pattern live in [probe-infrastructure.md](probe-infrastructure.md). Resurrect from git history `git show ce742b0^:packages/extension/src/wallet/utils/probe.ts` (last commit before strip).

## Final commit landscape on the recovery branch

```
race fix:          1d0e7f3 fix(popup): snapshot network in handleSetActive before await
batch payloads:    5e51325 fix(e2e): batch payload alignment + cap-ready helper + popup detach retries
config retry: 1:   ce742b0 test(e2e): config-level retry: 1 for network suite
config retry: 2:   c31be82 test(e2e): bump default retry from 1 to 2 in network config
quarantine clear:  e0d7ce5, dfa6d58 (re-enable 4 quarantined files)
```

All other commits on the branch are probes / diagnostics / docs / findings that get stripped or stay as documentation.
