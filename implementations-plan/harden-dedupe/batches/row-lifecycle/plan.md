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

Findings Q-03 (a, b, c without the config loop, d) and Q-27 (m) from `audit/quality/2026-09-30-dedup-high/`, plus bug B-12 from `audit/bugs/2026-09-30-ext-high/`. Q-27 (b) and (n) were planned and then deferred by the plan audit (see Deferred). Every site lives under `apps/extension/src/wallet/services/`; paths below are relative to it unless they start with `apps/` or `packages/`.

The dedup half changes no persisted byte, event, error text, refusal order or await shape. The fix half is B-12 and Q-03 (d)'s three-field patch gate, both admitted by the program's Behaviour rule, each with its own red-then-green test.

## Outcome & Quality Bar

- **For whom:** the next person who edits a row-lifecycle protocol. Today the row-identity gate, the restore preamble, the auth purge pipeline and the balance row↔token check are typed out per site, and two copies have already drifted: `patchAccountField` checks two of the three identity fields, and `importAccount` has no deletion fence.
- **Excellent:**
  - Each shared step exists once: the identity gate, the restore profile-id guard, the hostile-row profile projection, the account-scope key, the auth-registry purge, the balance row↔token check, and the compensated-write refusal.
  - A characterization suite, green on today's code, pins each site's refusal text, write and emit order, and survivors, to the extent the mutant table below proves.
  - B-12 is closed for the paths the bug report names: an import racing a profile deletion, and a rename racing a chain purge or a profile purge, leave no orphan or resurrected row. `reconcileImportedAccounts`' unlocked delete stays open as a named follow-up.
- **Good enough:** the seven fenced commits keep their protocol inline; only their refusal is shared. Revoke and toggle settlement, and the two imported-key unseal blocks, stay inline.

## Architecture & Implementation

Read on `harden-dedupe` at `1c0c67ad`.

### Q-03 (d): row-identity gate, `rowMatchesKey`

- **Sites today**, each `account?.profileId === p && account.chainId === c && account.address === a`, in that order, on a local named `account`:
  - `account/service.ts:180` (`getAccount`, returns the row or `undefined`);
  - `:339` (`getAccountContract`, throws "unknown account address");
  - `:409` (`exportAccount`, same throw).
  - **Drifted:** `:322` (`patchAccountField`) checks profileId and chainId only, then writes to `accountRowIdOf(account)`, the address the row body carries (`:327`).
  - **Inline, not adopted:** `account/imported-keys-repository.ts:28` uses the local `row`.
- **What changes:** `account/spec.ts` gains `rowMatchesKey(account, profileId, chainId, address): account is T`, beside `accountRowId`. It holds today's expression and order, and its parameter is named `account`. The three sites call it, with their own return or throw kept.
- **Why the parameter name matters.** Account RPC arguments are not schema-validated: `BaseService.invoke` spreads them (`packages/extension-messaging/src/core/base-service.ts:126`). With `profileId` omitted and no row, `account?.profileId === profileId` is `undefined === undefined`, and the next read throws an engine TypeError that names the local. Bun and Firefox name it, so the helper keeps that name and the expression text, and the repo's `row` site keeps its expression inline. Phase 1 pins the omitted-argument text at each adopting site against a reference expression that binds the same name. No validation is added.
- **The patch site** adopts it in Phase 3 as the pre-cleared "three-field row gate". A row whose body names another address then returns `undefined` with no write and no emit, where today it is copied under the body's key and emitted.
  - Restore writes rows under `accountRowIdOf(parsed)` (`:716`), so body and key disagree only after storage tampering.
  - Both UI callers pass all three fields from live state (`apps/extension/src/stores/app.store.ts:386, 410`).
  - B-12 (b)'s per-row lock relies on the gate, because it confines a patch to the key it locked.
  - The patch's negated form (`!rowMatchesKey(account, …)`) reaches `account.chainId` in the same case, so the omitted-argument text holds there too.

### Q-03 (b): account scopes and the auth-registry purge

- **`AccountScope` and `accountScopeKey(chainId, address)`** go in `account/spec.ts`. The key is `` `${chainId}:${address}` ``, injective because `chainId` is a number.
  - The type replaces the inline `{ chainId: number; address: string }` at `account/service.ts:811, 819, 837, 849`, `account/spec.ts:235`, `auth-registry/service.ts:512` and `token-balance/service.ts:574`.
  - The function replaces the template at `auth-registry/service.ts:515, 518, 533, 536` and `token-balance/service.ts:577, 581, 598`. It takes two values, so every property read (`s.chainId`, `raw.account`) stays at its call site under its own name, and the raw sites keep their `typeof` guards in front.
  - `incoming-transfer/service.ts:406, 438` carry `profileId` too and belong to incoming-arms; untouched.
- **`purgeMatchingLocked`**, private in `auth-registry/service.ts`. The three purges (`purgeForAccounts` `:512-538`, `purgeForProfile` `:541-557`, `purgeChain` `:561-577`) each run, under `this.lock`: typed filter → `purgeRows` (delete, then `onAuthwitDeleted`) → `purgeMalformedRows` (same log line) → `purgeStatuses`.
  - The helper takes a strategy object `{ row, raw, status }` with the three predicates.
  - Each method keeps `ensureInitialized`, `purgeForAccounts`' empty-scope return and its `keys` set outside the lock, and calls `this.lock.withLock(() => this.purgeMatchingLocked(match))`.
  - **Same await shape:** `Lock.withLock` does `return await fn(...)` (`packages/wallet-core/src/utils/lock.ts:88`). Today `fn` is an async arrow whose body is the pipeline; afterwards `fn` returns the helper's promise, an async function with the same body. Both audit legs confirmed the tick count is identical. A one-line comment at the call says the wrapper must stay a plain arrow, because an async wrapper delays the lock release by a tick.
- **The token-balance purges keep their own mechanism** (fence before each delete, emit only for the row's own token). Only the scope type and key change there.

### Q-03 (c): restore preamble

- **`requireRestoreProfileId(profileId: unknown): asserts profileId is string`** goes in `restore-fence.ts`. It holds the `typeof … !== "string" || … .length === 0` check and the exact text "restore requires the created profile id". Sites: `token-balance/service.ts:681-683`, `auth-registry/service.ts:593-595`, `transaction/service.ts:533-535`.
- **`restoreRowProfileId(row: unknown): unknown`** goes beside it: `(row as { profileId?: unknown } | null)?.profileId`. Sites call `rows.map(restoreRowProfileId)`: `contact/service.ts:287-290`, `account/service.ts:674-677` and `:766-769`, `token/service.ts:858-861`. The `.map` stays at the call site, so a non-array slice still throws the engine's TypeError naming the local. The projection cannot throw for any input.
- **Left alone:**
  - `network/service.ts:268-275` validates with `z.string().min(1)` through `validateParams` and checks existence, a different refusal by design.
  - `config/service.ts:62-84`'s loop is excluded by the program.

### Q-03 (a): fenced commits keep their protocol; the refusal is shared

- **Sites today**, each assert → [liveness] → `set` → `isCurrent` re-check → compensating `delete` → throw `` `profile ${fence.profileId} deleted` ``:

  | site | lines | lock held | between assert and set | after the re-check |
  |---|---|---|---|---|
  | F1 `fpc.registerAndStoreProtocolFpc` | `fpc/service.ts:230-238` | discovery lock (caller) | `isNetworkLive` → "network deleted" | `return fpc`; the caller logs and swallows a throw (`:168-172`) |
  | F2 `fpc.addFpc` | `:293-302` | `this.lock` | `isNetworkLive` → "network deleted" | `decorate`, emit `onFpcAdded` |
  | C `contact.addContact` | `contact/service.ts:116-123` | `this.lock` | none | emit `onContactAdded` |
  | D `dappSession.addDappSession` | `dapp-session/service.ts:204-210` | `this.lock` | none | emit `onDappSessionAdded` |
  | N1 `network.seedOneNetworkLocked` | `network/service.ts:317-322` | network lock (caller) | none | `return network`; both callers log and swallow a throw (`:241-243`, `:287-289`) |
  | N2 `network.addNetwork` | `:485-491` | `this.lock` | none | emit `onNetworkAdded` |
  | T `token.persistToken` | `token/service.ts:412-422` | token lock | `isNetworkLive` → "network deleted" | second liveness leg `:427-430`, then `assertCurrentBeforeEmit` `:459-463` (same throw), emit |

- **What changes:** `profile/profile-deletion-state.ts` exports `profileDeletedError(profileId)`, which returns `new Error(\`profile ${profileId} deleted\`)`. The eight throws use it. Message, class and throw position are unchanged; the stack gains one frame.
- **Why the protocol stays inline:** any async `fencedSet` adds a microtask between the post-write re-check and the next statement at every site (the emit, the liveness call, the caller's resume, or the lock release). A synchronous helper cannot await the compensating delete.

### Q-27 (m): balance row↔token check, `rowMatchesItsToken`

- **Today**, eleven copies of `const t = map.get(row.token); t !== undefined && rowMatchesToken(row, t)` (or the `!t ||` negation) in `token-balance/service.ts`:
  - on `this.tokens`: `:135-136` (`isRowEmittable`), `:184-186`, `:200-203`, `:210-213`, `:239-241`, `:255-256`, `:551-552`, `:587-588`, `:658-659`;
  - on another map: `:330-333` (`pairTokens`) and `:671-672` (`owned`).
- **What changes:** `balance-identity.ts` gains `rowMatchesItsToken(row, tokens): boolean`, which returns `token !== undefined && rowMatchesToken(row, token)`.
  - **It returns a strict boolean.** The queue tests `isRowEmittable(row) === false` (`balance-job-queue.ts:214, 228, 378, 395`).
  - `:184` and `:210` keep `!balance ||` at the call site.
  - Every row reaching the helper is non-null: repo rows pass `TokenBalanceRawSchema` (`balance-repository.ts:26`), and the queue checks `if (!current) return` first.
- `isSameTokenLive` (`:429-434`) compares token to token and stays.

### B-12: the fix half (Phase 3)

- **(a) `importAccount` (`account/service.ts:458-526`) has no deletion fence**, where `createAccountInternal` has one (`:249-253`, `:283`). Everything below stays inside the outer `try { … } finally { zeroize(dek) }`:
  1. **Capture:** `const deletion = this.profileService.getDeletionState(); const epoch = deletion.capture(profileId)` right after `ensureInitialized`, before `getProfileDek` (`:469`), under a one-line comment.
  2. **Assert before the key row:** `deletion.assertCurrent(profileId, epoch)` immediately before the key-row write (`:499`), with no await between.
  3. **Assert, write, re-check the account row.** Inside the existing compensation `try` around the account-row write (`:512-517`): assert; `set`; then, if `!deletion.isCurrent(profileId, epoch)`, delete the account row and `throw profileDeletedError(profileId)`.
     - The catch then rolls the key row back and rethrows, as it does for a write error today.
     - The re-check closes the window in which both asserts pass, then the deletion purges the key and snapshots the accounts before the account write lands. Without it, an orphan account row and an `onAccountAdded` would follow.
  - **No `isReserved` check is added.** `getProfileDek` refuses a reserved id under the facade lock (`profile/service.ts:1957-1963`), and `deleteProfile` reserves and bumps in one step under that lock (`:1486`). A capture that lands after the bump is therefore always followed by a refusal: "Invalid profile id" while reserved, or "Profile locked" from `SessionManager.getDek` (`profile/session-manager.ts:259-263`) once phase 3 has released the id. Test (iii) is defence in depth for the capture order.
  - **Refusals:** `assertCurrent`'s text before a write, and `profile <id> deleted` after a compensated account write.
- **(b) The chain purge and the profile purge delete account rows without the row lock** that `patchAccountField` holds (`:320`). A rename parked on its read writes the row back after `clearChainState` (`:150-159`) or `purgeForProfile` (`:631-635`) removed it.
  - **Fix:** each row's delete (with its key-row delete in `clearChainState`) runs inside `this.tupleLocks.withLock(accountRowIdOf(account), …)`.
  - **Events:** `clearChainState`'s `onAccountDeleted` now fires after the lock's `finally`, not straight after the deletes, with order per row unchanged. `purgeForProfile` stays silent.
  - **No deadlock** (both legs): the patch's critical section touches storage only and never takes the network, facade or type-keyed locks. `importAccount` holds a type key (`${p}:${c}:1`), never a row key.
  - **`tupleLocks` growth** (one lazily created `Lock` per key, never evicted; `packages/wallet-core/src/utils/keyed-lock.ts:66-72`) gains purged-row keys and is deliberately not "fixed" here.
  - **Left open:** `reconcileImportedAccounts`' delete (`:852`). It is an exposed RPC (`:64`) with no finalize-only guard, so a trusted-popup call can race a rename. It is recorded as a named B-12 instance deliberately left open (Deferred).

### Comment fixes, in lines this arc touches

- Provenance is trimmed and the constraints are kept: `account/service.ts:296` ("Q-08 audit"), `:422` ("audit LOW-2"), `:616` ("Relocated from…"). At `auth-registry/service.ts:315` and its twin `:369`, "Same conversion done by `executeTransfer`" goes.
- The import fence gets one line with no tags, so `importAccount` stays at or under 80 lines.

### What stays

Every lock, fence capture point, liveness leg, emit, `finally`, return shape and error string not named above. Every RPC signature and `rpcMethods` list. Nothing in `packages/`, and no `.vue` or CSS. Revoke and toggle settlement, and both unseal blocks, line for line.

### Complexity

`scripts/complexity-baseline/manifest.json` has no acceptance in any touched file. The helpers are flat. `importAccount` gains no branch beyond the re-check's `if`, and is measured against the 80-line cap in Phase 3.

### Alternatives not taken

- **An async `fencedSet`** for Q-03 (a): it adds a microtask before the emit or the lock release.
- **One purge helper shared by auth-registry and token-balance:** their mechanisms differ.
- **For B-12 (b), a re-read in `patchAccountField`:** it narrows the window but cannot close it while the deletes skip the lock.

## Security & Adversarial Considerations

- **Who reaches this code:**
  - popup RPCs: account create, import, rename, visibility, export, reconcile; revoke and registry toggle;
  - a hostile backup, through every `restore` and `restoreImportedKeys`;
  - a storage writer, who can edit rows at rest;
  - background cascades: the deletion coordinator, the chain purge, the account purge subscribers.

  No dApp reaches these services directly.
- **Per-site guard sets after the change**, each identical to today's except the two fixes:

  | site | guards today | after |
  |---|---|---|
  | `getAccount` / `getAccountContract` / `exportAccount` | profile, chain, address against the key | same, via `rowMatchesKey` (same local name) |
  | repo `get` | profile, chain, address | unchanged inline |
  | `patchAccountField` | profile, chain | profile, chain, address (pre-cleared) |
  | the three restore preambles | non-empty string, exact text | same, via `requireRestoreProfileId` |
  | the four hostile-row projections | `?.` on any value | same, via `restoreRowProfileId` |
  | auth purges | profile-only / profile+chain / profile + scope tuple, each on rows, raw rows and statuses, under `this.lock` | same predicates per method, same lock, same ticks |
  | token-balance purges | profile + scope tuple, fence before delete | same; only the key function |
  | the eleven balance checks | FK plus identity triple against the map named | same, strict boolean |
  | the seven fenced commits | assert, liveness, set, re-check, compensate | unchanged inline |
  | revoke / toggle, the two unseals | — | unchanged inline |
  | `importAccount` | session DEK, address confirm, duplicate, l1 read before key write, compensation | plus capture, two asserts, post-write re-check |
  | `clearChainState` / `purgeForProfile` typed pass | none against writers | the per-row lock |

- **What a consolidation could widen, and why it does not:**
  - `rowMatchesKey` keeps the strictest set everywhere and adds the third field at the drifted site.
  - `purgeMatchingLocked` takes each method's predicates verbatim. Phase 1 pins each method's survivors: a sibling profile at the same address, the same profile on another chain, and the same profile and chain at another address.
- **Deletion fences and wipes keep their order:** delete-then-emit in every purge, key row before account row, no await between each assert and its write, the account row compensated before the key row, and the DEK wiped in the outer `finally` on every new refusal path.
- **Engine-generated text:** no expression that malformed data can reach changes its local name (see `rowMatchesKey`). Property reads and `.map` calls stay at their call sites.
- **A new liveness dependency:** a purge now waits for a rename in flight on the same row; `tupleLocks` already has no watchdog (`:298`).
- **npm surface:** none.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `1c0c67ad`):

1. Every site sits at the lines above. A grep for `` profile ${…} deleted `` finds exactly the eight throws.
2. `Lock.withLock` returns `await fn(isCurrent)` (`lock.ts:85-88`), and `tupleLocks` is a `KeyedLock({ maxHoldMs: null })` (`account/service.ts:298`).
3. `getProfileDek` refuses a reserved id under `runExclusive` (`profile/service.ts:1957-1963`). `deleteProfile` phase 1 runs `beginDeletion` under the same lock (`:1467-1510`) and releases only after the purge (`:1512`, `:1526-1528`).
4. `EntityStorage.get` returns a decoded row or `undefined` (`packages/wallet-core/src/storage/entity_storage.ts:98-145, 182-187`).
5. The existing deletion tests match `/deleted/`, which also matches `assertCurrent`'s text: `contact/service.test.ts:469`, `token/service.test.ts:480, 497, 536`, `network/service.test.ts:114, 197`. F1, F2, D and N2 have no during-write test.
6. `account/service.test.ts:594` pins the transplanted-row refusal at `:180, :339, :409` for an address mismatch only.
7. Neither purge path in `account/service.ts` takes `tupleLocks` today.

**Cross-arc contracts** (profile-rows owns those files):

- **`SessionManager.getDek` returns a fresh copy:** no test pins it. Phase 1 adds one to `profile/session-manager.test.ts`, which profile-rows does not edit.
- **`getProfileDek` refuses a reserved id with "Invalid profile id":** no test pinned it. Profile-rows did not take the handoff, so this arc adds the pin to `profile/service.integration.test.ts` after code review round 1.
- **"A locked profile has no DEK"** is pinned at `profile/service.integration.test.ts:2656-2664`.

**Inferences:**

- The patch gate is invisible on realistic paths (restore and import write under the body's own key, and the UI passes all three fields).

**Asks:** resolved by the plan panel. See Plan audit.

## Phases

### Phase 1: pin today's behaviour (test only)

Green on the unchanged code; one commit, which freezes these test files for Phase 2. Refusals are pinned by exact text.

1. **Fenced commits (Q-03 a).** For each of F1, F2, C, D, N1, N2 and T:
   - A deletion beginning during the row `set` gives an ordered storage log of `set(key)` then `delete(key)`, no row afterwards, and no emit.
   - At the public call, the exact text `profile p1 deleted` for F2, C, D, N2 and T. F1 and N1 swallow the inner throw, so their exact text is asserted through the logger seam (`logError`'s error argument) alongside the storage log.
   - T: nothing is written (no `set` on the token root) when the deletion precedes the assert, and the last-network-check path (`assertCurrentBeforeEmit`) gives the exact text.
   - The existing tests listed in Fact 5 are tightened to exact strings. N1's are strengthened in place rather than duplicated.
2. **Row-identity gate (Q-03 d).**
   - A body differing in profileId only, in chainId only, and in address only reads as absent through `getAccount`.
   - **Omitted arguments:** `getAccount`, `getAccountContract`, `exportAccount` and `changeAccountName` called with `profileId` missing and no row. Each rejects with exactly the message of a reference expression `account.chainId` on an `undefined` local named `account`, evaluated in the test on the same engine.
3. **Auth purges (Q-03 b).** One table over the three methods. Fixtures:
   - in-scope rows;
   - a sibling profile at the same address;
   - the same profile on another chain;
   - the same profile and chain at another address;
   - a malformed raw row in scope and one out of scope;
   - statuses in scope and out.

   It asserts the survivors and an ordered delete → `onAuthwitDeleted` log. Token-balance's scope cases are already pinned (`token-balance/service.test.ts:1225-1265`).
4. **Restore preamble (Q-03 c).**
   - The exact text for `""`, `undefined` and a number, at the three sites, with nothing written.
   - At the four projection sites, a batch of `null`, `5`, `{}` and one valid row restores the valid row and records the rest as `restoreError`. It never aborts.
5. **Revoke and toggle (kept inline; pinned for the follow-up).**
   - The cap and each of the three ownership checks (profile, chain, account) refuse with their exact text, start no task and send nothing.
   - On success, the ordered collaborator log (send with the exact request and fence → `waitForTx` → proven → sync → `complete`).
   - A send failure gives `fail`. A cancellation sentinel gives `cancel` and `JobCancelledError`, never `fail` or `complete`.
6. **Balance checks (Q-27 m).** For each entry point (`getTokenBalance`, `getTokenBalances`, `refreshTokenBalance`, `requestBalanceRefresh`, `refreshAccountBalances`, the reconcile's ensure, both purges' emits, the narrowed tx refresh, `backup`):
   - a matching row is served;
   - a dead-incarnation row at a live id is not;
   - a row whose token id is absent from the map is not.
   - Plus: a sync failure on a row whose token is absent writes no `syncFailure`.
7. **Unseal blocks (kept inline; pinned for the follow-up).** A spy on `zeroize` and an ordered log of use and wipe.
   - **Load's success path,** with `fromSigningKey` parked: no wipe happens until it resolves. Then DEK → `skBytes` → `skCopy`.
   - **Load's other paths:** address mismatch, and a scalar-conversion failure from a non-canonical key, each wipe in that order, with exact error texts.
   - **Export:** `skBytes` → `skCopy` → DEK right after the scalar is built, before the envelope.
   - **An unseal rejection** wipes only the DEK; no other buffer exists yet.
8. **Cross-arc:** `SessionManager.getDek` returns a distinct buffer per call; zeroing one leaves the next non-zero.

**Mutation check** (applied by hand after Phase 2 or 3, then reverted). Only the guards listed here are claimed as mutation-proven:

| mutant | expected red |
|---|---|
| any fenced site drops its re-check or its compensating delete | step 1, that site |
| any fenced site throws another message | step 1, that site (F1 and N1 via the logger seam) |
| `rowMatchesKey` drops any one field | step 2 |
| `rowMatchesKey`'s parameter renamed | step 2, omitted-argument text (Bun) |
| two auth purge predicates swapped, or the raw or status pass dropped | step 3 |
| `purgeForAccounts` predicate loses the chain | step 3, other-chain survivor |
| the restore guard accepts `""` | step 4 |
| the projection loses `?.` | step 4 (slice aborts) |
| `rowMatchesItsToken` returns `token && …` | step 6, the sync-failure row |
| one balance site checks `map.has` only | step 6, that entry point |
| `accountScopeKey` drops the chain | `token-balance/service.test.ts:1235`, step 3 |
| the patch gate reverted to two fields | Phase 3.1 |
| either purge lock dropped, or keyed by type | Phase 3.2 |
| either import assert dropped, the re-check dropped, or the capture moved after `getProfileDek` | Phase 3.3 |

### Phase 2: the dedup, test files untouched

1. `restore-fence.ts` helpers and their seven call sites (Q-03 c).
2. `rowMatchesKey` at the three sites; `AccountScope` and `accountScopeKey` (Q-03 d, b).
3. `purgeMatchingLocked` (Q-03 b).
4. `rowMatchesItsToken` at the eleven sites (Q-27 m).
5. `profileDeletedError` at the eight throws (Q-03 a), plus the comment trims.

### Phase 3: the fixes, each commit with its red-then-green test

The red is proven by running the new test against the commit's parent in a scratch worktree, and logged.

1. **The patch site adopts `rowMatchesKey`.** Test: B's row under A's key; `changeAccountName` for A returns `undefined`, writes nothing and emits nothing.
2. **B-12 (b), per-row lock in both purges.** Tests: seed an imported account and its key row. Park the rename after its read returns, then run `clearChainState` (and, separately, `purgeForProfile`), release, and settle both. Afterwards there is no account row and no key row.
3. **B-12 (a), the import fence.** Tests on a shared `ProfileDeletionState`:
   - **(i)** deletion begins while `getL1ChainIdStored` is parked: exact `assertCurrent` text, no `set` on either root;
   - **(ii)** deletion begins during the key-row write: the key row rolled back, no account row;
   - **(iv)** deletion begins and releases during the account-row write itself: exact `profile p1 deleted`, both rows gone, no `onAccountAdded`;
   - **(iii)** deletion begins and releases while `getProfileDek` is parked: rejected (defence in depth);
   - **control:** with no deletion, both rows land.
   - Each refusal path asserts the buffer `getProfileDek` returned is all zero afterwards.

**Validation gate** (after Phase 1, after each Phase 2 and 3 commit, and at the end):

- **Commands:**
  - the touched suites under `apps/extension/src/wallet/services/`
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`
  - at the end: `implementations-plan/harden-dedupe/tools/scoped-dup.sh`, before and after
- **Pass criteria:**
  - Every command exits 0.
  - Phase 2 leaves every test file byte-identical.
  - Each Phase 3 test is red on its parent and green on its commit.
  - The mutation table behaves as written.
  - The scoped clone count does not rise.
- **Screenshots:** none; no `.vue` or CSS file changes.

## Post-implementation

1. **Audit of the arc diff:** Codex (GPT-6 Astra, xhigh) plus an independent Opus pass.
   - **Asks:** adversarial, assumption-attack and implementation-critique, including the per-site guard table and the await-shape claims.
   - **No-over-engineering rule, verbatim:** "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - **Comment-quality rule, verbatim:** "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:** triage, fix, commit, and log each round in this arc's file under the program's `lessons/`. Stop when a round has no material finding. At 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the gh stack, then add both e2e labels. The PR body lists the behaviour changes:
   - B-12 (a): new refusals on a racing import;
   - B-12 (b): purges wait for a rename on the same row, and `clearChainState`'s `onAccountDeleted` fires after the lock's release;
   - the pre-cleared patch gate.

   When the program gates are green on the head SHA, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job.

## Delivery

One arc, `hd/12-row-lifecycle`, stacked on `harden-dedupe`; the driver sets the parent at delivery. Code review: off.

**Seams with arcs in build:**

- **network-endpoints (arc 9)** edits `network/service.ts` around `:135`, `:337`, `:412` and `:584` onward, plus its import list. This arc touches only the throw lines `:321` and `:490` and adds one import. Whichever lands second resolves the import block.
- **profile-rows (arc 13)** owns `profile/service.ts`, `session-manager.ts` and `service.integration.test.ts`. This arc adds one test to `service.integration.test.ts` and edits no source there. It relies on three contracts:
  - `getProfileDek`'s reserved refusal (pinned here; see Assumptions);
  - `SessionManager.getDek`'s fresh copy (pinned here in `session-manager.test.ts`);
  - `consumeDekRewrapContext`'s signature (type-checked).
- **incoming-arms (arc 14)** owns `incoming-transfer/service.ts`.
- **estimate-reuse (arc 11)** may touch `transaction/service.ts`. This arc changes only `:533-535` there.

## UI impact

None. No `.vue`, CSS or copy changes. The B-12 refusals are existing texts on paths that today end in an orphan or resurrected row.

## Deferred, with reasons (program follow-ups)

1. **Q-27 (n), `unsealImportedKey`.** Load wipes DEK → `skBytes` → `skCopy`, but only after the awaited `fromSigningKey` and the address check. Export wipes `skBytes` → `skCopy` → DEK right after the scalar is built. One helper cannot keep both orders, and the planned load path would have wiped before the awaited construction. Phase 1 step 7 pins both.
2. **Q-27 (b), `settleRegistryTx`.** The helper's promise feeds the dispatcher's response send, so another task's broadcast can land between this task's `complete` and its RPC response (Codex probe: `A.complete → A.response → B.broadcast` became `A.complete → B.broadcast → A.response`). Phase 1 step 5 pins the inline flow.
3. **B-12 at `reconcileImportedAccounts`' delete (`account/service.ts:852`).** It is an exposed RPC (`:64`) with no finalize-only guard, so a trusted-popup call can race a rename. This named instance is left open on purpose, so B-12 is not recorded as fully closed.

## Drift left for the alignment arc

No drift among the deduped copies beyond the two fixed above. Observed, kept, and recorded as program follow-ups:

1. **Several texts for one condition:**
   - the profile being deleted: the compensated `profile X deleted`, `assertCurrent`'s `is being deleted — write rejected (epoch a → b)`, and the restore fence's `is being deleted or was not captured…`;
   - a reserved profile at entry: `importAccount` refuses with "Invalid profile id" (from `getProfileDek`), `createAccountInternal` with "unauthorized".
2. **Lead: no chain-liveness fence on account writes.** `createAccountInternal` and `importAccount` can land a row after a concurrent chain purge has taken its snapshot.
3. **Lead: `reconcileImportedAccounts`' unlocked delete** (Deferred 3).
4. **The fenced commits differ in their liveness legs** on purpose (F1, F2 and T check the network; T re-checks after the write). Recorded only.

## Plan audit

### Codex (GPT-6 Astra, xhigh): REVISE, high confidence. Opus: APPROVE.

Where the legs disagreed, the Codex evidence (in-memory Bun probes) won under the strict behaviour rule.

**Findings:**

1. **Codex blocker: Q-27 (n) cannot keep both wipe orders.** Adopted; deferred (Deferred 1). Opus had approved the helper; Codex's ordering evidence wins.
2. **Codex blocker: Q-27 (b) reorders the RPC response against another task's broadcast.** Adopted; deferred (Deferred 2). The plan's "same event order" claim covered only this task's events.
3. **Codex blocker: B-12 (a) gap after both asserts.** Adopted: post-write re-check, compensation through the key-row cleanup, regression (iv) parking the account write, and Opus's DEK-zero pin. Opus argued storage FIFO covers it; the conservative reading wins, and the fix is pre-cleared.
4. **Codex: engine text in `rowMatchesKey`.** Adopted: parameter named `account`, the repo `get` left inline, omitted-argument pins. No validation added.
5. **Codex: test gaps.** All adopted:
   - N1's existing tests are strengthened rather than duplicated;
   - F1 and N1 are asserted through the logger seam;
   - T's no-write pin;
   - the same-chain, other-address survivor;
   - the revoke cap and ownership pins, and cancel-not-fail;
   - mutant claims narrowed to the table.
6. **Codex: cross-arc contracts named concretely.** Adopted (Assumptions): one pin added here, one handed off to profile-rows.
7. **Both legs: comments.** Adopted: the provenance trims, the plain-arrow note, the one-line fence comment, and profile purge kept silent.
8. **Opus nits.** All adopted:
   - "Profile locked" after release, with (iii) as defence in depth;
   - the emit shift in the PR body;
   - the reserved-refusal text in drift 1;
   - Fact 5's lines;
   - `tupleLocks` growth left alone.

**Kept by both legs:** `rowMatchesKey` (with finding 4), `accountScopeKey`, `purgeMatchingLocked` (no added frame), the restore helpers, `profileDeletedError`, `rowMatchesItsToken` (strict boolean), and B-12 (b)'s per-row locks (no cycle).

**Ask calls:**

1. **Fenced commits inline:** both legs yes.
2. **Q-27 (n) helper:** Opus keep the helper; Codex keep inline. **Call: inline** (finding 1).
3. **Defer `:852`:** both legs yes, with Codex's corrected rationale (an exposed RPC, reachable through trusted-popup calls). Recorded as Deferred 3.

## Decisions (delegated)

1. **The pre-cleared three-field patch gate** (program Behaviour rule, route 2). It is invisible, because both UI callers supply all three fields (`app.store.ts:386, 410`) and restore and import write under the body's key. It is strictly safer, because it only adds a refusal where today's result transplants a row. It carries red-then-green test 3.1 and a PR-body entry.
2. **The B-12 route** (program Behaviour rule, route 1): (a) and (b) are fixed in this arc with their regressions (3.2, 3.3). The `:852` instance is deferred by name.
3. **Ask outcomes:** as recorded under Plan audit. Q-03 (a) inline with a shared refusal; Q-27 (b) and (n) inline and deferred; `:852` deferred.
