# Arc 21, balance-snapshot: lessons log

## Plan

- **A getter watch source fires on equal values.** Vue 3.5.41 compares a getter's fresh array by identity, so renaming the account (an equal-address object) resets both Home views today. Any shared key function or string key would change which edits reset them, so every watcher stays verbatim.
- **A "pure" predicate can still read differently.** `parseRawBalance` reads properties, so a second parse over a getter row can disagree with the first. The malformed-row predicate takes the parsed value (`isUnknownParsedRow(raw, tb)`), and read counts are pinned with getters.
- **Plan audit:**
  - Codex: REVISE, should-fixes only.
  - Opus: APPROVE with small revisions.

  Every finding, its disposition and both Ask calls are recorded in the batch plan's Plan audit block.

## Build

- **Phase 1 passed on the unchanged code:** TokensView 45 of 45, BalanceView 57 of 57, SelectTokenPopup 14 of 14, and 33 utility tests.
- **Two harness leaks surfaced while writing Phase 1:**
  - Earlier describes leave mounted views whose handlers stay registered on the shared fake events, so an emitted event reached a dead view too. The fake event gained `clear()`, which the new describe's `beforeEach` calls.
  - The harness's shallow `{ ...DEFAULTS }` shares the `network` and `account` objects, so an in-place `chainId` edit leaked into later tests. The `beforeEach` assigns fresh objects.
- **Complexity.** The first composable body scored 23. Three synchronous helpers (`superseded`, `settleRejected`, `land`) brought it under 15 without moving the single `await` or changing the check order.
- **Test-file diff from Phase 1 to head is wider than the plan's pass criterion said.** `token-order.test.ts` changed its import line, not only additions, and the effect tests in all three component suites were strengthened after the mutation run (next section).
- **Mutation checks**, in scratch with each file restored from a copy (never with git). 40 mutants: the first run killed 36 (C20, A12, A4 and A5 survived); the final count is 38 killed and 2 equivalent. The final run, after code review round 1, counts a kill only for a named failed test in vitest's JSON report, and logged 0 errors.

  | Group | Mutants | Result |
  |---|---|---|
  | composable (C1–C19) | scope and generation checks on each path, dirty refetch, dirty cleared after the await, no-address branch, `loaded` survives, retry re-armed, no clear at start, chain id read at landing, connect counter `>= 1`, an `await` before the fences or the landing, update dirty unscoped or replace scope-gated, `dispose` without each step | all killed |
  | C20, A12: the predicate built from `{ account, network }` | in the composable, at the picker | survived, then killed |
  | adoption (A1–A3, A6–A11) | no `scopeFence`, no `mapRow`, dedupe before `markDirty`, every watcher-key edit | all killed |
  | A4, A5: `dispose` after `disconnect()` | each view | equivalent (probe below) |
  | `isActiveScopeRow` (P1–P5) | either arm dropped, `==` per arm, eager network read | all killed |
  | `isUnknownParsedRow` (U1–U3) | `?.` dropped, `&&` for `||`, the aggregate re-parsing | all killed |

  - **C20 and A12 survived because the effect tests only edited `chainId` in place.** A built object reads the `network` property, which only a replacement of the network object triggers. Each effect test now also replaces the network object while a foreign row is in play; the rerun kills both, through the three components' "reads the network only once the account matches" tests.
  - **A4 and A5 are equivalent.** `disconnect()` (`packages/extension-messaging/src/background/client.ts:80-92`) removes the port listeners, rejects pending requests as microtasks and calls `onDisconnected`, which neither view listens to. It never calls `onConnected` or sends a request, so nothing between it and `dispose()` can reach the composable.
- **Gates at `6a0db7de`, and again at the restacked code head `e4b5822d`:** lint, typecheck:all, test:all, test:ci-gating and audit:vue all passed.
- **Screenshots: 64 of 64 identical, base `1a08fa52` vs head `e4b5822d`, and 64 of 64 under `--stability`** (16 surfaces × 2 themes × Chrome and Firefox). Every failed run before that was the surface file, never the code:
  - holdings counted five rows, not six;
  - the Send picker shows its search box past Home's three rows, so the plain-list surface carries three;
  - the token page refreshes its row on mount, and the real service rejects a fixed row's id ("unknown token balance id" page errors), so the spec answers `refreshTokenBalance` too;
  - **the picker is mounted from login** (`PopupManager.vue`), so its price client took its one snapshot before any spec existed. The order then depended on whether a real broadcast happened to land, and a stability run flipped USDC and ALPHA. The surface now broadcasts the token's quote to every live price client when the picker opens, and waits for the priced token to lead. Lesson: a stub keyed on requests misses a long-lived client that already asked; check when the host was mounted.
  - Lock contention: a 10 s retry loop lost the shared harness lock for two hours. Polling the holder's pid every second won it.
- **Shell discipline in an isolated worktree.** The guard refused compound git commands, heredocs, and `sed` with a variable operand; plain single commands, scratch scripts and the Edit tool worked.

## Code review round 1: NOT CONVERGED

- **Codex found no production regression** in 20 base/head probes and held A4/A5 equivalent for these consumers. Three findings, all adopted (detail in the batch plan's Decisions):
  - **The screenshots skipped the retry states.** `home-loading` holds forever and `home-rejected-past-cap` always rejects. Added a pre-cap rejected snapshot and a same-mount rejection that the timed retry recovers. The proxy gained a per-port call log and `seq` rules (each port's nth call gets the nth answer), so each surface asserts that every token-balance port asked exactly twice.
  - **The mutation script counted any nonzero exit as a kill and overwrote its report.** The claimed "38 killed on the first run" was 36. The script now judges from vitest's JSON report (kill = a named failed test; nonzero exit without one = error) and appends to `results.jsonl`. Lesson: a mutation verdict needs the failing test's name on record, or a crash reads as a kill.
  - **Drift 6 is visible**: the list's refresh dot reads `isUpdating`, so it can be wrong until B's own fetch lands. Reworded; no production change.
- **Restacked onto `1a08fa52`** (arcs 10, 12, 15, 11, 19, 22, 19b and 15b landed) without conflict; no manifest changed. With arc 15 landed, `dispose()` now calls `fence.invalidate()`.

## Code review round 2: NOT CONVERGED

- **Codex found the new harness assertions too loose, not the code.** No production regression, and it re-verified every image pair byte for byte.
  - The call check skipped ports with no calls and accepted `[2]`, so it passed with only the hero retrying while the list still awaited its tasks. It now requires the counts to be exactly `[2, 2]`.
  - `!heroLoading` also matches the unknown dash, so the recovery surface would pass a hero that never recovered. It now requires `$10.00`.
  - Lesson: an assertion written as "no wrong value seen" passes when nothing was seen. Name the exact value expected, and prove each check with a negative probe on the wrong state.
- **Evidence:** the two checks live in an import-free block of the surface file, and `scratchpad`'s `probe-r2.ts` runs them alone: 9 of 9 cases as expected (the four wrong port counts and three wrong heroes rejected, the right ones accepted). The three retry surfaces: 12 of 12 identical base vs head, and 12 of 12 under `--stability`.

## Code review round 3: NOT CONVERGED

- **The round-2 loophole lived on in every surface written before it.** `homeLoaded` and `home-empty` accepted the unknown dash, and `token-priced` accepted "0 USDC". Fixing only the named site invited a fourth round, so this one closed the class:
  - every surface's check now pins the fixture's exact state: hero text, summary, row lists, malformed count, and no rows while loading or rejected;
  - one row-set check (`holdings-fiat-off`) is left order-free, because the image compares that order.
- **Probing the real predicates.** Surfaces register their predicate in an exported `wants` map. The probe loads a copy of the surface file with its four imports stubbed, then runs every surface's real check against the fixture's state and against the wrong states a loose check passes: 52 of 52 as expected. Testing a hand copy of a predicate proves the copy, not the check.
- **Evidence:** all 16 surfaces, base vs head 64 of 64 identical and `--stability` 64 of 64. The exact checks passed on the first run, which also confirms the fixture values they name.
