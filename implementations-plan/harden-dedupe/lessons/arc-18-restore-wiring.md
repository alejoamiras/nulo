# Arc 18, restore-wiring: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh) and an Opus pass both returned REVISE, with no blocker.** Both confirmed the extraction is sound:
  - the move is verbatim and keeps the single `await`;
  - relink stays synchronous;
  - the try/finally, rollback and disconnect order is intact;
  - the type-only changes add or remove no validation;
  - the trust gate is untouched;
  - nothing couples blockingly with arcs 12 or 13.

  All 10 findings were adopted (see the batch plan's Decisions). Four of them changed the test plan:
  - **"An added `await` is unobservable" was false.** A microtask queued by the token client's `disconnect` runs after the synchronous `appendErrors → recordRestoreErrors` today. One extra `await` before relink makes it run first. Case 4 now carries that observer, and M13 is the added `await`.
  - **An empty-slice witness with token results `[]` does not prove the `?.length` gate.** A truthiness gate relinks `[]` without throwing. Resolving the token results to `undefined` makes the weakened gate (M3) throw at `newTokens.length`.
  - **A mutant can turn red for the wrong reason.** M6 first referenced an unbound `profileId`, so the failure would have been a `ReferenceError`, not the argument check. It now passes `"new-id"`, and only case 1's `mock.calls` comparison turns red.
  - **`return await rollbackAndFail` is behaviour.** Without the `await`, `finally` disconnects the account client between rollback attempts. Case 8 compares `invocationCallOrder` and turns red on M12.
- **Asks.**
  - The import-only edit to `useFullBackupImport.test.ts`: both legs accepted it.
  - The three remaining casts split the legs. Codex said leave all three. Opus said take `:343`, which is pure type erasure on an `any[]` inside an edited function. **Call:** take `:343`, leave `:522-523`.

## Build

- **Phase 1** added 8 cases under `describe("restore wiring handoffs")` in `useFullBackupImport.stages.test.ts`. They pass on the unchanged code. That file imports only `useFullBackupImport`, so Phase 2 leaves it byte-identical.
- **A fixture correction.** Case 7's first contact row had a numeric `id`. Backup normalization refuses that ("slice "contact" row 0 has a missing or malformed id"), so the import failed before any slice restore and the case read as `[]` calls. Contact rows need a string id (`"c1"`). The case now also asserts that `fillError` is never called, so a fixture the migrator refuses cannot pass silently as "no calls".
- **Typecheck caught one mock.** `accountClient.restoreImportedKeys` is `vi.fn(async () => [])`, which infers `never[]`. A result row for it needs `as never`.
- **The engine texts** came from the test's own engine, through reference expressions that bind the production locals. On Bun 1.4.2: `undefined is not an object (evaluating 'a of newAccounts')` and `… 'newTokens.length'`. Node 24 reads `newAccounts is not iterable` and does not name the local in the second.
- **Phase 2** checked the move by diffing the moved function text against the originals with a script. The only differences are the parameter annotations, the dropped `(F)` tag and the two rewritten doc comments.
- **Deviation: `.eslintrc-auto-import.json` changed too.** The plan expected only `auto-imports.d.ts` to regenerate. The build also added a `RestoreData` entry to the eslint globals list, because the list carries exported type names as well as values. Both generated files are committed. The stale `restoreNetworksStage` global stays, since the generator keeps removed names.

## Mutation check

- **Method.** Each mutant was applied in place to a pristine copy of the source, then both restore suites ran, then the file was restored by copy, never with git, and checked byte-equal afterwards. The run happened once against the unchanged source (Phase 1) and once against the moved code (Phase 2).
- **Result: 13 of 13 turned red at both phases, with identical failing-test sets.**

| # | mutant | turned red by |
|--:|---|---|
| M1 | stage 2a bypassed: raw `restore` plus an allow-set of every account | case 5; P1 tx provenance (2); P3 authwit graft |
| M2 | relink receives `new Set()` | cases 4 and 7; P3 balance graft; 3 token-balance key tests |
| M3 | gate weakened to `if (data["token-balance"])` | case 3 |
| M4 | token errors recorded before the dropped balances are appended | case 4 |
| M5 | `tokenService.restore(data)` | case 2 |
| M6 | `accountService.restore(data.account, "new-id")` | case 1 |
| M7 | `newAccounts` renamed | case 5 |
| M8 | `newTokens` renamed in relink | case 6 |
| M9 | contact and config clients swapped | case 7; stage-order law; migration wiring; profileId remap |
| M10 | `restoreImportedKeys` before stage 2a | case 4; stage-order law |
| M11 | the accounts stage's `finally` disconnect dropped | case 8; `useFullBackupImport.test.ts:512-536` (both) |
| M12 | `return await rollbackAndFail` becomes `return rollbackAndFail` | case 8 |
| M13 | `await Promise.resolve()` before relink | case 4 (microtask snapshot) |

## Gates

- **Phase 1 and Phase 2:** `bun run lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all exit 0, and `bun run build` exits 0. No workflow file changed, so `lint:actions` is not needed.
