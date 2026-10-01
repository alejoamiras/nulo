# Phase 4 · C2 · `send-picker` retries

## The change

- `send-picker.test.ts` extends the shared `test` in-file with a file-scoped `altToken` fixture:
  the ALT deploy and its import (`importTokenAndWaitForBalance`, unchanged 90 s budget) leave the
  body, which requests `altToken` beside `tokenReadyExtension`, opens its own popup and runs the
  unchanged assertions.
- **Branch shipped: the fixture, not the fallback**, since it needs no new helper and both probes
  below behave as the runner's code predicts.
- A scratch `tsc` over the file (the e2e tree is outside every typecheck gate) reports only the
  fixture-typing errors every network spec already shows there.
- Ledger row 37's Fix cell records the retry fix.

## Probes (uncommitted; sources in the build's scratch directory)

Three temporary specs, each a copy of the test with counters written to a scratch file, run at
`NULO_E2E_RETRY=1` (Chrome prover-ON, Firefox proverless, as the flake bar runs):

- **fix-body**: the fixed file, throwing once at the top of the first attempt's body, after the
  fixture resolved. Run alone.
- **base-body**: `origin/dev`'s file, throwing once right after its in-body setup (base line 29).
- **setup**: the fixed file, whose fixture throws once after the token import resolved.

base-body and setup ran together in one invocation (each file in its own worker, own wallet); each
file's verdict is read from the run's JSON report.

| Probe | Browser | Exit | Attempts | Deploys | Body runs | Evidence |
|---|---|---|---|---|---|---|
| fix-body | Chrome | 0 | 2: sentinel, then pass | 1 | 2 | rows `["ALT", "TST"]`, no search box; token rows `["TST", "ALT"]`, one ALT |
| base-body | Chrome | 1 (with setup) | 2: sentinel, then fail | 2 | 2 | `expected [ 'ALT', 'ALT', 'TST' ] to deeply equal [ 'ALT', 'TST' ]` |
| setup | Chrome | 1 (with base-body) | 2: sentinel, sentinel | 1 | 0 | one setup run; the retry rethrew the cached rejection |
| fix-body | Firefox | 0 | 2: sentinel, then pass | 1 | 2 | rows `["ALT", "TST"]`, no search box; token rows `["TST", "ALT"]`, one ALT |
| base-body | Firefox | 1 (with setup) | 2: sentinel, then fail | 2 | 2 | `expected [ 'ALT', 'ALT', 'TST' ] to deeply equal [ 'ALT', 'TST' ]` |
| setup | Firefox | 1 (with base-body) | 2: sentinel, sentinel | 1 | 0 | one setup run; the retry rethrew the cached rejection |

A setup failure is therefore red with its own error on every attempt, and no body runs against a
half-imported token. That relies on vitest 4.1.10 keeping a rejected file-scoped setup cached
(`chunk-artifact.js:398-413`). vitest-dev/vitest#11237's fix PR #11238 deletes that cache entry,
so once a release carries it a failed setup re-runs on retry: a setup that failed after its import
would then deploy a second ALT, and the retry would fail on the rows (`['ALT', 'ALT', 'TST']`)
rather than pass. Still red, but with a misleading second error. Recheck this file on that bump.

## Gate

Every run loads P3's fixture change and P4's test file (Chrome's ran before P3's commit and
Firefox's after it; no loaded file changed in between):

- `bun run lint`: exit 0 (29 warnings and 3 infos, all in files this branch does not touch; the
  touched files check clean). `bun run typecheck:all`: exit 0.
- The probes above, on each browser.
- Flake bar, three consecutive runs per browser at retry 0 with
  `NODE_OPTIONS=--dns-result-order=ipv4first`:
  - Chrome, `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/send-picker.test.ts`:
    exit 0 each (114 s, 114 s, 127 s), 1 passed, 0 skipped each.
  - Firefox, `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/send-picker.test.ts`:
    exit 0 each (208 s, 198 s, 222 s), 1 passed, 0 skipped each.
- `bun run e2e:reap`: exit 0, nothing to reap.
