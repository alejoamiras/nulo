# Phase 6 — CI lists and the pool pins

## What landed

- **The three callers.** `pr-extension-network-e2e.yml`, `pr-extension-network-e2e-firefox.yml`, `nightly.yml` (both
  lanes): the canary job's `test_files` is the same four files on both browsers — `transfers`, `tx-sendTx-default`,
  `frozen-account-canary`, `passkey-execution-canary` — and every shard pool's `exclude_files` gains the passkey
  canary. The false Firefox comment ("restarts the service worker, which Firefox has none of") is gone; nightly's
  Firefox-lanes comment says the lists mirror Chrome's exactly.
- **`_extension-network-e2e.yml`.** The run step sets `NULO_E2E_RESULTS_FILE` (`$RUNNER_TEMP/canary-results.json`)
  for a `canary*` label; a new `Assert canary results` step (`always() && !cancelled() && startsWith(shard_label,
  'canary')`) runs `scripts/ci-cd/assert-canary-results.ts <report> <test_files…>`; the zero-proofs check matches
  `canary*` too. The plan's change map put the prefix match on the split path only, while pin (e) asks for "the same
  `canary*` label match as the zero-proofs check" — the pin is the stronger statement, and with one prefix match in
  both steps a future `canary-accounts` job cannot escape either; adopted now, so the split path needs no reusable
  workflow edit.
- **`scripts/ci-cd/assert-canary-results.ts`** + **`canary-expectations.json`**: every listed file present in the
  report, every test in it `passed` (a `skipped`/`todo`/`failed` status is named), every title the expectations name
  for that file reported; an empty file list, a listed file with no entry, and a file reporting no tests fail closed.
  The report names files by absolute path, so a job's `apps/extension`-relative list is matched by suffix.
- **`apps/extension/vite.shared.ts`** `e2eReporters()` adds `["json", { outputFile }]` when `NULO_E2E_RESULTS_FILE`
  is set — vitest's built-in reporter, no dependency; unset, the reporter set is what it was.
- **`scripts/ci-cd/behavior-gating.test.ts`.** `CHROME_ONLY_CANARY` and its two filters are gone — a Firefox lane runs
  exactly its Chrome twin's files. New `describe("canary lanes")` over all four lanes (PR ×2, nightly ×2, a lane being
  one browser's suite jobs in one caller): (a) every `*-canary.test.ts` on disk is in exactly one dedicated job whose
  `proverless` is not `true` and whose `shard_label` starts with `canary`; (b) it is in that lane's pool
  `exclude_files`; (c) the pool's `exclude_files` equals the union of the lane's dedicated lists (this replaces the
  old Chrome-PR-only partition test); (d) every `needs` of the two PR `status` aggregators and nightly's `status` is
  read as `needs.<job>.result` in its script, and every `needs` of `publish-nightly` in its `if`; (e) the reusable
  workflow's results step exists, is keyed on `startsWith(inputs.shard_label, 'canary')`, calls the script, the run
  step's `NULO_E2E_RESULTS_FILE` is keyed the same way, and the presto step matches `canary*`.
- **`CHROME_ONLY.canary`** removed from `fixtures/browser/index.ts`; two reasons remain. Chrome-only files: four → two.
- **`scripts/ci-cd/assert-canary-results.test.ts`** on fixtures captured from real runs (below).

**Found by the new pins, first run:** the Firefox PR file's shard pool did not exclude the passkey canary (its
`exclude_files` was a separate list, not the Chrome twin's) — exactly the drift (b)/(c) exist for; fixed in the same
edit. The twin-shape test caught it too, once the Chrome pool had the file.

## Mutation checks (the pins)

Each applied with `sed` to a backed-up copy, the pins run, the file restored; green again after every restore
(`26 pass, 0 fail`).

| Mutation | Red |
|---|---|
| M1 the passkey canary removed from every `test_files` in nightly (both lanes) | `2 fail` — "runs in one dedicated job" (0 carriers) and the partition |
| M2 the frozen canary dropped from the Chrome PR pool's `exclude_files` | `3 fail` — "is out of the shard pool", the partition, the twin-shape test |
| M3 the Firefox PR canary job given `proverless: true` | `2 fail` — "runs prover-ON", the twin-shape test |
| M4 `needs.network-e2e-canary.result` deleted from the Chrome PR aggregator's loop | `1 fail` — "reads needs.network-e2e-canary.result" |
| M5a the results step's label match narrowed to `== 'canary'` | `1 fail` — pin (e) |
| M5b the results step removed | `1 fail` — "the results step exists" |

## The four-file job, locally, with the report on

Prover-ON, `--retry=0`, alone, `NULO_E2E_RESULTS_FILE` set — the job as every canary lane will run it:

- **Chrome** → `Test Files 4 passed (4)`, `Tests 6 passed (6)`, 0 skipped; vitest `Duration 303.76s` (tests 246.7 s);
  step wall clock (sandbox up → down) **5 min 11 s**; the canaries 58.7 s and 54.0 s. The report: 4 files, 6
  assertions, all `passed`, `numPendingTests 0`, `numTodoTests 0`; `assert-canary-results.ts` on it → exit 0.
- **Firefox** → `Test Files 4 passed (4)`, `Tests 6 passed (6)`, 0 skipped; vitest `Duration 303.28s` (tests 250.7 s);
  step wall clock **5 min 10 s**; the canaries 66.2 s and 62.2 s, `transfers` 95.9 s, `tx-sendTx-default` 26.4 s
  (Chrome: 111.1 s and 22.9 s). The report: 4 files, 6 assertions, all `passed`, `numPendingTests 0`,
  `numTodoTests 0`; `assert-canary-results.ts` on it → exit 0.
- Presto: 22 `/prove` requests, 22 `Proving succeeded`, 0 failures — 11 per browser by timestamp (`transfers`
  proves several sends; the canaries three each; `tx-sendTx-default` one).

Against the CI numbers Phase 5 read (three files on Chrome 5 min 50 s – 7 min 02 s; two on Firefox 4 min 33 s –
5 min 35 s), the four-file job stays far under the 22-minute rule; no split. Read again on the PR (Delivery).

## The results assertion, proven on real reports before it is trusted

The three reports above became `scripts/ci-cd/fixtures/canary-results/{clean-chrome,clean-firefox,skipped-chrome}.json`
(the checkout's path rewritten to `/repo`, pretty-printed; no absolute path survives). The scratch run: `describe.skip`
put on the passkey canary (never committed — the spec was restored from a backup and `git status` is clean),
Chrome, prover-ON, the report on → **the run exited 0**, `↓ passkey-execution-canary.test.ts (2 tests | 2 skipped)`,
`Test Files 1 skipped (1)`, and the report says `success: true` with the file `"status": "passed"` and both
assertions `"skipped"` — the exact hole D16/D19 describe. Against those reports:

- clean Chrome / clean Firefox, the four-file list → `assert-canary-results.ts` exit 0 (`4 file(s) present, every
  test passed`);
- the skipped report, the four-file list → exit 1 naming three files `absent from the report — it never ran` and
  the passkey canary's two tests `skipped` (contract test and canary, by title);
- the clean Chrome report with the canary's assertion deleted and its contract test left `passed` → exit 1:
  `"passkey canary — …" not reported — the canary is gone` (derived in-test);
- an empty file list, a listed file with no expectation, a file reporting no tests → each names its reason.

`scripts/ci-cd/assert-canary-results.test.ts` (10 tests) holds all of that plus the CLI's exit codes and the
expectations-file pins: every expected title appears in its spec's source; every `*-canary.test.ts` on disk and
every file in a canary job's `test_files` (three callers) has an entry; `vite.shared.ts` reads
`NULO_E2E_RESULTS_FILE` and names the `json` reporter.

## Gate

- `cd ROOT && bun run lint` → exit 0; `bun run test:ci-gating` → exit 0 (146 pass, 0 fail — 26 in
  `behavior-gating`, 10 in `assert-canary-results`); `bun run lint:actions` → exit 0.
- `cd EXT && bun run test -- scripts/e2e` → 6 files, 91 tests, green; debt maps unchanged.
