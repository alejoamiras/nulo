# Pre-flight findings — Playwright migration spike

> Cheap-insurance read of `implementations-plan/network-test-triage/plan.md` to rule out wallet-side bugs masquerading as cumulative-load before investing in the spike.

## TL;DR

The 18 known failures in `network-test-triage/plan.md` are **wallet-bug-shaped, not cumulative-load**. They fail deterministically in isolation, not just under full-suite load. They would NOT be fixed by per-test fresh browser isolation OR by a Playwright migration. The cumulative-load failure mode the spike targets is a **separate phenomenon** — tests that pass cleanly in isolation but time out at popup waits under full-suite load.

**Decision:** proceed to spike step A (Puppeteer-only 2-cell control).

## What the triage plan classifies

| Cluster | Tests | Category | Could Playwright/per-test-fresh fix? |
|---|---|---|---|
| A. `tokenReadyExtension` fixture: `importToken` (PXE introspection slow OR `isComplete:false` short-circuit) | 11 | (a) wallet bug — `parseTokenInterface` perf or `isTokenComplete` false-neg | **NO** — wallet-side bug, independent of browser state |
| B. `feeJuiceImportedExtension` fixture: setup/import (`mdb_txn_begin: 22` LMDB error on script-side EmbeddedWallet) | 3 | (a) wallet bug — script-side PXE LMDB failure | **NO** — fails BEFORE extension launches |
| C. contacts-sender edit-migrates-sender (PXE delete propagation race or wallet bug) | 2 | (a) real bug or race | **NO** — wallet logic |
| D. contacts-sender delete-confirm 10s timeout | 1 | (b) tight timeout | Possibly — but a timeout bump is the cheaper fix |
| E. data-registerSender 15s waitForPgResult timeout | 1 | (b) tight timeout | Possibly — but timeout bump is cheaper |

**18 of 18 fall outside the cumulative-load target.** Playwright migration has zero leverage against them.

## What cumulative-load actually is (the spike's target)

From the previous session's observation (memory):
- After bumping `waitForPopup` 15→30s in the previous session, **5 originally-failing tests passed but 7 DIFFERENT tests timed out at the new 30s boundary**.
- This pattern (failure set shifts when timeout shifts, but failure count stays roughly constant) is the signature of a **load-bound** failure mode: tests in the tail of the run consume "popup-readiness budget" that the suite as a whole has, regardless of which specific test.
- The 7 newly-failing tests at 30s are **NOT** in the 18 known-failures list — they're separate, infrastructure-flavored failures that only surface under accumulated state.

The candidates for cumulative load (based on prior-session memory):
- `meta-getAccounts-pregrant.test.ts` (no inline `waitForPopup` — relies on the connectPlayground popup chain)
- `cap-request-repeat-noPopup.test.ts` (mentioned in prior session as cluster-suspect)
- `data-addressBook.test.ts`, `contracts-getMetadata.test.ts` — among the dapp tests that pass alone but fail in suite

## Where state actually accumulates (informed guess, the spike tests)

Three candidate accumulation sites:

1. **Extension IndexedDB / chrome.storage.local** — but Puppeteer launches a fresh user-data-dir per `puppeteer.launch`. State only persists within a single `{ scope: "file" }` fixture lifetime, not across files. UNLESS the SW or wallet service writes to a path that survives user-data-dir teardown (unlikely).
2. **Aztec sandbox PXE / LMDB** — runs once per `bun run e2e:agent` invocation; serves all 45 network files. PXE block sync + LMDB grows monotonically. **Strong candidate.**
3. **OS-level Chrome process state** — orphaned child processes, FD count, memory pressure. The smoke config uses `pool: "forks"` + `isolate: true` to mitigate this for the smoke suite; network uses `fileParallelism: false` (sequential, single Node process). **Possible.**

H1 (per-test fresh browser fixes cumulative-load) only helps if (1) is the dominant cause. (2) requires fresh sandbox, not fresh browser; (3) requires fresh Node process per file.

## Spike test design check

The spike's 2×2 will distinguish between (1) and (2)+(3):
- If Cell P-test (per-test fresh launch) fixes the cumulative-load failures → (1) is the dominant cause; fixture-scope-only PR is the right answer.
- If Cell P-test does NOT fix it → (1) is not enough on its own; Playwright won't help either; needs Aztec-side or Node-process-isolation fixes.

## Methodology note (for the spike)

The spike must run a meaningful subset of the suite to surface cumulative-load (one test in isolation won't reproduce). The simplest control: change `dappConnectedExtension`'s scope from `"file"` to `"test"` in the fixture definition (one-line change to `fixtures/extension.ts:251`), re-run the full network suite, compare pass rates against the known baseline.

This is a pure "change scope on the existing runtime" experiment — exactly what Step A is supposed to be.

## Conclusion

Pre-flight: no wallet-bug surprises. The 18 known failures are pre-existing wallet bugs unrelated to the cumulative-load phenomenon we're targeting. **GO to spike step A.**
