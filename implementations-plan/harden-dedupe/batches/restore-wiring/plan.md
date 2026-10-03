---
plan: harden-dedupe / restore-wiring (arc 18 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/18-restore-wiring, stacked on harden-dedupe
---

# restore-wiring: the restore stages call their transforms directly, with real types

Finding Q-25, from `audit/quality/2026-09-30-dedup-high/`. The full-backup restore stages in `apps/extension/src/composables/full-backup-restore.ts` reach two transforms that live in the UI composable `useFullBackupImport.ts`. To avoid a module cycle, the stages receive them as injected parameters typed `never`, and every handoff is cast `as never`. This batch moves the two transforms into the stage module and deletes the injection and its casts. Not one runtime expression changes: no restore order, trust gate, refusal text or row filter, and no native error text.

## Outcome & Quality Bar

- **For whom:** the next person who changes a restore transform's inputs. Today a changed parameter compiles at the handoff, on the data-recovery path, where a hostile backup is the expected input.
- **Excellent:**
  - The stage module owns account filtering and token re-linking. It calls them directly, so a signature change fails to typecheck at the call.
  - `AccountRestoreClient` declares the `restore` it is called with. The five slice clients satisfy `SliceRestoreClient` with no cast.
  - Before the move, characterization pins what the move could disturb, and each pin is shown to turn red on a named mutant:
    - the arguments each restore receives;
    - the error-log key order and its microtask timing;
    - the `token-balance` gate;
    - rollback-before-disconnect;
    - the native `TypeError` text of the two expressions reachable from service results.
- **Good enough:** the two `chainSyncClients` casts (`full-backup-restore.ts:522-523`) stay. Typing them means threading the account-state and node-status types through chain sync, which is outside the finding. `:343` goes, as a no-op cast inside a function Phase 2 edits (see Decisions).

## Architecture & Implementation

Files: `apps/extension/src/composables/full-backup-restore.ts` (579 lines), `useFullBackupImport.ts` (955 lines), the import statement of `useFullBackupImport.test.ts`, and the regenerated `apps/extension/src/types/auto-imports.d.ts`. No `.vue`, CSS, service or package file changes.

### Sites today (read on `harden-dedupe` at `169bed04`; neither source file has changed since the audit)

| site | what it does today |
|---|---|
| `useFullBackupImport.ts:165-229` `restoreAccountsAndFilterOwnedSlices` (doc `:152-164`) | stage 2a: `accountService.restore(data.account)`, records account errors, builds the allow-set and filters three slices in place |
| `useFullBackupImport.ts:239-306` `relinkRestoredTokenBalances` (doc `:231-238`), cap const `:47-49` | stage 2b: index-pairs restored tokens, keeps only balances that pass the chain-equality check, returns the dropped positions |
| `useFullBackupImport.ts:63-69` | the `ValidatedBackup["data"]` shape both transforms take |
| `useFullBackupImport.ts:528`, `:536` | `restoreAccountsAndFilterOwnedSlices as never`, `relinkRestoredTokenBalances as never` injected into the stages |
| `full-backup-restore.ts:129-133` | `AccountRestoreClient` without `restore` |
| `full-backup-restore.ts:326-331`, `:336-340` | the `never`-typed injected parameter; its call with `data as never`, `accountService as never` |
| `full-backup-restore.ts:377`, `:382`, `:388` | the `never`-typed relink parameter; `data.token as never`; `data as never`, `newTokens as never` |
| `useFullBackupImport.ts:425-433` `buildSliceClients` | five `new …Client() as never`, then `as Array<{…}>` |

### Guard set per site (identical before and after)

- **Stage 2a.**
  - `restore` is called once, with `data.account` as its only argument.
  - The allow-set holds only results with no `restoreError` and a string `address`. The `${chainId}:${address}` key is added only for a number `chainId`.
  - Transactions and authwits are kept only on a number `chainId` + string `account` key in the allow-set. Token balances are kept on a string `account` among the imported addresses.
  - A non-array slice is skipped. A dropped row is logged by count only.
- **Stage 2b.**
  - Pairing is by result index. A missing old row, or a failed new row, never feeds the maps.
  - The chain comes from the restored token, never the blob's row.
  - A balance is dropped when its token id or its chain fails. Only the position is recorded, capped at 200, plus a truncation marker.
- **`restoreAccountsStage`.**
  - Order: stage 2a, then `Array.isArray` on `imported-account-keys`, then `restoreImportedKeys`, then record.
  - `"Duplicate account"` leads to `return await rollbackAndFail`. Anything else rethrows.
  - `finally` disconnects.
- **`restoreTokensStage`.**
  - The token restore runs inside a `try`/`finally` that disconnects.
  - Relink runs only when `token-balance` is non-empty.
  - Dropped balances are appended before the token errors are recorded.
- **`buildSliceClients`.** The five clients are built up front, in the order transaction, token-balance, auth-registry, contact, config. Each restore gets `(rows, createdProfileId)`.
- **Untouched by this arc:**
  - `validateAndMigrateBackup` (`useFullBackupImport.ts:85-150`): checksum, then compat-epoch, then an integer schema version in `1..max`, then migration, each with today's title and message. The block-listed roots live in `wallet/services/backup/backup-migration-registry.ts:229`, a file this arc does not touch.
  - `executeRestore`'s unconditional `normalizeAllIds` (`:512`) and its created-profile check (`:541-543`).

### What changes

1. **`full-backup-restore.ts` gains:**
   - `export type RestoreData`: today's `ValidatedBackup["data"]` shape, verbatim.
   - `restore(rows: unknown[] | undefined): Promise<unknown>` on `AccountRestoreClient`, in method shorthand like its siblings.
   - The cap constant, and both transforms moved verbatim, with every local name kept (`newAccounts`, `a`, `oldTokens`, `old`, `newTokens`, `tb`, `i`). The `${chainId}:${address}` key stays inline at its four sites (see Follow-ups). Only these things change:
     - their parameter types (`data: RestoreData`, `accountService: AccountRestoreClient`);
     - **comments.** Dropped: the `Q-02` and `(F)` tags (`useFullBackupImport.ts:152`, `:158`, `:208`, `:232`), "stage 2a/2b", "the Q-02 verifier's constraint" and "today's append point". Kept: the provenance, index-pairing, chain-authority and bounded-diagnostic explanations. Added: one invariant comment at the boundary, saying that absent slices are forwarded unchanged, service results are not validated, and a malformed result throws natively, with a message that names these locals and reaches the failure copy. The `[full-backup-import]` log prefix stays verbatim, because it is exportable log text;
     - two imports (`AUTH_REGISTRY_SERVICE_NAME`, `TOKEN_BALANCE_SERVICE_NAME`), plus `ACCOUNT_SERVICE_NAME` added to the existing `account/spec` import.
   - `RestoreData` moves verbatim. Its `profile` and `network` fields overstate what is validated (see Follow-ups).
2. **`restoreAccountsStage`:**
   - The `restoreAccountsAndFilterOwnedSlices` field (`:326-331`) is deleted.
   - The call becomes `await restoreAccountsAndFilterOwnedSlices(data, accountService, io.recordRestoreErrors)`.
   - `importedKeySlice as never` (`:343`) loses its cast. `Array.isArray` has already narrowed the value to `any[]`, so this is pure type erasure.
3. **`restoreTokensStage`:**
   - The fourth parameter is deleted.
   - `tokenService.restore(data.token)` is called without the cast.
   - The relink call becomes `relinkRestoredTokenBalances(data, newTokens, importedChainAddress)`.
   - The stages keep `data: Record<string, unknown>`. A scratch probe showed it is assignable to `RestoreData`, so no stage signature widens or narrows.
4. **`useFullBackupImport.ts`:**
   - The moved block and the now-unused `ACCOUNT_SERVICE_NAME` import (`:5`) go.
   - `type RestoreData` and `type SliceRestoreClient` join the existing `./full-backup-restore` import (`:23-39`).
   - `ValidatedBackup.data` becomes `RestoreData`.
   - `executeRestore` loses the injected field (`:528`) and the fourth argument (`:536`).
   - `buildSliceClients` returns `Array<{ name: string; client: SliceRestoreClient }>`, with no cast. The scratch probe typechecked all five real clients against it.
5. **`useFullBackupImport.test.ts`:** only import lines change (`:177-182`); no assertion, fixture or title does. The two transform names now come from `./full-backup-restore`.
6. **`bun run build`** regenerates `auto-imports.d.ts`:
   - The two globals (`:224`, `:237`, `:751`, `:763`) point at `full-backup-restore`.
   - `RestoreData` joins that module's type line (`:358`).
   - The stale `restoreNetworksStage` line (`:240`), a global for an export that was renamed long ago, is pre-existing and left alone.

**Await shape.** Today the stage runs `await deps.restoreAccountsAndFilterOwnedSlices(…)`, one `await` on that async function's promise. Afterwards it runs `await restoreAccountsAndFilterOwnedSlices(…)`: the same function, the same arguments, evaluated in the same order. Relink stays synchronous. No wrapper and no new async function is added, and `return await rollbackAndFail` stays as it is. The only runtime difference is `this` inside stage 2a (`deps` today, `undefined` afterwards), and the function never reads `this`.

An added `await` *would* be observable. A microtask queued by the token client's `disconnect` sees `appendErrors → recordRestoreErrors` already done today; with an `await` before relink, it runs first. Dropping the `await` from `return await rollbackAndFail` would also let `finally` disconnect the account client between rollback attempts. Phase 1 pins both (cases 4 and 7).

**Module evaluation.** `useFullBackupImport.ts` already imports both new spec modules (`:7`, `:15`) before it imports the stage module (`:23-39`). No production module imports `full-backup-restore.ts` directly, so no evaluation order changes.

**Alternatives not taken.**
- *A new restore-support module.* The audit suggests one, but the stage module is already non-reactive ("No Vue reactivity", `full-backup-restore.ts:2-3`), so a third file adds a layer for nothing.
- *Keeping the injection but typing it with `import type` from the composable.* That removes the casts but keeps both injected parameters, and the stage module would still depend on the UI file. This is the intimacy the finding names.
- *A test-only re-export from `useFullBackupImport.ts` to keep the test file byte-frozen.* It would be a shim with no production consumer, and it would put a duplicate name in the auto-import scan (see Asks).

**Complexity.** No function in either file is in `scripts/complexity-baseline/manifest.json`. The moved functions keep their bodies, and two stage signatures shrink.

## Security & Adversarial Considerations

- **Threat model.**
  - The backup file is attacker-controlled: a plain backup's checksum can be recomputed, and migration validates little beyond row ids. Its slices reach both transforms after the trust gate.
  - The service results (`accountService.restore`, `tokenService.restore`) come back over an internal port. The client resolves whatever the background returned, so an absent result reads `undefined`.
  - The caller is the popup or the onboarding page. No dApp reaches this path.
- **No validation added, none removed.** Casts are erased at compile time, and the transforms move byte-for-byte apart from their parameter annotations. The trust-gate order, the refusal copy and the block-listed roots sit in code this arc does not edit.
- **The provenance filters stay intact.** Stage 2a's allow-set is exactly this restore's successful accounts. That set is still returned and threaded into relink, and it is never re-derived. A crafted backup naming a foreign account still loses those rows before any slice restore writes them.
- **Native `TypeError` text.** Two expressions reachable from service results throw today and stay byte-identical, under the same local names:
  - A `undefined` account result throws at `for (const a of newAccounts …)`. Bun 1.4.2 says `undefined is not an object (evaluating 'a of newAccounts')`; Node 24 says `newAccounts is not iterable`.
  - A `undefined` token result with a non-empty balance slice throws at `newTokens.length`.
  - Both reach the user through the failure path's `fillError("full_backup", "Import failed", message)` after the pre-finalize rollback. Phase 1 pins both in the test engine, against reference expressions that bind the same names.
  - The backup itself cannot reach them. Normalization rejects a non-array slice, and an absent account slice throws inside the service.
  - The other throwing reads (`a.restoreError`, `newTokens[i].restoreError`, `oldTokens[i]`) are covered by source identity: every expression and local is preserved, and no guard is added.
  - The production bundle is minified, so its messages carry mangler-chosen names. Those already shift with unrelated edits to the chunk. The guarantee here is source-identical expressions, the standard earlier arcs applied.
- **Restore order across slices** is pinned by `useFullBackupImport.stages.test.ts:286-372` and stays unchanged. Phase 1 adds the error-log key order, the one place where the order of stage 2a, imported keys, the relink and the token errors shows outside the services.
- **Logging.** The moved `console.warn` lines keep today's count-only payloads. No new log line.
- **Layering and npm.** The composables layer only. Both new imports are spec constants the stage module's siblings already import. No published entry is touched.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `169bed04`):

1. The sites and lines are as tabled above. Neither source file has changed since the audit (recon Q-25).
2. `AccountServiceClient.restore` and the contact and config clients' `restore` are the base rest-argument `restore(..._args: unknown[]): Promise<unknown>` (`packages/extension-messaging/src/background/client.ts:144`). Transaction, token-balance and auth-registry override it as `(rows: unknown[], profileId: string)` (their `client.ts:27-29`).
3. A scratch type probe (outside the worktree, against the real clients) typechecked:
   - the five clients as `SliceRestoreClient`;
   - `AccountServiceClient` against `AccountRestoreClient` plus `restore`;
   - `Record<string, unknown>` passed to `RestoreData`;
   - `RestoreData.token` passed to the token client's `restore`.
4. The only importers of the two transforms are `useFullBackupImport.ts` and `useFullBackupImport.test.ts:177-182`. Both suites drive the stages through `useFullBackupImport` alone (`useFullBackupImport.stages.test.ts:184`).
5. No existing test pins the arguments that `accountClient.restore` or `tokenClient.restore` receive, the error-log key order, or the `token-balance` gate's absent and empty cases.
6. Arcs 12 and 13 touch only `apps/extension/src/wallet/services/**` (and arc 12's `storage-write-log.ts` test helper). Neither touches `src/composables/` or `src/types/` (their branch diffs against `harden-dedupe`).

**Inferences:**

- **The seam with arc 12 (row-lifecycle).**
  - Its `requireRestoreProfileId` guards the receiving end of `restoreServiceSlices`' second argument (transaction, token-balance, auth-registry). This arc keeps that argument, `scratch.createdProfileId`, and its arity.
  - Its `restoreRowProfileId` projections sit inside `account`/`token`/`contact` `restore` (`account/service.ts:674-677`, `:766-769`; `token/service.ts:858-861`; `contact/service.ts:287-290`), which receive `data.account`, the imported-key slice, `data.token` and the contact slice. This arc passes the same expressions. So arc 12's preserved `.map` `TypeError` for a non-array slice stays reachable exactly as today.
  - It adds `accountScopeKey(chainId, address)` to `account/spec.ts`, which is the `${chainId}:${address}` key that the moved code builds at four sites. This arc does not adopt it. That would not be a verbatim move, and the frozen suites' `vi.mock` lists for `account/spec` lack the name. The duplication goes to Follow-ups.
  - No file overlap, so either order restacks cleanly.
- **The seam with arc 13 (profile-rows).** It rebuilds `ProfileService.restore`'s row construction and the restore stash behind `ProfileRestoreClient.restore` → `{ id, restoreError? }` and `finalizeRestore(profileId, password)`. This arc touches neither `ProfileRestoreClient` nor `restoreProfileStep`. No file overlap.

**Asks:** both are answered under Decisions. The import-only test edit is accepted. `:343` is taken; `:522-523` stay.

## Phases

### Phase 1: pin the handoffs (test only)

Add one `describe("restore wiring handoffs")` to `useFullBackupImport.stages.test.ts`. It imports only `useFullBackupImport`, so it stays byte-frozen through Phase 2. Every case drives `restoreBackup` over the file's existing mocked clients:

1. **Account handoff:** `accountClient.restore.mock.calls` equals `[[rows]]`, where `rows` is the backup's account rows after the profile-id remap. One call, one argument.
2. **Token handoff:** `tokenClient.restore.mock.calls` equals `[[tokenRows]]`.
3. **The `token-balance` gate.**
   - Absent slice, with the token restore resolving `[]`: the import completes, the log has no `token-balance` key, and the balance client is never called.
   - Empty slice, with the token restore resolving `undefined`: the import completes, the log has no `token-balance` key, and the balance client gets `([], "new-id")`. The baseline skips relink. A truthiness-only gate would relink and throw at `newTokens.length`.
4. **Error-log order.** The account result has one failed row, the imported-key result has one failed row, one balance cannot be re-linked, the token result has one failed row, and the transaction passthrough returns one failed row.
   - `Object.keys(restoreErrorLog)` equals `["account", "imported-account-keys", "token-balance", "token", "transaction"]`.
   - The `token-balance` entries are the dropped-position record followed by the balance service's own row.
   - The token client's `disconnect` queues a microtask that snapshots the log keys. The snapshot already holds `token-balance` and `token`, because `appendErrors` and the token record run synchronously after the disconnect.
5. **Service results keep native text.**
   - The account restore resolves `undefined`. `deleteProfile` is called, the stage ends `rolled-back`, and `fillError` gets `("full_backup", "Import failed", expected)`. `expected` is the message thrown in the test's own engine by a reference loop `for (const a of newAccounts)` over an `undefined` `newAccounts`.
   - The same for a token restore resolving `undefined` with one balance row, against a reference `newTokens.length`.
6. **Slice pairing:** each of the five passthroughs' `restore.mock.calls` equals `[[its slice rows after filtering and migration, "new-id"]]`. Every slice's surviving rows carry a distinct marker, so a swapped `(rows, id)` pairing turns red.
7. **The duplicate-account rollback finishes before disconnect.** `accountClient.restore` rejects with "Duplicate account", and `deleteProfile` rejects once, then resolves. Assert:
   - `deleteProfile` is called twice;
   - `accountClient.disconnect`'s first `invocationCallOrder` comes after both `deleteProfile` calls;
   - `fillError` gets the duplicate copy.

**Mutation check** (each mutant is applied to the unchanged source; Phase 1's suite plus the two existing suites must turn red; the log names the red test):

| # | mutant | turned red by |
|--:|---|---|
| M1 | stage 2a bypassed: the stage calls `accountService.restore` and returns every account | existing P1/P3 provenance tests, case 4 |
| M2 | relink receives `new Set()` | `useFullBackupImport.test.ts` token-balance tests (`:1320-1476`), case 4 |
| M3 | the `?.length` gate weakened to `if (data["token-balance"])` | case 3 (empty slice) |
| M4 | `appendErrors("token-balance")` moved after the token errors are recorded | case 4 |
| M5 | `tokenService.restore(data)` | case 2 |
| M6 | `accountService.restore(data.account, "new-id")` | case 1's exact `mock.calls` comparison |
| M7 | `newAccounts` renamed | case 5 (on Bun/JSC) |
| M8 | `newTokens` renamed in relink | case 5 (on Bun/JSC) |
| M9 | the `(rows, id)` pairing swapped between two slice clients | case 6 |
| M10 | `restoreImportedKeys` before stage 2a | the stage-order law, case 4 |
| M11 | the accounts stage's `finally` disconnect dropped | `useFullBackupImport.test.ts:512-536` (one disconnect before reconcile settles, two after) |
| M12 | `return await rollbackAndFail` becomes `return rollbackAndFail` | case 7 |
| M13 | an added await: `await Promise.resolve()` before relink | case 4's microtask snapshot |

M7 and M8 are re-run at the Phase 2 head against the moved code.

### Phase 2: move the transforms

Make the changes above, then run `bun run build` and commit the regenerated `auto-imports.d.ts`.

**Validation gate (after each phase):**

- **Commands:** `bun run test -- src/composables/`, `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`, and, in Phase 2, `bun run build`.
- **Pass criteria:**
  - Everything exits 0.
  - In Phase 2, only import lines change in `useFullBackupImport.test.ts`; no assertion, fixture or title does. Every other test file is byte-identical.
  - The regenerated `auto-imports.d.ts` names each moved global once, pointing at `full-backup-restore`. Its only other change is `RestoreData` in that module's type line.
  - `git grep -n "as never" apps/extension/src/composables/full-backup-restore.ts` lists only today's `:522` and `:523`, under their new line numbers.
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Layers:** lint, typecheck, unit and composition. The e2e lanes run in CI per the program gates; `backup-restore-sw-restart` and `passkey-backup` drive this path.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks.
   - It gets the no-over-engineering rule verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - It gets the comment-quality rule verbatim: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
   - It is asked specifically to diff each moved function's body against its original, ignoring whitespace and annotations.
2. **Opus pass** (MID): an independent read of the same diff, with the same asks.
3. **Fix loop:** triage each finding, fix, commit, log the round in `implementations-plan/harden-dedupe/lessons/arc-18-restore-wiring.md`, and resume the same session. Stop when a round has no material finding. At 5 rounds the arc is parked.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/18-restore-wiring`, stacked on `harden-dedupe`; the driver sets the parent at delivery. The PR opens ready once the loop converges and the local gates pass, and the e2e labels are added after it opens. It is squash-merged into `harden-dedupe` when the program gates are green. Code review: off.

## UI impact

None. No `.vue` or CSS file changes. The restore's statuses, stages and failure copy are unchanged and pinned.

## Drift left for the alignment arc

None found. The copies agree, and nothing here is user-visible.

## Follow-ups (for the program close)

- **The `${chainId}:${address}` scope key.** The moved stage 2a and relink build it at four sites. Once arc 12 lands, they could use `accountScopeKey` from `account/spec.ts`, which needs the two suites' `vi.mock` lists extended.
- **`RestoreData` overstates what is validated.** Its `profile` field is block-listed and unvalidated, and its `network` field is dead: a `network` slice is refused before any write.
- **The stale `restoreNetworksStage` global** in `auto-imports.d.ts` is generated-file hygiene, not behaviour.

## Decisions (delegated)

### Plan audit: Codex (GPT-6 Astra, xhigh) REVISE, Opus REVISE

Neither leg found a blocker. Both confirmed the move is verbatim and keeps one `await`; relink stays synchronous; the try/finally, rollback and disconnect order is intact; the type-only changes add or remove no validation; the trust gate is untouched; and nothing couples blockingly with arcs 12 or 13. Every finding was adopted:

1. **Codex: the empty-slice witness did not prove the non-empty gate.** With token results `[]`, a truthiness gate stays green. The empty case now resolves `undefined`, and M3 is that weakened gate.
2. **Codex: an added `await` is observable.** A microtask queued by the token client's `disconnect` lands before `appendErrors` once relink is awaited. The unobservability claim is gone, case 4 carries the observer, and M13 is the added `await`.
3. **Opus: pin `return await rollbackAndFail`.** Without the `await`, `finally` disconnects between rollback attempts. Adopted as case 7 and M12.
4. **Codex: M6 failed for the wrong reason.** `profileId` is unbound in the moved function, so the mutant raised a `ReferenceError`. It now passes `"new-id"`, and the red must come from case 1's `mock.calls` comparison.
5. **Both legs: M11's witness** is `useFullBackupImport.test.ts:512-536`, not `:1500`.
6. **Case 6:** the slice fixtures get distinguishable surviving rows.
7. **Opus: arc 12's `accountScopeKey` duplicates the moved key.** Not adopted here, since it would not be a verbatim move and the frozen mocks lack it. Recorded under Follow-ups.
8. **Wording.** The pinned throws are "reachable from service results". The other throwing reads are covered by source identity. The gate reads "only import lines change". The type imports are listed.
9. **Both legs: comments.** The tags and stage labels are dropped, one boundary invariant comment is added, the explanations stay, and the log prefix stays verbatim.
10. **Opus: `RestoreData` moves verbatim.** Its overstated fields go to Follow-ups.

### Asks

1. **The import-only test edit:** accepted. Both legs agreed.
2. **The three casts.** The legs split:
   - Codex: leave all three.
   - Opus: take `:343`, which sits in the function Phase 2 edits and is pure type erasure on an `any[]`.
   - **Call: take `:343`; leave `:522-523`,** which need chain-sync typing outside the finding.
