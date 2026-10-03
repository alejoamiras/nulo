# Arc 12, row-lifecycle: lessons log

## Plan

- **Plan audit:** both legs said REVISE. All findings were adopted except where the batch plan's Decisions say otherwise. `unsealImportedKey` (Q-27 n) and `settleRegistryTx` (Q-27 b) were dropped; both stay inline and are pinned by Phase 1.
- **Engine text depends on the local's name.** `BaseService.invoke` does not validate RPC arguments, so an omitted `profileId` reaches `account.chainId` and Bun throws `undefined is not an object (evaluating 'account.chainId')`. `rowMatchesKey` keeps the parameter name `account` for that reason. The test builds its reference through `Reflect.get`, because Bun's transpiler folds `const x = undefined` into `(void 0)`.

## Build

- **Phase 1 passed on the unchanged code** (`82dc85a7`). The new test-only `storage-write-log.ts` records ordered `set`/`remove` calls, and its `afterSet` hook lands a racing deletion between a write resolving and its caller resuming.
- **Phase 2 changed no test file.** `git diff 82dc85a7 -- '*.test.ts'` was empty at the Phase 2 head (`1637423f`).
- **Phase 3:** each new test was run against the parent's source before the fix and was red.
  - Patch gate: the rename returned B's row.
  - Purge locks: both purges left the renamed account row written back.
  - Import fence: (i)–(iv) resolved instead of rejecting, and the control was green.
  - `importAccount` is 75 non-blank lines.
- **Mutation checks:** 51 mutants, applied by a scratch script that restored each file from memory, never with git. All 51 were killed after one test was added.
  - **Survivor on the first run:** dropping `persistToken`'s post-write `isCurrent` re-check. `assertCurrentBeforeEmit` refuses with the same text one network check later, so every existing test stayed green. The added test pins that no `isNetworkLive` call follows the write.
  - **One malformed mutant:** Biome had folded `purgeMalformedRows(…, match.raw, …)` onto one line. It was rewritten and killed on the rerun.
- **Scoped duplication:** base `1c0c67ad` had 204 clones and 3,576 duplicated lines. The head has 198 clones and 3,523 lines.
- **Local gates at `e5db491d`:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all exit 0.
