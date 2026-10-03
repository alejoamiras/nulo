# Arc 22b, history-incoming-guard: lessons log

## Reachability

- **The guard cannot fire today.** History's incoming list comes from a profile-equality repository query. An update is admitted only on a matching profile, and a `flush: "sync"` watcher empties the list on any change of profile, network or account. `profileId` is a required string on every record, and an empty active profile id makes the composable read nothing. So the fix is invisible by construction, and only the unit test can show it firing.
- **Fold, don't add.** Home already ran `isForeignProfile` right after `incomingInScope`. Moving the check into `incomingInScope` gave History the guard and kept Home's reads exactly, so the shared helper stayed one sequence instead of two.

## Plan audit

- **Codex (GPT-6 Astra, xhigh), the only leg at LIGHT tier, returned REVISE.** It found no reachability blocker and confirmed the route-2 claim. Both findings were about tests, and both were adopted:
  - the block-time read-order row must gain `profileId` too, or Phase 2 stays red;
  - three mutants survived the first test plan (`scope.profileId && …`, `scope.profileId || undefined`, `inc.profileId || undefined`). An unknown-scope read trace and two empty-id rows kill them.
- `isForeignProfile` takes both ids as arguments, so a row's `profileId` is read even under an unknown scope. The unknown-scope read trace pins that, and so kills the `scope.profileId &&` short-circuit.

## Build

- **Phase 1** (`e043f20b`, test only): 3 of 22 tests in `activity-rows.test.ts` red on `6fd533a0` (the inverted pin, the empty-id rows, the read-order rows); the new unknown-profile row green. `recent-activity-rows.test.ts` was not edited.
- **Phase 2** (`456b747f`): 38 of 38 green across both row files, plus `activity.test.ts`. No test file changed.
- **Mutants**, applied from a script that restored each file from a scratch copy: all 9 killed.

| # | mutant | killing tests |
|--:|---|---|
| 1 | guard removed | History's inverted pin, empty-id and read-order rows; Home's known-scope profile and read-order rows |
| 2 | `inc.networkId` compared | the kept controls on both feeds, plus the ordering tests that seed incoming rows |
| 3 | `scope.accountAddress` compared | as 2, plus History's merge and scoping rows |
| 4 | profile check before account | both read-order rows |
| 5 | Home keeps its inline guard too | Home's read-order row |
| 6 | guard negated | 17 rows across both files |
| 7 | `scope.profileId && …` | History's empty-id row and unknown-scope read trace |
| 8 | `scope.profileId \|\| undefined` | History's empty-id row |
| 9 | `inc.profileId \|\| undefined` | History's empty-id row |

- **Gates** at `456b747f`: lint, typecheck:all, test:all, test:ci-gating and audit:vue all green.

## Tooling

- **`resume-codex.sh`'s third argument is the codex dir, not the cwd.** Passing the worktree made it write `response-1.md`, `log.jsonl`, `followup-1.md`, `session_id`, `model` and `codex_home` into the worktree root. They were moved out and never committed. Pass the `CODEX_DIR` that `run-codex.sh` printed.

## Code review, Codex round 1: CONVERGED

No material finding. Codex reproduced the three base failures and all nine kills in memory, and saw Home's Vue dependency traces unchanged. Two nits:

1. **Adopted:** `incomingRows`' comment repeated `incomingInScope`'s contract and was deleted. Home's helper TSDoc now states the one invariant its order protects: the token check first, so another token's receipt never has its scope fields read (`82dcb85d`).
2. **Not adopted:** shortening the scope comments in `RecentActivityView.vue` (:108) and `activity.vue` (:104). They predate this arc and are no less accurate after it. Rewriting them would touch two `.vue` files in a route-2 arc for no behaviour.

## Code review, Codex round 2: CONVERGED

No findings. The rewritten comment states the ordering invariant accurately, runtime code and tests are unchanged since round 1, and leaving the older `.vue` comments alone is reasonable.

- **Gates** at `82dcb85d` (the code head): all five green.

- **Shots** at the code head `82dcb85d` against base `6fd533a0`: 68 of 68 identical (44 shots and 24 style probes). The `--stability` run was 68 of 68 identical too. The lock was contended for about an hour.
