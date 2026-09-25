# Phase 4 · Arc gate and review

## Codex fix loop (`/codex high`, GPT-6 Astra)

| Round | Verdict | # | Severity | Finding | Resolution |
|---|---|---|---|---|---|
| 1 | changes-requested, confidence high | 1 | major | `fixtures/playground.ts` built `PLAYGROUND_TEST_PAGE` at module load; the smoke setup provides no `playgroundUrl`, so `inject()` returned `undefined` past the fallback's `catch` and every smoke file threw a `TypeError` importing `fixtures/extension.ts` | `2e29d70b`: `playgroundTestPage()`, built on call by `openPlayground` and the placement spec. The suggested import-regression test is **rejected**: every smoke file already imports `fixtures/extension.ts`, so the smoke suite fails loudly on this at import |
| 1 | | 2 | minor | A rejection during the placement fixture's setup (registration, the control popup, the network switch) skipped `ctx.close()` and leaked the browser | `d7def733`: everything after the launch runs in a `try` whose `finally` closes the context |
| 1 | | 3 | minor | `plan.md` said a minimized anchor's bounds are refused and get the size-only retry; the adapter drops the window's state, and Firefox clamps positions | `6abffa96`: the inference now says a minimized anchor gets no special handling and the retry runs only on a rejected position. No product change |
| 1 | | 4 | minor | Two comments in `window-placement.test.ts` restated `REQUESTED_HEIGHT` and `lastFocused` | `e918641f`: both deleted; the comment on why the anchor stays below 600 tall is kept |
| 2 | **approve**, confidence high | — | — | none | — |

Both rounds ran in session `01a0d5fc-1b4f-71f1-af1d-2aefc6918f86`, on batch 2's build worktree
before the arc was cherry-picked onto batch 1's top. The ids above are the stack's; the code is
identical (the stack differs from the reviewed tip only by batch 1's two fee-menu commits).

Round 2's verdict, verbatim: *"All four round-1 findings are closed; **no new material findings**
across the full arc. Read-only checks confirmed unchanged URL construction, successful import
without playground injection, and exactly one browser close on success and each tested failure
path. Documentation and comment fixes are accurate. I agree the separate import-regression test is
unnecessary: your smoke mutation check demonstrates existing coverage catches the defect. …
VERDICT: approve — confidence: high"*

## Gates on the stack (`b21317af`)

Every run is retry 0 on `b21317af`, the arc's tip after the fix loop.

| Gate | Result |
|---|---|
| `bun run lint` | exit 0 (1 s) |
| `bun run typecheck:all` | exit 0 (21 s) |
| `bun run test:all` | exit 0 (126 s); extension 566 files passed, 3 skipped; 7171 tests passed, 4 skipped, 7 todo |
| `bun run test:ci-gating` | exit 0 (24 s) |
| `bun run build` | exit 0 (42 s) |
| Smoke, Chrome (smoke build flags, `NULO_E2E_MIGRATION_FIXTURE=1`) | exit 0 (959 s); 35 files passed, 3 skipped; 139 tests passed, 8 skipped |
| Smoke, Firefox | exit 0 (1,065 s); 36 files passed, 2 skipped; 135 tests passed, 12 skipped |
| Network, Chrome prover on, files 1–47 | exit 0 (1,953 s); 45 passed, 2 skipped |
| Network, Chrome prover on, files 48–93 | exit 1 (2,225 s); 44 passed, 1 skipped, **1 failed** (below) |
| Network, Chrome, the six `@requires-proverless` files, proverless | exit 0 (561 s); 6 passed, 11 tests |
| Network, Firefox proverless, files 1–50 | exit 0 (2,456 s); 47 passed, 3 skipped |
| Network, Firefox proverless, files 51–99 | exit 0 (2,022 s); 49 passed |
| Flake bar, `window-placement.test.ts`, Chrome ×3 | exit 0 each (103, 102, 99 s); 1 passed, the Firefox-only refocus case skipped |
| Flake bar, Firefox proverless ×3 | exit 0 each (133, 127, 137 s); 2 passed |
| `bun run e2e:reap` | exit 0, nothing left running |

The network suite ran as five shards in separate worktrees, all at `b21317af`, so no two runs
shared a data dir or a port. The skips are whole-file browser skips (`backup-restore-sw-restart`
on Firefox, `firefox-background-restart` on Chrome) and the two files that skip on both
(`_probe-warmup-effect`, `tx-sendTx-delegated-authwit`).

### The one red: `backup-restore-integrity`, a test that waits on public networks

- **Symptom.** "import drops a foreign-account tx and keeps the funded-account tx" timed out
  after 300 s on the import's Continue screen. Every restore stage finished; chain-sync took
  30.7 s. The same file passed on Firefox at `b21317af` (73 s), and on Chrome at five earlier
  commits (60–82 s).
- **Cause.**
  - The exported backup carries account-state for every network that answers, including the
    public Alpha and Testnet nodes, which the default networks reach over dRPC.
  - Their preloaded contracts are not protocol contracts, so the import registers them.
  - That registration shares a fixed 30 s budget (`importChainSync.ts:34`), while one node
    request may hang for 60 s. One stalled remote call is enough to spend the budget, and then
    every network is marked "Skipped — ran out of time reaching the network". The page stops on
    Continue, which by design never routes on its own.
  - The restore log trail is empty because `nulo:logs` persists only in developer mode.
- **Proof.**
  - Three isolated Chrome runs at `b21317af` passed: 74.6, 72.9 and 85.4 s, with chain-sync at
    12.5–15.6 s.
  - A fourth run delayed only the offscreen requests to `*drpc.live*`, by 35 s. It reproduced the
    failure exactly: chain-sync 30.7 s, stage `finished`, Continue shown, empty trail, and all
    three networks skipped.
- **Batch 2 cannot reach it.**
  - The test opens no dApp, passkey or verify window.
  - The fixture changes it uses keep their defaults: `fixedWindowSize` stays true, and two
    helpers were only exported.
  - The Firefox focus tracker never runs on Chrome.
- **Disposition.** The file is pre-existing and depends on public networks, which puts it
  outside this program's scope. It is listed under the program's follow-ups with the test-side
  fix. The gate stands on the three clean retry-0 runs at the same commit. A CI red from this file
  is the same external stall and is re-run, not loosened.
