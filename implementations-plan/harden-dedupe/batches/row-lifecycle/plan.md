---
plan: harden-dedupe / row-lifecycle (arc 12 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/12-row-lifecycle, stacked on harden-dedupe
---

# row-lifecycle: one row-identity gate, one restore preamble, fenced account writes

Findings Q-03 (a, b, c without the config loop, d) and Q-27 (b, m, n) from `audit/quality/2026-09-30-dedup-high/`, plus bug B-12 from `audit/bugs/2026-09-30-ext-high/`. Every site lives under `apps/extension/src/wallet/services/`; paths below are relative to it. The dedup half changes no persisted byte, event, error text or refusal order. The fix half is B-12 and Q-03 (d)'s three-field patch gate, both admitted by the program's Behaviour rule, each with its own red-then-green test.

## Outcome & Quality Bar

- **For whom:** the next person who edits a row-lifecycle protocol. Today the row-identity gate, the restore preamble, the purge pipeline and the imported-key unseal are each typed out per site, and two copies have already drifted: `patchAccountField` checks two of the three identity fields, and `importAccount` has no deletion fence.
- **Excellent:**
  - Each shared step exists once: the identity gate, the restore profile-id guard, the hostile-row profile projection, the account-scope key, the auth-registry purge and settlement, the balance row↔token check, and the imported-key unseal.
  - A characterization suite, green on today's code, pins every site's refusal text, write and emit order, and survivors. Each guard has a named mutant that turns it red.
  - B-12 is closed: an import racing a profile deletion and a rename racing a chain purge or a profile purge leave no orphan or resurrected row.
- **Good enough:** the seven fenced commits (Q-03 a) keep their protocol inline (see below). Only their refusal is shared.

## Architecture & Implementation

Read on `harden-dedupe` at `1c0c67ad`. Recon's line numbers hold except where noted.

### Q-03 (d): row-identity gate, `rowMatchesKey`

- **Sites today**, each `row?.profileId === p && row.chainId === c && row.address === a`, in that order:
  - `account/service.ts:180` (`getAccount`, returns the row or `undefined`);
  - `:339` (`getAccountContract`, throws "unknown account address");
  - `:409` (`exportAccount`, same throw);
  - `account/imported-keys-repository.ts:28` (`get`).
  - **Drifted:** `:322` (`patchAccountField`) checks profileId and chainId only, then writes to `accountRowIdOf(account)`, the address the row body carries (`:327`).
- **What changes:** `account/spec.ts` gains `rowMatchesKey(row, profileId, chainId, address): row is T`, beside `accountRowId`, with today's expression and order. The four sites call it, with their own return or throw kept.
- **The patch site** adopts it in Phase 3 as the pre-cleared "three-field row gate". A row whose body names another address then returns `undefined` with no write and no emit, where today it is copied under the body's key and emitted. Restore writes rows under `accountRowIdOf(parsed)` (`:716`), so body and key disagree only after storage tampering: no realistic path changes. B-12 (b)'s per-row lock relies on it, because it confines a patch to the key it locked.

### Q-03 (b): account scopes and the auth-registry purge

- **`AccountScope` and `accountScopeKey(chainId, address)`** go in `account/spec.ts`. The key is `` `${chainId}:${address}` ``, injective because `chainId` is a number.
  - The type replaces the inline `{ chainId: number; address: string }` at `account/service.ts:811, 819, 837, 849`, `account/spec.ts:235`, `auth-registry/service.ts:512` and `token-balance/service.ts:574`.
  - The function replaces the template at `auth-registry/service.ts:515, 518, 533, 536` and `token-balance/service.ts:577, 581, 598`. It takes two values, not a scope object, so every property read (`s.chainId`, `raw.account`) stays at its call site under its own name, and the raw sites keep their `typeof` guards in front.
  - `incoming-transfer/service.ts:406, 438` carry `profileId` too and belong to incoming-arms; untouched.
- **`purgeMatchingLocked`**, private in `auth-registry/service.ts`. The three purges (`purgeForAccounts` `:512-538`, `purgeForProfile` `:541-557`, `purgeChain` `:561-577`) each run, under `this.lock`: typed filter → `purgeRows` (delete, then `onAuthwitDeleted`) → `purgeMalformedRows` (same log line) → `purgeStatuses`. The helper takes a strategy object `{ row, raw, status }` holding the three predicates. Each method keeps `ensureInitialized`, `purgeForAccounts`' empty-scope return and its `keys` set outside the lock, and calls `this.lock.withLock(() => this.purgeMatchingLocked(match))`.
  - **Same await shape:** `Lock.withLock` does `return await fn(...)` (`packages/wallet-core/src/utils/lock.ts:88`). Today `fn` is an async arrow whose body is the pipeline; afterwards `fn` returns the helper's promise, an async function with the same body. The tick count is identical. The callback must not be `async () => { await … }`, which adds one; this is a source-review note.
- **Token-balance purges keep their own mechanism** (fence before each delete, emit only for the row's own token), as the audit's verifier concluded. Only the scope type and key change there.

### Q-03 (c): restore preamble

- **`requireRestoreProfileId(profileId: unknown): asserts profileId is string`** goes in `restore-fence.ts`. It holds the `typeof … !== "string" || … .length === 0` check and the exact text "restore requires the created profile id". Sites: `token-balance/service.ts:681-683`, `auth-registry/service.ts:593-595`, `transaction/service.ts:533-535`. Each keeps one comment line on why the threaded id anchors the fence.
- **`restoreRowProfileId(row: unknown): unknown`** goes beside it: `(row as { profileId?: unknown } | null)?.profileId`. The sites call `rows.map(restoreRowProfileId)`: `contact/service.ts:287-290`, `account/service.ts:674-677` and `:766-769`, `token/service.ts:858-861`. The `.map` stays at the call site, so a non-array slice still throws the engine's TypeError naming the local (`accounts.map …`). The projection cannot throw for any input.
- **Left alone:**
  - `network/service.ts:268-275` validates the id with `z.string().min(1)` through `validateParams` and checks profile existence, a different refusal by design.
  - `config/service.ts:62-84`'s loop is excluded by the program.

### Q-03 (a): fenced commits keep their protocol; the refusal is shared

- **Sites today**, each assert → [liveness] → `set` → `isCurrent` re-check → compensating `delete` → throw `` `profile ${fence.profileId} deleted` ``:

  | site | lines | lock held | between assert and set | after the re-check |
  |---|---|---|---|---|
  | F1 `fpc.registerAndStoreProtocolFpc` | `fpc/service.ts:230-238` | discovery lock (caller) | `isNetworkLive` → "network deleted" | `return fpc` |
  | F2 `fpc.addFpc` | `:293-302` | `this.lock` | `isNetworkLive` → "network deleted" | `decorate`, emit `onFpcAdded` |
  | C `contact.addContact` | `contact/service.ts:116-123` | `this.lock` | none | emit `onContactAdded` |
  | D `dappSession.addDappSession` | `dapp-session/service.ts:204-210` | `this.lock` | none | emit `onDappSessionAdded` |
  | N1 `network.seedOneNetworkLocked` | `network/service.ts:317-322` | network lock (caller) | none | `return network` |
  | N2 `network.addNetwork` | `:485-491` | `this.lock` | none | emit `onNetworkAdded` |
  | T `token.persistToken` | `token/service.ts:412-422` | token lock | `isNetworkLive` → "network deleted" | second liveness leg `:427-430`, then `assertCurrentBeforeEmit` `:459-463` (same throw), emit |

- **What changes:** `profile/profile-deletion-state.ts` exports `profileDeletedError(profileId)`, which returns `new Error(\`profile ${profileId} deleted\`)`. The eight throws use it. Message, class and throw position are unchanged; the stack gains one frame.
- **Why the protocol stays inline.** Any async `fencedSet` adds at least one microtask between the post-write re-check and the next statement at every site: the emit (F2, C, D, N2), the liveness call (T), the caller's resume (F1, N1), or the lock release. A synchronous helper cannot await the compensating delete. Under the program's await rule, the code stays inline. Phase 1 pins every site's legs instead, which guards the drift the audit cares about (a dropped leg).

### Q-27 (b): auth-registry settlement, `settleRegistryTx`

- **Today:** `revokeAuthwits` (`auth-registry/service.ts:281-321`) and `setRegistryEnabled` (`:336-375`) both run: start task → try { `executeSendTransaction(request, { type: UI }, task, undefined, fence)` → `waitForTx(txHash, task)` → `nodeFor(network)` → `waitForTxProven` → sync → `task.complete()` } catch { `maybeRethrowAsRpcCancel`; `task.fail`; rethrow }. The request literal is `{ kind: "send_transaction", networkId, accountAddress, feeSettings, actions }` at both sites.
- **What changes:** one private `settleRegistryTx({ networkId, network, account, feeSettings, fence }, content, actions, syncAfter)`.
  - It starts the task from `content` (`RevokeAuthwitsContent(ids)` or the `StepContent`), then runs the try/catch verbatim.
  - Inside the try, before the send: `actions(getAuthRegistryAddress().toString())`. Both sites read the address inside the try today, so a throw from it still fails the task.
  - `syncAfter(node, task)` is a plain arrow returning `syncAuthwits(node, scope, task, authwits)` or `syncStatus(node, scope, task)`, so it adds no tick.
  - The callers keep their fence capture (first, before any read), the network read, the scope, the revoke id-ownership loop (`:265-279`) and the cap check.
- **Await shape:** every await inside is today's await. The helper's own frame resolves after `task.complete()` or `task.fail()`, the last side effect. The callers hold no lock and have no `finally`, so the RPC settles one tick later with the same event order: task broadcast, then RPC result.

### Q-27 (m): balance row↔token check, `rowMatchesItsToken`

- **Today**, eleven copies of `const t = map.get(row.token); t !== undefined && rowMatchesToken(row, t)` (or the `!t ||` negation) in `token-balance/service.ts`:
  - on `this.tokens`: `:135-136` (`isRowEmittable`), `:184-186`, `:200-203`, `:210-213`, `:239-241`, `:255-256`, `:551-552`, `:587-588`, `:658-659`;
  - on another map: `:330-333` (`pairTokens`) and `:671-672` (`owned`).
- **What changes:** `balance-identity.ts` gains `rowMatchesItsToken(row, tokens: ReadonlyMap<number, TokenIdentity>): boolean`, which returns `token !== undefined && rowMatchesToken(row, token)`.
  - **It returns a strict boolean.** The queue tests `isRowEmittable(row) === false` (`balance-job-queue.ts:214, 228, 378, 395`), so a `token && …` form returning `undefined` would let a foreign row through. Phase 1 pins it.
  - `:184` and `:210` keep `!balance ||` at the call site; token values are objects, so `!token` and `=== undefined` agree.
  - Every row reaching the helper is non-null: repo rows pass `TokenBalanceRawSchema` (`balance-repository.ts:26`), and the queue checks `if (!current) return` first. No engine text moves.
- `isSameTokenLive` (`:429-434`) compares token to token and stays.

### Q-27 (n): imported-key unseal and wipe, `unsealImportedKey`

- **Today:** `loadImportedAccountContract` (`account/service.ts:377-397`) and `exportAccount` (`:425-437`) each run unseal → `Buffer.from` copy → `GrumpkinScalar.fromBuffer` → wipe `skBytes`, `skCopy` and the DEK.
  - load wipes the DEK first, maps every non-`ImportedAccountUnusableError` throw to "signing key could not be recovered", and wipes after `fromSigningKey`;
  - export wipes the DEK last and lets errors propagate raw.
- **What changes:** one private `unsealImportedKey(dek, chainId, address, sealed): Promise<GrumpkinScalar>`. It owns all three wipes in its `finally`, including the DEK, which it consumes.
  - Load calls it first inside its existing `try`, which keeps the error mapping and loses its `finally`. Export calls it where its inner `try` was.
  - `fromBuffer` copies into a bigint (`@aztec-labs/foundation` `curves/bn254/field.js` `BaseField` constructor), so wiping `skCopy` before `fromSigningKey` cannot touch the scalar.
  - Both DEKs are caller-owned copies: `getProfileDek` and `exportImportedKeysDek` return fresh buffers.
- **Await shape:** one frame is added between the unseal and the next pure step (`fromSigningKey`, `buildAccountExport`). Neither method holds a lock, and no write, emit, task or shared buffer sits on either side. The wipes still run on every path, and the wipe order inside a `finally` is synchronous and unobservable. See Ask 2.

### B-12: the fix half (Phase 3)

- **(a) `importAccount` (`account/service.ts:458-526`) has no deletion fence.** `createAccountInternal` has one (`:249-253`, `:283`).
  - **Capture:** `const deletion = this.profileService.getDeletionState(); const epoch = deletion.capture(profileId)` right after `ensureInitialized`, before `getProfileDek` (`:469`).
  - **Assert twice:**
    - `deletion.assertCurrent(profileId, epoch)` immediately before the key-row write (`:499`), with no await between.
    - Again as the first statement inside the existing compensation `try` around the account-row write (`:512-517`), so a deletion that began during the key write rolls the key row back.
  - **No `isReserved` check is added.** `getProfileDek` refuses a reserved id under the facade lock (`profile/service.ts:1957-1963`), and `deleteProfile` reserves and bumps in one step under that lock (`:1486`). So a capture that lands after the bump is always followed by that refusal ("Invalid profile id"), today's text for a reserved profile.
  - The refusal is `assertCurrent`'s text.
- **(b) The chain purge and the profile purge delete account rows without the row lock** that `patchAccountField` holds (`:320`). A rename parked on its read writes the row back after `clearChainState` (`:150-159`) or `purgeForProfile` (`:631-635`) removed it. After a chain purge, the result is a visible imported account whose key row is gone ("signing key missing").
  - **Fix:** each row's delete (with its key-row delete in `clearChainState`) runs inside `this.tupleLocks.withLock(accountRowIdOf(account), …)`. Emit order per row is unchanged: delete, then `onAccountDeleted`, now after the lock is released.
  - **No deadlock:** the patch's critical section touches storage only and never takes the network, facade or tuple-type locks. `deleteNetwork` holds the network lock while waiting for a row lock, which nothing holds while waiting for the network lock. `importAccount` holds a type key (`${p}:${c}:1`), never a row key.
  - **Out of scope:** `reconcileImportedAccounts`' delete (`:852`) runs at restore finalize, for a profile no UI can rename yet. It is recorded as a follow-up.

### What stays

Every lock, fence capture point, liveness leg, emit, `finally`, return shape and error string not named above. Every RPC signature and `rpcMethods` list. Nothing in `packages/`, and no `.vue` or CSS.

### Complexity

`scripts/complexity-baseline/manifest.json` has no acceptance in any touched file. The helpers are flat. `importAccount` gains four statements and no branch (about 73 of 80 lines). `loadImportedAccountContract` and `exportAccount` shrink.

### Alternatives not taken

- **Async `fencedSet`** for Q-03 (a): it adds a microtask before the emit or the lock release (see above).
- **A `use` callback** for Q-27 (n), keeping the wipes after `fromSigningKey`: more frames, not fewer.
- **One purge helper shared by auth-registry and token-balance:** their mechanisms differ (fence-before-delete, own-token emit); the audit's verifier said the same.
- **For B-12 (b), a re-read in `patchAccountField`:** it narrows the window but cannot close it while the deletes skip the lock.

## Security & Adversarial Considerations

- **Who reaches this code:**
  - Popup RPCs: account create, import, rename, visibility, export; revoke and registry toggle.
  - A hostile backup, through every `restore` and `restoreImportedKeys`.
  - A storage writer, who can edit rows at rest.
  - Background cascades: the profile-deletion coordinator, the chain purge, the account purge subscribers.
  - No dApp reaches these services directly.
- **Per-site guard sets after the change**, each identical to today's except the two fixes:

  | site | guards today | after |
  |---|---|---|
  | `getAccount` / `getAccountContract` / `exportAccount` / repo `get` | profile, chain, address against the key | same, via `rowMatchesKey` |
  | `patchAccountField` | profile, chain | profile, chain, address (pre-cleared) |
  | the three restore preambles | non-empty string, exact text | same, via `requireRestoreProfileId` |
  | the four hostile-row projections | `?.` on any value, never throws | same, via `restoreRowProfileId` |
  | auth purges | profile-only / profile+chain / profile + scope tuple, each on rows, raw rows and statuses, under `this.lock` | same predicates passed per method, same lock |
  | token-balance purges | profile + scope tuple, fence before delete | same; only the key function |
  | the eleven balance checks | FK plus identity triple against the map named | same, strict boolean |
  | revoke / registry toggle | fence first, id ownership, cap, task fail on any throw | same; the ownership loop stays at the caller |
  | the two unseals | three wipes on every path | same three wipes, in the helper's `finally` |
  | the seven fenced commits | assert, liveness, set, re-check, compensate | unchanged inline |
  | `importAccount` | session DEK, address confirm, duplicate, l1 read before key write, compensation | plus the epoch capture and two asserts |
  | `clearChainState` / `purgeForProfile` typed pass | none against writers | the per-row lock |

- **What a consolidation could widen, and why it does not:**
  - `rowMatchesKey` keeps the strictest set (three fields) everywhere and adds the third at the drifted site.
  - `purgeMatchingLocked` takes each method's predicates verbatim. A test pins each method's survivors (sibling profile at the same address, same profile on another chain), so a swapped predicate is caught.
  - `settleRegistryTx` builds no actions itself. The revoke ids are owner-checked before it runs, and it passes the caller's fence unchanged.
- **Deletion fences and wipes keep their order:** delete-then-emit in every purge, the key row before the account row, the assert with no await before each write, and the wipes in `finally` on every path.
- **Engine-generated text:** no expression that malformed data can reach changes its local name. Property reads stay at the call sites, `.map` stays at the call sites, and the moved expressions read only codec-validated rows or `?.`-guarded values.
- **Secrets:** the unseal helper allocates the same two plaintext copies and wipes both. It returns the scalar, which today's export also keeps (`:418`). No log line changes.
- **A new liveness dependency:** the purges now wait for a rename in flight on the same row. A hung storage write would hold the purge; storage hangs are not a realistic path here, and `tupleLocks` already has no watchdog (`:298`).
- **npm surface:** none. No file in `packages/` changes.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `1c0c67ad`):

1. Every site sits at the lines above. A grep for `` profile ${…} deleted `` finds exactly the eight throws.
2. `Lock.withLock` returns `await fn(isCurrent)` (`lock.ts:85-88`), and `tupleLocks` is a `KeyedLock({ maxHoldMs: null })` (`account/service.ts:298`).
3. `getProfileDek` refuses a reserved id under `runExclusive` (`profile/service.ts:1957-1963`); `deleteProfile` phase 1 runs `beginDeletion` under the same lock (`:1467-1510`) and releases only after the purge (`:1512`, `:1526-1528`).
4. `EntityStorage.get` returns a decoded row or `undefined` (`packages/wallet-core/src/storage/entity_storage.ts:98-145, 182-187`).
5. The existing during-write tests (`contact/service.test.ts:456`, `token/service.test.ts:466, 485, 503`) match `/deleted/`, which also matches `assertCurrent`'s text. F1, F2, D, N1 and N2 have no during-write test.
6. `account/service.test.ts:594` pins the transplanted-row refusal at `:180, :339, :409` for an address mismatch only. Nothing pins the patch site or the repo `get`.
7. Neither purge path in `account/service.ts` takes `tupleLocks` today.

**Inferences:**

- Restore writes rows under `accountRowIdOf(parsed)` and `importedKeys.set` under `accountRowIdOf(row)`, so a body/key mismatch needs storage tampering. The patch gate is invisible on realistic paths.

**Asks** (for the plan panel):

1. **Q-03 (a) narrowed to the shared refusal.** Is the one-tick shift of an async `fencedSet` acceptable at any of the seven sites? The plan's answer is no, per the program's await rule.
2. **Q-27 (n)'s added frame.** It sits between two pure steps, with no lock, write, emit or task around it. Keep the helper, or keep both copies inline?
3. **B-12 (b) scope.** The plan locks `clearChainState` and `purgeForProfile`, the two the bug report names. The reconcile delete (`:852`) is left as a follow-up. Agree?

## Phases

### Phase 1: pin today's behaviour (test only)

Green on the unchanged code; one commit, which freezes these test files for Phase 2. Titles carry no counts. Wherever a refusal is pinned, its text is exact, not a regex.

1. **Fenced commits (Q-03 a).** For each of F1, F2, C, D, N1, N2 and T:
   - A deletion beginning during the row `set` gives exactly `profile p1 deleted`, a storage log of `set(key)` then `delete(key)`, no row afterwards, and no emit.
   - A deletion before the assert gives `assertCurrent`'s text, with no `set`.
   - T adds its last-network-check path (`assertCurrentBeforeEmit`).
   - Each existing `/deleted/` match is tightened to the exact string, and the five missing during-write tests are added.
2. **Row-identity gate (Q-03 d).** A body differing in profileId only, chainId only and address only reads as absent through `getAccount` and the repo `get`. The other two sites keep their existing address-only pin.
3. **Auth purges (Q-03 b).** One table over the three methods, seeded with in-scope rows, a sibling profile at the same address, the same profile on another chain, a malformed raw row in and out of scope, and statuses in and out. It asserts survivors and an ordered delete → `onAuthwitDeleted` log. Token-balance's scope-key cases are already pinned (`token-balance/service.test.ts:1225-1265`).
4. **Restore preamble (Q-03 c).**
   - The exact text for `""`, `undefined` and a number, at the three sites, with nothing written.
   - At the four projection sites: a batch of `null`, `5`, `{}` and one valid row restores the valid row and records the rest as `restoreError`. It never aborts.
5. **Settlement (Q-27 b).** For revoke and toggle:
   - **success:** the ordered collaborator log (task start → send, with the exact request, origin, task, `undefined` and fence → `waitForTx` → node → proven → sync → `task.complete`);
   - **failure:** a send rejection gives `task.fail` with that error, the rethrow, and no complete;
   - **cancel:** the rpc-cancel sentinel is converted.
6. **Balance checks (Q-27 m).** For each entry point (`getTokenBalance`, `getTokenBalances`, `refreshTokenBalance`, `requestBalanceRefresh`, `refreshAccountBalances`, the reconcile's `ensurePairs`, both purges' emits, the narrowed tx refresh, `backup`):
   - a matching row is served;
   - a dead-incarnation row at a live id is not;
   - a row whose token id is absent from the map is not.
   - Plus: a sync failure on a row whose token is absent writes no `syncFailure` (the strict-`false` contract).
7. **Unseal wipes (Q-27 n).** Spy on `zeroize`. On load's success, address-mismatch and unseal-throw paths, and export's success and unseal-throw paths:
   - the DEK, `skBytes` and a distinct `skCopy` are each wiped and all zero afterwards (set equality, not order);
   - load's error texts and export's raw error are exact.

**Mutation check** (applied by hand after Phase 2, then reverted):

| mutant | expected red |
|---|---|
| one site drops its re-check, its compensating delete, or uses another message | step 1, that site |
| `rowMatchesKey` drops any one field | step 2 |
| two auth purge predicates swapped, or the raw or status pass dropped | step 3 |
| the restore guard accepts `""` | step 4 |
| the projection loses `?.` | step 4 (slice aborts) |
| settlement completes before sync, skips `task.fail`, or passes a fresh fence | step 5 |
| `rowMatchesItsToken` returns `token && …` | step 6, the sync-failure row |
| one balance site checks `map.has` only | step 6, that entry point |
| `accountScopeKey` drops the chain | `token-balance/service.test.ts:1235` and step 3 |
| the unseal helper skips a wipe | step 7 |

### Phase 2: the dedup, test files untouched

1. `restore-fence.ts` helpers and their seven call sites (Q-03 c).
2. `rowMatchesKey` at the four sites; `AccountScope` and `accountScopeKey` (Q-03 d, b).
3. `purgeMatchingLocked` and `settleRegistryTx` (Q-03 b, Q-27 b).
4. `rowMatchesItsToken` at the eleven sites (Q-27 m).
5. `unsealImportedKey` (Q-27 n).
6. `profileDeletedError` at the eight throws (Q-03 a).

### Phase 3: the fixes, each commit with its red-then-green test

The red is proven by running the new test against the commit's parent in a scratch worktree (lessons: take the old copy from the base SHA), and is logged.

1. **The patch site adopts `rowMatchesKey`.** Test: B's row under A's key; `changeAccountName` for A returns `undefined`, writes nothing, emits nothing. Today it writes B's key and emits.
2. **B-12 (b), per-row lock in both purges.** Tests: seed an imported account and its key row, park the rename after its read returns, then run `clearChainState` (and, separately, `purgeForProfile`), release, and settle both.
   - After: no account row and no key row.
   - Today: the account row is back and the key row is gone.
   - Mutants: drop either lock; key the lock by type instead of row.
3. **B-12 (a), the import fence.** Tests on a shared `ProfileDeletionState`:
   - **(i)** deletion begins while `getL1ChainIdStored` is parked: the exact `assertCurrent` text, and no `set` on either root;
   - **(ii)** deletion begins during the key-row write: the key row rolled back, no account row;
   - **(iii)** deletion begins and releases while `getProfileDek` is parked: rejected (the capture-order pin);
   - **control:** with no deletion, both rows land.
   - Mutants: drop either assert; capture after `getProfileDek`; the second assert outside the compensation `try`.

**Validation gate** (after Phase 1, after each Phase 2 and 3 commit, and at the end):

- **Commands:**
  - the touched suites: `bun run --cwd apps/extension test src/wallet/services/{account,auth-registry,token-balance,contact,dapp-session,fpc,network,token,transaction}/ src/wallet/services/restore-fence.test.ts`
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`
  - at the end: `implementations-plan/harden-dedupe/tools/scoped-dup.sh`, before and after
- **Pass criteria:**
  - Every command exits 0.
  - Phase 2 leaves every test file byte-identical.
  - Each Phase 3 test is red on its parent and green on its commit.
  - The mutation table behaves as written.
  - The scoped clone count does not rise.
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Layers:** unit and composition locally. Smoke and network e2e run on both browsers in CI, per the program gates.

## Post-implementation

1. **Audit of the arc diff:** Codex (GPT-6 Astra, xhigh) plus an independent Opus pass, as a MID batch requires.
   - **Asks:** adversarial, assumption-attack and implementation-critique. Both legs must confirm the per-site guard table and the await-shape claims.
   - **No-over-engineering rule, verbatim:** "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - **Comment-quality rule, verbatim:** "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:**
   - Triage each finding, fix it and commit.
   - Log the round in this arc's file under the program's `lessons/`.
   - Resume the same session.
   - Stop when a round has no material finding. At 5 rounds, park the arc.
3. **Delivery:**
   - Push, open a ready PR against its parent in the gh stack, then add both e2e labels.
   - The PR body names the two behaviour changes: B-12, and the patch gate under the pre-cleared route.
   - When the program gates are green on the head SHA, with the run attempt and the shards that ran recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/12-row-lifecycle`, stacked on `harden-dedupe`; the driver sets the parent at delivery. Code review: off.

**Seams with arcs in build:**

- **network-endpoints (arc 9)** edits `network/service.ts` around `:135`, `:337`, `:412` and `:584` onward, plus its import list. This arc touches only the throw lines `:321` and `:490` and adds one import. The hunks do not overlap; whichever lands second resolves the import block. Arc 9 also edits `incoming-transfer/service.ts`, which this arc leaves alone.
- **profile-rows (arc 13)** owns `profile/service.ts` and `session-manager.ts`, which this arc does not edit. The seams are contracts this arc reads:
  - `getProfileDek`'s reserved refusal and `deleteProfile`'s phase-1 ordering (B-12 a's capture argument);
  - `getProfileDek` and `exportImportedKeysDek` returning fresh copies (the unseal helper's DEK wipe);
  - `consumeDekRewrapContext`'s signature (`restoreImportedKeys`).

  Arc 13 keeps all three, by its own plan. If either arc changes one, the other's tests catch it: Phase 3 (iii) here; its stash pins there.
- **incoming-arms (arc 14)** owns `incoming-transfer/service.ts`; its `:406, :438` scope types stay there.
- **estimate-reuse (arc 11)** may touch `transaction/service.ts`. This arc changes only `:533-535` there.

## UI impact

None. No `.vue`, CSS or copy changes. The B-12 refusals are `assertCurrent`'s existing text on paths that today end in an orphan or resurrected row.

## Drift left for the alignment arc

No drift among the deduped copies beyond the two fixed above. Observed, kept, and recorded as program follow-ups:

1. **Three texts for "the profile is being deleted":** the compensated `profile X deleted`, `assertCurrent`'s `is being deleted — write rejected (epoch a → b)`, and the restore fence's `is being deleted or was not captured…`. A popup can show any of them.
2. **No chain-liveness fence on account writes.** `createAccountInternal` and `importAccount` can land a row after a concurrent chain purge has taken its snapshot. Pre-existing, outside B-12.
3. **`reconcileImportedAccounts`' delete skips the row lock** (`:852`). Unreachable from the UI today (see Ask 3).
4. **The fenced commits differ in their liveness legs** (F1, F2 and T check the network; C, D, N1 and N2 have no parent to check; T re-checks after the write). This is intentional per recon, and recorded only.

## Decisions (delegated)
