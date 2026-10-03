# Arc 15, async-primitives: lessons log

## Plan

- **Two scratch probes on Bun 1.4.2 and Node 24.21.0 fixed the design.**
  - A race-returning deadline helper resumes the caller at the same hop as an inline `await Promise.race`.
  - `.finally(clear)` costs +1 hop on Bun and +3 on V8.
  - All seven queue shapes match one helper with two policies.
- **Plan audit:**
  - Codex: REVISE. Its one blocker was that the deadline helper's clear reaction runs before each caller's cleanup (OPFS order: quarantine-or-release, clear, outer catch became clear first). The helper was dropped and recorded under Deferred.
  - Opus: REVISE, no blocker. It reproduced the queue traces with two interleaved noise chains.

  Every finding is in the batch plan's Decisions.

## Build

### Phase 1: characterization (test only)

- **Mutation audit**, against the unchanged code: each mutant applied to the file, the named tests run, and the original restored from memory and a scratch copy (never with git). The first pass left 31 of 50 mutants alive. Tests were added until only the four equivalents below survive.

  | Mutant | Killed by |
  |---|---|
  | fee: no chaining; propagate swapped for swallow | the write-chain tests (already there) |
  | guarded: tail left rejected; a throw swallowed | the new "an activation that throws rejects its own caller" row |
  | seeder: lock left rejected; a rejection swallowed | the new "a marker write that fails rejects its own caller" row |
  | logger: `.catch` dropped; no chaining | the store tests (already there) |
  | offscreen: `pendingClose` nulled by an older link | the new "an earlier close settling does not release a successor" row |
  | scan-episodes: no chaining; `hydrate` not awaiting its write-back | the two new ordering rows |
  | scan-episodes: `.catch` dropped; `settled()` frozen | the existing failure and write-order tests |
  | price: `.catch` dropped | the new "a failed transition is logged as a warning" row |
  | price: no chaining | the B-21 config pins (already there) |
  | each fence check deleted, each fence bump removed | the existing composable tests, plus new rows for useEntityCrud (a superseded failure, a superseded `isLoading`), useLegalAcceptance (a superseded failure) and useIncomingSyncHealth (a retry outlived by a scope change) |
  | strict swapped for permissive, at all six strict sites | new array rows: `projectKnownCapability` (in `dispatcher.test.ts`), `readConsent`, `sanitizePinMap([[A]])`, the episodes-as-array blob, the Send map as an array (`method-descriptors` was already pinned) |
  | permissive swapped for strict, at all three permissive sites | the exact `Malformed sendTx request: exec.calls must be an array`, `holdsCallScope` and `buildDetailsTable` rows |
  | each `sleep` delay off by 1 ms | new fake-timer pins: auth-guard 250/500/750, the activity re-read 50/100, the gas leg retry (default and injected), `SystemClock.sleep` (new file); the preflight backoff was already pinned |

- **Equivalent mutants**, kept as they are: `useSeedStatus.ts:133` and `useIncomingSyncHealth.ts:134` (dispose bump), where `disposed` guards the same reads.
- **Two survivors first called equivalent are not.** Codex round 1 corrected both; see Review below.
  - fee's `chain = link` drops a hop: the next step runs one microtask earlier on both engines. The helper's permanent timing tests guard that hop now.
  - Dropping offscreen's `.catch` on the close tail settles the joined link one microtask earlier, even when the close succeeds.
- **Temporary site fingerprints** (`apps/extension/src/async-primitives.fingerprint.test.ts`), deterministic over two runs on Bun:
  - scan `hydrate`, then a write and a removal: `hydrate@0 set-start@3 set-done@9 hydrated@13 set-start@14 set-done@20 remove-start@23 remove-done@29 settled@32`
  - logger, two purges with the first removal failing: `start@0 remove-1@1 remove-2@5 purge-1-resolved@6 purge-2-resolved@10`
  - guarded, a throwing activation then a persisting one: `start@0 a-guard-throws@1 a-rejected@5 persist-n3@6 b-activated@10`
  - offscreen, a loading-race close on the tail before the retry create: `start@0 create-1@2 close@4 create-2@8 ready@13`

### Phase 2: the helpers

- `createSerialQueue`, `isRecord`/`isObjectLike`, `sleep`'s `Promise<void>` type and `RunFence.invalidate()` landed with no consumer edit. The permanent reference graphs (one per policy, a rethrowing reporter and an awaited `tail` included) match the hand-written chains hop for hop.
- Helper mutants, all killed: report `then(op, op)`; propagate tail left rejecting; either `tail` frozen as a plain property; report unchained; one extra hop on propagate; strict guard made permissive; `invalidate()` a no-op.
- Biome reads a test helper named `after` as a duplicate hook (`noDuplicateTestHooks`); it is `settleAfter`.
- The report overload returns `Promise<T | void>`, because a failed op resolves to whatever `onError` returned. That union needs one reasoned `noConfusingVoidType` suppression on the interface; it is not a complexity suppression.

### Phase 3: the migrations

- `realSleep` left `auto-imports.d.ts`'s `vue` block on the build, but its global `const` line stayed until removed by hand; a rebuild keeps it out.
- `ScanEpisodeStore.settled()` now returns `Promise<unknown>`, the live `tail`. Every caller only awaits it.
- The temporary site fingerprints and the seven-shape matrix passed unchanged against the migrated code, two runs each on Bun, then left in 3g.
- **Mutation re-run on the migrated code**, 51 mutants at the sites (policy swaps, an unchained stand-in queue, fence checks and bumps, guard swaps by import alias, each `sleep` off by 1 ms): all killed except three survivors and one gap.
  - Survivors: the seed and health dispose `invalidate()`s, which are equivalent, and offscreen report to propagate, which is not (Review below).
  - Gap: the logger's report-to-propagate swap survived, because no test made a storage op fail while watching its caller. The new `clear()` row passes against the parent's chain and the migrated queue, and kills the swap.
- **The LogsViewer timer clear moved to arc 15b** (logsviewer-timer), after the build: a route-2 fix ships in its own arc. Its commit was dropped from this branch by a non-interactive rebase and cherry-picked there, with its red-then-green record and its two mutants (the clear removed, the fallback count changed), both killed.

### Gates

- `lint`, `typecheck:all`, `check:plans`, `test:all` (extension 8,946 tests after the split; wallet-core 273; wallet-bridge 599), `test:ci-gating` (255 pass) and `audit:vue`: all green. The build leaves the auto-import files unchanged beyond `realSleep`.
- npm: `stage.ts wallet-crypto --version 0.1.0` at the parent and at the head gives the same 10 files with identical sha256s.
- Shots, re-taken after the split (parent `1c0c67ad` against code head `dcf6c531`): 12 of 12 identical (three logger states × Chrome and Firefox × dark and light), and 12 of 12 identical in the `--stability` run (the base against itself). Both runs waited out the harness lock held by sibling arcs.

## Review

### Codex round 1: arc 15 NOT CONVERGED (one should-fix, one nit, both tests and docs); 15b CONVERGED, no findings

1. **Should-fix: the offscreen report-to-propagate survivor is not equivalent.**
   - Codex ran the real functions on Bun and Node. With a successful close, propagate returns the link before its catch, so `pendingClose` clears and the joined caller resumes one microtask earlier. The existing test drains every microtask, so it could not see the difference.
   - **Adopted:** a permanent ordering test in `offscreen.test.ts`, "a successor joined on a close that succeeds resumes on the close tail's swallowing link". It stamps the microtask at which the successor's first probe runs after the close resolves.
   - Results: the stamp is 4 at the head (three runs) and 4 with the parent's `offscreen.ts`. The swap gives 3, and the mutant is killed by this test alone.
   - Our spinner counts from the resolve call, so its stamps sit two below Codex's (4 and 3 against 6 and 5). The gap is the same.
   - The test finishes its pass before asserting, so a failure leaves no pass in flight to cascade into later tests.
2. **Nit: fee's `chain = link` was wrongly called equivalent.** Removing the catch moves the next step from microtask 5 to 4. **Adopted:** reclassified above. No new test: the helper's permanent reference graphs pin that hop.
3. **Confirmed by Codex:**
   - the seven queue mappings, the overloads and the live-tail reads;
   - fence placement, and the two genuinely equivalent dispose survivors;
   - the guard assignments, `sleep` timing, and the 15b LogsViewer cleanup.
4. **Coupling noted for the stack:** arc 16 also edits the utils barrel and the wallet-core README. Keep both arcs' additions when combining them.
