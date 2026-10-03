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
- **Mutation checks**, in scratch with each file restored from a copy (never with git). 40 mutants; 38 killed on the first run.

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
- **Gates at `6a0db7de`:** lint, typecheck:all, test:all, test:ci-gating and audit:vue all passed.
- **Screenshots: not yet captured.**
  - Two base runs on Chrome staged the Home and token surfaces, then failed on the surface file's own wrong expectations, not on the code:
    - holdings counted five rows, not six;
    - the Send picker shows its search box past Home's three rows, so the plain-list surface now carries three rows.
  - The corrected run then retried every 10 s for the full two-hour limit without winning the shared harness lock against other arcs' runs. The base-vs-head zero diff and `--stability` are still owed.
- **Shell discipline in an isolated worktree.** The guard refused compound git commands, heredocs, and `sed` with a variable operand; plain single commands, scratch scripts and the Edit tool worked.
