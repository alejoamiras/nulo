# Arc 17, pxe-idb: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh) returned REVISE, with no design defect; Opus returned APPROVE.** Both legs confirmed that the non-async `deleteDb` keeps every site's await shape, the policies match per site and never choose a name, and the catalog derivation is sound. Every finding was adopted (see the batch plan's Decisions). The two that changed the test plan:
  - **M3c would have survived.** Only a blocked prefix delete was exercised, so the blocked-erasure case now runs against both targets.
  - **The sweep's fresh-listing guard needed its own case** in the new file, so dropping `if (remaining) return` reds it.

## Build

- **Phase 1** passed on the unchanged code: 22 cases in `packages/aztec-runtime/src/pxe/service-idb-delete.test.ts` and 1 in `apps/extension/src/wallet/services/pxe/known-artifacts-order.test.ts`.
- **The tick literals were measured on the unchanged code:**

  | pin | ticks |
  |---|---|
  | T1: boot listing → first delete | 1 |
  | T2: re-list → keyval delete | 1 |
  | T3: keyval `onsuccess` → lifecycle `deleted` | 2 |
  | T3: keyval `onsuccess` → queued `barrier.read` | 2 |
  | T4: emptiness listing with a sibling → `deleted` | 2 |
  | T5: chain delete `onsuccess` → `clearChainState` settles | 6 |

  Three runs of the file agreed.
- **The catalog test compares the two parsed artifacts by name and function names, not with `toEqual`.** The plan said `toEqual` each `loadContractArtifact(json)`, but a deep compare of the full artifacts timed out at the default 5 s. Identity still holds for the ten imported artifacts, and the two parsed ones are also checked to differ from each other. The test carries a 60 s budget for its cold imports.
- **Fake timers fake only `setTimeout` and `clearTimeout`**, so the stub's `queueMicrotask` events and the tick counters run untouched.
- **Phase 2** touched no test file: `git diff --stat` at the Phase 2 commit lists only `service.ts` and `artifact-catalog.ts`.

## Mutation check

- **Method:** 25 mutants, each applied alone to the Phase 2 source by a scratch script, against its Phase 1 file. The file was restored by copy, never with git, and the tree was clean afterwards.
- **Result: 25 of 25 red,** each through the cases aimed at it. No mutant failed by a load error.
  - **Policies:** M1 (S1 to verified), M2 (S2 to verified), M3a/b/c (each erasure caller to skip), M4a/b (timeout 4,999 and 5,001).
  - **Guards:** M5 (the sweep's lookup made fresh), M6 (erasure reuses the emptiness listing), M7a/b (each emptiness guard dropped), M8 (unconditional splice), M9 (forward loop).
  - **Messages:** M10 (the S2 warn with two arguments), M11a/b (the null fallback added to skip, or dropped from wait).
  - **Await shape:** M12 (the keyval guard as an async helper, caught by T3 and T4), M13 (`deleteDb` declared `async`, caught by T3 and T5), M14 (`finish` keeps the timer).
  - **Ordering:** M15 (success bookkeeping above the keyval delete).
  - **Data loss:** M19a (the erasure filter uses `isLegacyPxeDb`), M19b (the prefix without its trailing slash). Both are caught by the p2/p10 sibling case.
  - **Catalog:** M16 (two entries swapped), M17 (one accessor rebound), M18 (keys reversed).

## Gates

- **Phase 1 head:** `typecheck:all` exits 0, and both new files lint clean.
- **Phase 2 head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` (plans gate: 0 findings) and `audit:vue` (which includes `build`) all exit 0. The build left no change to the generated declaration files.
