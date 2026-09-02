# harness-fixtures — lessons (phase 1: blueprint + both PRs)

Round-3 plan 1. Mid rigor on PR-b (global-setup): codex session for the plan + one fable-role
subagent audit (Opus, the Fable fallback) on the stage split.

## Consults

| Turn | Who | Ask | Verdict | Folded |
|---|---|---|---|---|
| 1 | fable-role (Opus) | PR-b stage split, adversarial + assumption-attack + critique + proof | conditional approve | (a) measure each stage's score before claiming 44→43, pre-authorized sub-split of `reconcilePriorLock`; (b) `startDevServer` cannot take `weStarted` by value → `onSpawned(child)` sets handle + flag + `recordSpawnedPid()` before the wait; (c) no guard hoisting — probe first, binary/pin gates stay inside the not-running branch; (d) `markBootStarted()` stays in the coordinator between the provisional lock and anvil (exit-86 contract); (e) reuse branch never touches `weOwnLock`; (f) zero new `weStarted* = false`; (g) `provideWithoutSandbox` ×4 each followed by `return`, happy-path provides stay outside their blocks, shared `finishBoot` tail; (h) per-child log needles as data (anvil: stderr-only incl. `address already in use`, anvil-only exit handler); (i) `"ok" \| "skip"` signalling; (j) proof additions: a real reuse-path boot (pinned ports, `kill -9` the vitest parent, re-run one spec), normalized block-diff, string-literal multiset diff, free-port precondition for the fail-loud run; (k) Ask surfaced: scope.md's "e2e:agent twice" cannot exercise reuse — substituted by (j) |
| 2 | codex | blueprint audit (both PRs) | conditional approve | (a) the storage reader takes ONE `get(null)` snapshot and returns values as `unknown`; decode + predicate stay inside the same `try` (today's `try` also covers property access: `JSON.parse("null")`, `{"contract":4}` are skipped, a one-element array holding JSON parses) — so the Node helpers are the old loop bodies verbatim, not a generic `parseJsonRow`; rows stay raw (acceptance comparisons keep coercing as today); the diagnostic census stays untouched; (b) polling drivers keep exact counts: ≤40 refreshes × 15 reads with the sleep after every miss incl. the 15th, none after a hit; record poll 25 reads + 25 sleeps on total failure; (c) dead-RPC planner still logs every method and calls `answer` for EVERY element after a blackhole (only the response is suppressed), empty batch → `[]`, ids `0`/`""`/`false` kept (`?? null`), `answer` exceptions escape; (d) the residue read appears FIVE times (4 in scenario A, 1 in B) with different call-site catch behavior — `readRestoreResidue` never catches, call sites keep their `.catch(() => null)`; the recovery helper sets `gatePage` right after opening and catches the whole attempt; (e) PR-b: skip branches share provides but NOT cleanup (missing-aztec leaves anvil alive until teardown; node-health failure kills node then anvil) — cleanup stays in the stage, provides + returns in the coordinator; outcomes `"ready" \| "skip"` / `"reused" \| "fresh"`; keep the per-child log pipes INLINE (their filters differ on purpose) — only the two dev servers share; (f) the proof: a preserved-lock reuse drill + a stale different-port lock drill (a clean teardown clears the lock, so two clean runs reap nothing), strict/permissive missing-binary cases where env allows; (g) the concrete plan dropped the binding `backup-roundtrip` gate — restored |

| 3 | codex | PR-a review (diff) | approve | no transcription defects; polling parity exact; planner keeps the partial method log on a throwing `answer`; gate-ref timing identical; one non-blocking nit folded — the "unparsed" planner test now uses an 80-char body so the 60-char truncation is actually pinned |

## Decision ledger

- **Stage split vs ACCEPT-with-justification for `setup`**: split. Both auditors' own position:
  "ordering is the spec" argues FOR a 12-line coordinator that makes the exit-86 window, the
  provisional-lock-before-spawn rule and the kill order legible; the 4× provide triple, 2×
  dev-server block and 4× log pipe are ordinary duplication. Minimal-move outline rejected
  pending measurement (its coordinator would still carry the directive).
- **Module state vs a context object**: module state. `onExit` is a process hook that cannot take
  a context; a `let ctx` would be the same global with more indirection.

## Lessons

- **A reviewer running a smoke suite in the same worktree kills your network gate.**
  `global-setup-smoke.ts` (like `global-setup.ts`) starts with `pkill -f "chrome.*--load-extension=<dist>"`,
  scoped to the extension path — which is the SAME `dist/chrome` a concurrent network run in that
  worktree is driving. Codex's PR-a review ran the three planner cases through `test:e2e` at
  13:59:38; `account-balance-orphans` lost its browser (`ConnectionClosedError` at `openPopup`) at
  that second and failed before touching any changed helper. Rule: a review prompt says "do not
  run vitest under any e2e config" while a local gate is in flight; the rerun of the spec alone is
  the verdict.
- **Score a draft outside the tree.** `biome lint --stdin-file-path` prints the processed code,
  not diagnostics (editor mode), so a scratch project with a one-rule `biome.json`
  (`noExcessiveCognitiveComplexity` @15) is how a refactor draft is scored without touching the
  worktree a gate is using: the unsuppressed original reported 81, the stage split reported
  nothing. Plan 4's rescore audit must lint a real path (a temp copy inside the repo), not stdin.
- **Trimmed-line + string-literal multiset diffs are a cheap "verbatim move" proof.** For the
  stage split they left only wrapper lines, dedup'd duplicates and the playground/tools strings
  that became `${label}`/`${title}` templates — every other line and literal matched 1:1.
