# audit-codex — balance-row-reconciliation

**Session:** `01a05286-63b9-7c91-a4b4-1827954071ce` · model `gpt-5.6-sol` · reasoning `xhigh` · 2026-08-30

## Round 1 — plan audit

**Verdict:** `reject` — blocking findings, all adopted into the revision. See the decision ledger in `plan.md`.

---

The draft should not ship as Outline A. Outline B identifies the right invariant—atomic, idempotent creation—but places it at the wrong layer and still omits a creator. Use the third shape below.

## 1. Adversarial / security findings

- **High — a valid exact-pair forgery defeats reconciliation.** `TokenBalanceRaw` has neither owner nor chain fields, so a stored-state attacker can forge the active `(tokenId, account)` pair and chosen balances; the proposed diff treats it as existing and the UI renders it. Desired pairs must originate exclusively from active-profile tokens and accounts, and existing rows may answer only “does this already-constructed desired key exist?” This limitation remains fundamentally indistinguishable without changing the schema. [spec.ts:30](apps/extension/src/wallet/services/token-balance/spec.ts:30), [service.ts:146](apps/extension/src/wallet/services/token-balance/service.ts:146), [TokensView.vue:305](apps/extension/src/popup/components/modules/general/TokensView.vue:305)

- **High — storage-key identity is not enforced.** `BalanceRepository` constructs `EntityStorage` without `requireKeyIdentityMatch`; a valid row stored at `@99` with embedded `id: 1` is returned by `getAll()`, can suppress repair, and produces an ID whose later `get(1)` reads another key. `EntityStorage` already provides the numeric identity guard. Enable it in this PR and test mismatched-key rows. [balance-repository.ts:23](apps/extension/src/wallet/services/token-balance/balance-repository.ts:23), [entity_storage.ts:38](packages/wallet-core/src/storage/entity_storage.ts:38), [entity_storage.ts:152](packages/wallet-core/src/storage/entity_storage.ts:152)

- **Medium — codec-hidden rows should be treated as absent.** `getValues()` deliberately hides malformed rows, while `getKeys()` still sees their physical keys. Recreating the desired pair therefore creates one valid row at a different ID without overwriting the malformed bytes. That is the correct availability behavior; using raw malformed fields to suppress repair would preserve the outage. Do not delete malformed rows in this create-only sweep. [entity_storage.ts:214](packages/wallet-core/src/storage/entity_storage.ts:214), [entity_storage.ts:206](packages/wallet-core/src/storage/entity_storage.ts:206), [id-allocators.ts:17](apps/extension/src/wallet/services/id-allocators.ts:17)

- **High — the proposed wake cost is unnecessarily amplifiable.** Outline A performs one full-namespace account scan per chain; `getAccountsRaw(profileId)` already obtains every hidden and visible account in one full scan and can be grouped by `chainId` locally. Moreover, every repaired row currently invokes another full-namespace `getKeys()` during allocation and immediately creates a task. A large gap therefore costs `O(chains + missingRows)` namespace reads plus `missingRows` in-memory tasks, not merely “one batched read.” [account/service.ts:160](apps/extension/src/wallet/services/account/service.ts:160), [account/service.ts:562](apps/extension/src/wallet/services/account/service.ts:562), [service.ts:211](apps/extension/src/wallet/services/token-balance/service.ts:211), [balance-job-queue.ts:128](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:128)

- **Medium — valid duplicate pairs remain visible.** Restore validates rows individually but imposes no `(token, account)` uniqueness, and the view renders every returned row. Reconciliation must not create another duplicate, but create-only cannot safely clean existing duplicates. Record that residual explicitly. [service.ts:406](apps/extension/src/wallet/services/token-balance/service.ts:406), [TokensView.vue:435](apps/extension/src/popup/components/modules/general/TokensView.vue:435)

- **Medium — “no new trust boundary” understates the change.** The pass converts codec-valid stored token/account cardinality into a Cartesian product of writes and queued work. Token and account allocation have no practical product-level count limit, so hostile-but-valid stored state becomes an availability amplifier on every wake. [token/service.ts:298](apps/extension/src/wallet/services/token/service.ts:298), [account/service.ts:231](apps/extension/src/wallet/services/account/service.ts:231)

## 2. Assumptions audit

### Facts

| # | Result |
|---|---|
| 1 | **High — false literally.** The two normal event-driven creators are correctly identified, but `restore()` is a third new-row writer and allocator user. Omitting it leaves the allocation race alive. [service.ts:276](apps/extension/src/wallet/services/token-balance/service.ts:276), [service.ts:284](apps/extension/src/wallet/services/token-balance/service.ts:284), [service.ts:416](apps/extension/src/wallet/services/token-balance/service.ts:416) |
| 2 | Verified: neither lifecycle method reconciles. [service.ts:127](apps/extension/src/wallet/services/token-balance/service.ts:127), [service.ts:255](apps/extension/src/wallet/services/token-balance/service.ts:255) |
| 3 | Verified: list reads filter unknown tokens; singular conversion throws. [service.ts:137](apps/extension/src/wallet/services/token-balance/service.ts:137), [service.ts:146](apps/extension/src/wallet/services/token-balance/service.ts:146), [service.ts:236](apps/extension/src/wallet/services/token-balance/service.ts:236) |
| 4 | Verified: `createTokenBalance` writes without checking pair existence. [service.ts:215](apps/extension/src/wallet/services/token-balance/service.ts:215) |
| 5 | **High — premises verified, safety conclusion false.** Sequential awaits protect only one handler’s loop. Independent handlers overlap because subscriber promises are ignored; RPC handlers can also become live during `services.start()`. [event-handler.ts:47](packages/wallet-core/src/utils/event-handler.ts:47), [base-service.ts:129](packages/extension-messaging/src/core/base-service.ts:129), [runtime.ts:435](apps/extension/src/wallet/runtime.ts:435) |
| 6 | Verified: enqueue is synchronous and pre-start-safe. [balance-job-queue.ts:83](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:83), [balance-job-queue.ts:128](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:128) |
| 7 | Verified: the relevant entity enumerations call `storage.get()` with no key; `getAccounts` reaches that through `liveRows`. [entity_storage.ts:194](packages/wallet-core/src/storage/entity_storage.ts:194), [entity_storage.ts:206](packages/wallet-core/src/storage/entity_storage.ts:206), [account/service.ts:98](apps/extension/src/wallet/services/account/service.ts:98), [chrome-browser-api.ts:68](apps/extension/src/core/adapters/chrome-browser-api.ts:68) |
| 8 | Verified: `all` includes hidden accounts and `onTokenAdded` passes it. [account/service.ts:160](apps/extension/src/wallet/services/account/service.ts:160), [service.ts:295](apps/extension/src/wallet/services/token-balance/service.ts:295) |
| 9 | Verified: no `profileId` or `chainId`. [spec.ts:30](apps/extension/src/wallet/services/token-balance/spec.ts:30) |
| 10 | Verified: the footprint test governs migration descriptors, and the root is registered already. [footprint-coverage.test.ts:1](apps/extension/src/wallet/services/backup/footprint-coverage.test.ts:1), [backup-migration-registry.ts:205](apps/extension/src/wallet/services/backup/backup-migration-registry.ts:205) |
| 11 | Verified: no account-deletion subscription. [service.ts:120](apps/extension/src/wallet/services/token-balance/service.ts:120) |
| 12 | Verified: TokenBalance has no lock; TokenService serializes its allocation/write section. [service.ts:48](apps/extension/src/wallet/services/token-balance/service.ts:48), [token/service.ts:71](apps/extension/src/wallet/services/token/service.ts:71), [token/service.ts:279](apps/extension/src/wallet/services/token/service.ts:279) |

### Inferences

1. **High — unsafe.** Create-only restores missing-row visibility, but not the adjacent SW-death window after `repo.set` and before `enqueue`. Such a row remains `updatedAt: 0` with no queued work, and the test helper documents that no ambient periodic resync exists. Boot reconciliation should enqueue desired existing rows with `updatedAt === 0 && syncFailure === undefined`. [service.ts:228](apps/extension/src/wallet/services/token-balance/service.ts:228), [service.ts:231](apps/extension/src/wallet/services/token-balance/service.ts:231), [helpers.ts:1379](apps/extension/tests/e2e/fixtures/helpers.ts:1379)

2. **High — unsafe and unmeasured.** The cost is multiple full-namespace reads, Cartesian iteration, per-created-row key scans, and per-created-row tasks. Replace per-chain account reads with one `getAccountsRaw(profileId)` and add count/duration telemetry plus a large-input unit test. [entity_storage.ts:214](packages/wallet-core/src/storage/entity_storage.ts:214), [account/service.ts:562](apps/extension/src/wallet/services/account/service.ts:562)

3. **High — false.** Init can overlap events from already-started dependency services because RPC handlers are live during graph startup. The profile-switch handler is also an async subscriber whose publisher does not await it. Sequential loops are not cross-call serialization. [runtime.ts:435](apps/extension/src/wallet/runtime.ts:435), [base-service.ts:129](packages/extension-messaging/src/core/base-service.ts:129)

4. **Low — safe.** The pure diff is a useful seam because desired tokens, accounts grouped by chain, and existing exact pairs are sufficient inputs. It should emit primitives/minimal structural types and ideally stream missing pairs rather than require a potentially large Cartesian result array. [spec.ts:30](apps/extension/src/wallet/services/token-balance/spec.ts:30), [account/service.ts:562](apps/extension/src/wallet/services/account/service.ts:562)

### Asks

All six need to become decisions in the plan; the rulings are in §4 below.

## 3. Architecture ruling

### Outline A

**High — reject as written.** Its snapshot/diff is stale as soon as another live handler, restore, or deletion interleaves. Sequential iteration prevents only self-collision. It also overlooks that every created row performs another full-store allocation scan and that `restore()` allocates from the same namespace. [service.ts:211](apps/extension/src/wallet/services/token-balance/service.ts:211), [service.ts:276](apps/extension/src/wallet/services/token-balance/service.ts:276), [service.ts:416](apps/extension/src/wallet/services/token-balance/service.ts:416)

It also needs `AccountService.name` added to the declared dependencies once init awaits an account read; the current declaration names only Profile and Token. [service.ts:38](apps/extension/src/wallet/services/token-balance/service.ts:38)

### Outline B

**High — closer, but reject as written.** A lock solves the race only if one critical section contains existence decision, allocation, and write, and only if every allocator user participates. B omits `restore()`. Its per-pair `existsByTokenAndAccount` is a full-namespace read, making the boot sweep `pairs × namespace`. [balance-repository.ts:66](apps/extension/src/wallet/services/token-balance/balance-repository.ts:66), [service.ts:416](apps/extension/src/wallet/services/token-balance/service.ts:416)

`BalanceRepository.ensureRow(token, account)` also leaks service-layer aggregates into a repository currently concerned with raw rows, IDs, and storage. The repository cannot own profile-generation checks, token liveness, emits, or queue behavior. [balance-repository.ts:20](apps/extension/src/wallet/services/token-balance/balance-repository.ts:20), [service.ts:215](apps/extension/src/wallet/services/token-balance/service.ts:215)

### Recommended third shape

**High — adopt a service-owned serialized batch ensure.**

- Add one `TokenBalanceService` mutation lock. Under the same hold: read existing rows once, construct desired pairs from active-profile tokens plus one `getAccountsRaw(profileId)` read, diff, allocate/write missing rows sequentially, and update the in-memory existing-pair set after each creation.
- Route `onTokenAdded`, `onAccountAdded`, init reconciliation, and profile-switch reconciliation through that same idempotent ensure path.
- Put `restore()` allocation/writes under the same lock, but keep restore’s row values and validation semantics rather than treating restored rows as zero-balance ensures.
- Make `onTokenDeleted` synchronously remove the token from `this.tokens`, then perform its purge under the same lock; immediately before any new write, recheck generation and token-map membership. The current generation fence alone covers profile changes, not token deletion. [service.ts:215](apps/extension/src/wallet/services/token-balance/service.ts:215), [service.ts:317](apps/extension/src/wallet/services/token-balance/service.ts:317)
- On boot/profile sweep, enqueue an existing desired row only when it is demonstrably never projected: `updatedAt === 0 && syncFailure === undefined`. On a live add event, enqueue the ensured existing row too, because a duplicated/replayed event should converge rather than silently no-op.
- Retain the pure diff module, but filter the existing index to active desired token/account keys rather than materializing every foreign row.
- Enable numeric key-identity validation in `BalanceRepository`.

This combines A’s batched diff and testable pure seam with B’s atomicity, without B’s per-pair scans or repository-domain leakage.

## 4. Definite answers

### a. Scope

- **(i) Concurrent ID loss: fix in this PR — High.** It is real: allocation is read/compute, event promises are ignored, and RPCs can run during startup. The new sweep adds another allocator user, so shipping reconciliation without serialization knowingly makes the existing loss path more reachable. Include restore in the lock coverage. [id-allocators.ts:17](apps/extension/src/wallet/services/id-allocators.ts:17), [event-handler.ts:47](packages/wallet-core/src/utils/event-handler.ts:47), [runtime.ts:435](apps/extension/src/wallet/runtime.ts:435)

- **(ii) Orphaned imported-account balances: separate PR — High.** The defect is real, but a simple `onAccountDeleted` subscriber is not durable because subscriber promises are unawaited, and deleting by address alone can erase another profile’s rows because addresses can be shared. Its repair needs an awaited SW-side coordination path scoped by deleted account profile/chain and that profile’s token IDs. [account/service.ts:785](apps/extension/src/wallet/services/account/service.ts:785), [account/service.ts:550](apps/extension/src/wallet/services/account/service.ts:550), [base-service.ts:129](packages/extension-messaging/src/core/base-service.ts:129)

### b. Awaited vs detached

**Await inside `init()`, failure-isolated — High.** `BaseService.start()` does not mark TokenBalance initialized until init resolves, so awaiting prevents its first balance RPC from observing the unrepaired state. The detached integrity precedent is deliberately tolerating tens-of-seconds BB work and has a durable stamp cache; a local-storage integrity repair has different economics. [base-service.ts:64](packages/extension-messaging/src/core/base-service.ts:64), [account-integrity/coordinator.ts:75](apps/extension/src/wallet/services/account-integrity/coordinator.ts:75)

### c. Serialization

**Introduce one `TokenBalanceService` mutation lock and make all new-row allocator users participate — High.** Strictly sequential loops are insufficient across independent invocations. The lock must cover read/diff/allocation/write, not merely allocation. [service.ts:276](apps/extension/src/wallet/services/token-balance/service.ts:276), [service.ts:284](apps/extension/src/wallet/services/token-balance/service.ts:284), [service.ts:416](apps/extension/src/wallet/services/token-balance/service.ts:416)

### d. E2E shape

**Seed the exact gap directly, restart the worker, and assert recovery — Medium.** Create a real token/account normally, delete every matching balance row from `chrome.storage.local`, prove the gap exists, stop the worker, wake it, then assert:

1. exactly one valid pair row reappears;
2. it receives a fresh projection;
3. its token card is visible with the expected amount.

Reuse `waitForFreshBalanceRow` and `waitForTokenCardAmount`. This tests the shipped recovery guarantee without adding a fourth production seam. Cover the producer race deterministically in service tests by parking two allocation callers and asserting unique IDs/pairs. A storage-change-triggered kill is a rejected third option because it cannot establish that the async subscriber has not already completed. [helpers.ts:1367](apps/extension/tests/e2e/fixtures/helpers.ts:1367), [helpers.ts:1490](apps/extension/tests/e2e/fixtures/helpers.ts:1490), [COMPOSITION-TESTS.md:19](apps/extension/tests/COMPOSITION-TESTS.md:19)

**Low — extract the worker-stop helper instead of copying it again.** The current tree actually contains eight local definitions, not five, including [sw-resilience.test.ts:29](apps/extension/tests/e2e/sw-resilience.test.ts:29), [sw-restart-network.test.ts:11](apps/extension/tests/e2e/sw-restart-network.test.ts:11), and [backup-restore-sw-restart.test.ts:99](apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts:99).

### e. Direction

**Create-only for general reconciliation — Medium.** Agree with recon. A row unexplained by the active snapshot may belong to another profile, precede its token during restore, or be inside an unawaited chain-delete tail. General deletion cannot be made owner-safe from this schema. Explicit token/account deletion flows should perform targeted awaited purges separately. [service.ts:406](apps/extension/src/wallet/services/token-balance/service.ts:406), [network/service.ts:736](apps/extension/src/wallet/services/network/service.ts:736), [token/service.ts:162](apps/extension/src/wallet/services/token/service.ts:162)

### f. Tier

**Keep `mid` — Low.** The boot-path blast radius, shared storage, silent row overwrite, and required concurrency/e2e coverage rule out `light`. `deep` is unnecessary because the recommended solution does not migrate the storage schema or introduce a new durable protocol.

reject (with blocking findings: replace Outline A with one locked idempotent creation path covering both handlers, both lifecycle sweeps, and restore allocation; recover pre-enqueue rows; use one profile-wide account read; enforce balance key identity; and add deterministic concurrency plus direct-gap restart e2e coverage)
---

## Round 2 — re-audit of the consolidated design

**Verdict:** `conditional approve` — 7 conditions, all adopted.

The revision has the right architecture, but it has not fully discharged the blockers. The remaining problems are precise enough for conditional approval rather than another redesign.

## Findings

- **High — the unfenced init hydration is recorded, not fixed.** Fact 14 acknowledges the only unfenced token-map write, but neither Phase 2 nor Phase 3 changes it. `init()` subscribes before awaiting and later mutates `this.tokens` without checking `profileGeneration`; a profile switch can rebuild profile B and then the late init continuation can add profile A’s tokens back. The new sweep would turn that existing cache corruption into cross-profile balance writes. [plan.md:113](implementations-plan/balance-row-reconciliation/plan.md:113), [service.ts:120](apps/extension/src/wallet/services/token-balance/service.ts:120), [service.ts:127](apps/extension/src/wallet/services/token-balance/service.ts:127), [service.ts:255](apps/extension/src/wallet/services/token-balance/service.ts:255)

  Fix it by capturing the generation before the first init await and committing both hydration and its sweep only if generation and profile identity still match. Add the deterministic “switch while `getTokensRaw` is parked” test the parallel audit’s C-2 finding calls for.

- **High — restore must share the lock, but must not share the active-profile ensure authorization.** The plan says all five callers use one ensure path and that every write checks active token-map membership. That would reject restored balances: full-backup balances are restored before the imported profile is activated, so their token IDs are intentionally absent from the active map. [plan.md:41](implementations-plan/balance-row-reconciliation/plan.md:41), [plan.md:56](implementations-plan/balance-row-reconciliation/plan.md:56), [useFullBackupImport.ts:890](apps/extension/src/composables/useFullBackupImport.ts:890), [useFullBackupImport.ts:900](apps/extension/src/composables/useFullBackupImport.ts:900)

  There are four ensure callers, plus one separate restore writer. Wrap the entire `restoreRows` batch in one lock acquisition, mirroring `TokenService.restore`, but retain only schema parsing and deletion-epoch authorization for those writes. Do not run restore through pair deduplication, zero initialization, generation checks, active-map membership, emit, or enqueue. [service.ts:406](apps/extension/src/wallet/services/token-balance/service.ts:406), [token/service.ts:713](apps/extension/src/wallet/services/token/service.ts:713)

- **High — the mutation protocol omits `purgeForTokens`.** Phase 2 locks `onTokenDeleted`, but profile deletion invokes `purgeForTokens` directly. Its typed snapshot, deletes, and raw purge currently run outside any lock. A creation whose `repo.set` settles after that purge’s snapshot can survive profile deletion. The deletion-fence contract explicitly expects restore writers and their purge path to use the same leaf lock. [plan.md:149](implementations-plan/balance-row-reconciliation/plan.md:149), [service.ts:326](apps/extension/src/wallet/services/token-balance/service.ts:326), [coordinator.ts:116](apps/extension/src/wallet/services/profile-deletion/coordinator.ts:116), [profile-deletion-state.ts:64](apps/extension/src/wallet/services/profile/profile-deletion-state.ts:64)

  Put the complete typed-plus-raw `purgeForTokens` operation under the same lock. Use explicitly named `...HoldingLock` helpers so an ensure or restore path cannot accidentally reacquire the non-reentrant lock.

- **High — the default five-minute watchdog is incompatible with this correctness lock.** A forced release expressly permits a second critical section while the first is still executing, destroying the allocator invariant. Holds are data-dependent, the balance Cartesian product has no cap, and the extension has `unlimitedStorage`. Construct this lock with `maxHoldMs: null`, or introduce a proven upper bound below the watchdog; merely accepting the default is unsafe. [lock.ts:27](packages/wallet-core/src/utils/lock.ts:27), [lock.ts:138](packages/wallet-core/src/utils/lock.ts:138), [manifest.config.ts:39](apps/extension/manifest/manifest.config.ts:39)

- **High — `tokens.has(id)` is not a sufficient token-liveness check.** Token IDs are globally allocated, but not globally monotonic: deleting the highest token permits its ID to be reused. The source explicitly warns about a successor reusing that ID. An in-flight old-token creation can therefore see the reused ID present and pass a bare membership check. Compare the current map entry’s stable identity—`profileId`, `chainId`, and `contract`—with the captured token, not merely its ID. [id-allocators.ts:17](apps/extension/src/wallet/services/id-allocators.ts:17), [token/service.ts:447](apps/extension/src/wallet/services/token/service.ts:447), [token/service.ts:681](apps/extension/src/wallet/services/token/service.ts:681)

- **High — the “foreign row can never collide” assumption is false over time.** A worker death after token deletion but before its un-awaited balance purge can leave an old, already-projected row. A later token can reuse that ID; profiles can also share deterministic account addresses. The old `(tokenId, account)` row can then suppress repair and, because `updatedAt > 0`, will not be re-enqueued. “Global sequence” guarantees uniqueness among currently stored honest token rows, not across deleted incarnations. [plan.md:91](implementations-plan/balance-row-reconciliation/plan.md:91), [account/service.ts:550](apps/extension/src/wallet/services/account/service.ts:550), [token/service.ts:458](apps/extension/src/wallet/services/token/service.ts:458)

  Correct the claimed invariant and file this alongside the deferred account-orphan/reassociation work. A durable solution needs non-reused token identities, an awaited token-delete cascade, or schema-carried token incarnation; the balance sweep cannot infer it from the current schema.

- **High — enable `requireKeyIdentityMatch` in this PR.** The counterargument does not change my ruling. This reconcile is the migration/recovery story: with the numeric guard enabled, the mismatched row is hidden but retained; physical `getKeys()` still prevents overwriting it; awaited init creates a canonical replacement at a fresh ID and enqueues projection before the first balance RPC can complete. [balance-repository.ts:23](apps/extension/src/wallet/services/token-balance/balance-repository.ts:23), [entity_storage.ts:145](packages/wallet-core/src/storage/entity_storage.ts:145), [entity_storage.ts:206](packages/wallet-core/src/storage/entity_storage.ts:206), [service.ts:146](apps/extension/src/wallet/services/token-balance/service.ts:146)

  What is not preserved is the corrupt row’s last-known balance value; the replacement deliberately starts unresolved and obtains an authoritative projection. That is the correct fail-closed behavior. Add a service test proving a valid mismatched-key desired row becomes exactly one visible canonical row while the old physical bytes remain untouched.

- **Medium — the E2E can false-pass the projection and card assertions.** `waitForFreshBalanceRow` actively calls `refreshBalances` unless `maxRefreshes: 0`, so it can prove an explicit refresh rather than the boot enqueue. The existing popup can also retain its pre-deletion token card; `TokensView` does not refetch balances on the token-balance client’s reconnect. [helpers.ts:1434](apps/extension/tests/e2e/fixtures/helpers.ts:1434), [TokensView.vue:176](apps/extension/src/popup/components/modules/general/TokensView.vue:176), [TokensView.vue:337](apps/extension/src/popup/components/modules/general/TokensView.vue:337)

  Require `maxRefreshes: 0` for the automatic-projection proof, then reload/remount the popup before asserting the card. Also name the shared worker-stop helper extraction—the tree currently has no reusable helper, only eight local definitions.

- **Low — deterministic ordering is underspecified.** Sorting by chain, account index, and address does not order multiple tokens on the same chain. Include token ID in the ordering and test input permutations. [plan.md:60](implementations-plan/balance-row-reconciliation/plan.md:60)

## Direct rulings

- **Lock and restore:** Safe once restore is one whole-batch acquisition, `purgeForTokens` participates, the lock cannot force-release, and no active-map authorization is applied to restore. There is no current in-SW balance-event re-entry; restore itself emits nothing. The implementation should still structurally prevent nested acquisition.

- **Zero-row retry predicate:** Sound. Enqueue coalesces an already-pending row; success always writes a current timestamp; failure persists `syncFailure`. Therefore an active desired row with `updatedAt === 0 && syncFailure === undefined` has no durable evidence that projection finished or failed. Tokens without balance functions still complete successfully and advance the timestamp. [balance-job-queue.ts:128](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:128), [balance-job-queue.ts:173](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:173), [balance-job-queue.ts:255](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:255)

- **Phase split:** The dependency direction Phase 1 → Phase 2 → Phase 3 is sound. Nothing essential in Phase 2 depends on Phase 3. Enable key-identity guarding alongside Phase 3’s sweep, however, so no intermediate phase hides mismatched rows without repairing them. Phase 2 must describe four ensure callers plus a separate locked restore writer.

- **Tier:** `mid` remains correct. These are concurrency, lifecycle, and recovery changes with real e2e coverage, but no new durable schema protocol is required for this PR.

conditional approve (with conditions: fence init hydration and its sweep; separate restore from active-profile ensure semantics; include purgeForTokens in a non-force-releasing service lock; strengthen token liveness beyond id membership; correct and file the temporal token-id-reuse residual; enable numeric key identity with recovery tests; and make the e2e prove automatic projection against a remounted UI)
---

## Round 3 — discharge check

**Verdict:** `reject` — six of seven discharged; one Critical (numeric key-identity mode). Adopted.

Six of the seven round-2 conditions are substantively discharged. One remains a release-blocking omission.

### Blocking finding

**Critical — Phase 3 does not specify numeric key-identity mode.**

The implementation instruction only says to enable `requireKeyIdentityMatch` ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:175)). But `EntityStorage` defaults `keyIdentityMode` to `"string"` ([entity_storage.ts](packages/wallet-core/src/storage/entity_storage.ts:56)), whose guard requires an embedded string id ([entity_storage.ts](packages/wallet-core/src/storage/entity_storage.ts:158)). Balance ids are numbers ([spec.ts](apps/extension/src/wallet/services/token-balance/spec.ts:30)).

A literal implementation using only `{ requireKeyIdentityMatch: true }` would therefore hide every valid balance row. Since `getKeys()` still returns their physical keys ([entity_storage.ts](packages/wallet-core/src/storage/entity_storage.ts:206)), each wake would allocate fresh rows that are themselves immediately hidden—emptying the wallet view while growing storage indefinitely.

The plan must prescribe exactly:

```ts
{
  requireKeyIdentityMatch: true,
  keyIdentityMode: "numeric",
}
```

Also retain the mismatched-row recovery test and add/assert the simpler control case that `@1` containing `{ id: 1, ... }` remains visible. The audit summary says “numeric key identity” ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:238)), but the operative Phase 3 instructions do not.

### Other rulings

- **Restore split: discharged.** Whole-batch `withLock` acquisitions cannot interleave; `withLock` releases through `finally` ([lock.ts](packages/wallet-core/src/utils/lock.ts:79)). In the supported import flow, every slice restore is awaited before late activation ([useFullBackupImport.ts](apps/extension/src/composables/useFullBackupImport.ts:890), [useFullBackupImport.ts](apps/extension/src/composables/useFullBackupImport.ts:900)). Thus the target profile cannot run ensure first. Direct/repeated out-of-protocol restore can still create duplicates, but that is the already-recorded restore residual, not a new interleaving defect.

- **Init hydration fence: discharged.** A switch after hydration commit increments the generation, changes the profile, and synchronously clears the token map before its first await ([service.ts](apps/extension/src/wallet/services/token-balance/service.ts:255)). The captured generation/profile check and per-write identity check in the plan then prevent the old sweep from writing ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:64), [plan.md](implementations-plan/balance-row-reconciliation/plan.md:166)).

- **Lock release: discharged.** Rejection, throw, or early return from the batch still invokes `leave()` in `finally` ([lock.ts](packages/wallet-core/src/utils/lock.ts:79)). No identified callback intentionally leaves an unsettled promise. The implementation should use `withLock`, as the cited `TokenService.restore` precedent does ([token/service.ts](apps/extension/src/wallet/services/token/service.ts:713)).

- **Zero-row re-enqueue: discharged.** Such a row has no legitimate terminal meaning here. Existing in-memory work coalesces by balance id ([balance-job-queue.ts](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:126)); after worker death, re-enqueueing is exactly the required recovery. Rows that already failed are excluded by `syncFailure`.

- **Low — phase wording remains inconsistent.** Phase 2 says it routes four callers and fences “its sweep” ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:163)), while Phase 3 introduces the two sweep callers ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:172)). The final architecture is clear, but Phase 2 should say it routes the two live handlers and prepares the ensure path; Phase 3 adds the two sweeps.

- **Low — stale text:** the file map still says key identity is pending ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:85)); Inference 5 still describes a five-minute watchdog despite `maxHoldMs: null` ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:137)); and the decision ledger still claims the global token-id sequence makes pair keys safe despite the recorded temporal-reuse residual ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:220)).

reject (with blocking findings: Phase 3 must explicitly configure `keyIdentityMode: "numeric"` alongside `requireKeyIdentityMatch`)
---

## Round 4 — final

**Verdict:** `approve`.

The plan is implementable as written. The numeric identity blocker is fully discharged: Phase 3 specifies both options and requires positive and negative control tests ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:175)).

Only documentation nits remain:

- **Low:** Phase 2 still says it commits hydration “and its sweep” ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:166)), although Phase 3 introduces that sweep ([plan.md](implementations-plan/balance-row-reconciliation/plan.md:172)). This does not obscure the final implementation.

- **Low:** Two citations remain inaccurate. Late activation is documented at `useFullBackupImport.ts:900-905`, not `:888-891`; and `token/service.ts:444-449` does not warn about id reuse—the explicit reuse warning is at `:681-684`. The underlying conclusions remain supported.

No remaining architecture, concurrency, recovery, security, or test-design blocker.

approve
---

# Post-implementation audit (session `01a05303-c00e-7922-a458-d170ce9fc470`)

## Round 1 — implementation audit

**Verdict:** `reject` — one High (live handlers bypassed pair reconciliation, allowing duplicate rows) + 5 Lows. All adopted.

I found one blocking implementation bug.

## Findings

- **High — live handlers serialize allocation but do not reconcile pair existence.** [service.ts:374](apps/extension/src/wallet/services/token-balance/service.ts:374), [service.ts:397](apps/extension/src/wallet/services/token-balance/service.ts:397)

  Both handlers call `createTokenBalanceHoldingLock` unconditionally. The lock prevents ID collisions but not duplicate `(token, account)` rows. For example, a sweep can hold the lock while awaiting `repo.getAll`; `onTokenAdded` then inserts its token into the live map and queues for the lock; the sweep resumes, sees that token and creates its row; afterward the handler acquires the lock and creates the same pair under another ID. This produces duplicate cards and violates the documented one-row-per-pair invariant.

  The concurrency test uses two deliberately different pairs, so it cannot catch this. Route both handler batches through the same locked read/diff/create path used by the sweep and add a same-pair race case.

- **Medium — the never-projected recovery path is not actually tested.** [service.test.ts:427](apps/extension/src/wallet/services/token-balance/service.test.ts:427), [balance-row-reconciliation.test.ts:74](apps/extension/tests/e2e/network/balance-row-reconciliation.test.ts:74), [auth.vue:174](apps/extension/src/popup/pages/auth.vue:174)

  The service test seeds a stale row but asserts only that it remains unduplicated. Removing the `staleTokens` enqueue loop entirely leaves that assertion green. The E2E deletes rows, so it tests only missing-row creation. Moreover, unlocking invokes `refreshBalances(...)`; therefore `maxRefreshes: 0` disables only helper-triggered refreshes, not the explicit refresh from the auth flow. The smallest reliable pin is a `createNewTask` spy asserting that the pre-existing stale row’s ID is enqueued during service start.

- **Low — the new token-deletion lock has no race regression test.** [service.test.ts:77](apps/extension/src/wallet/services/token-balance/service.test.ts:77)

  Every deletion test finishes seeding before deletion. Reverting commit `2a10be6c` would leave them green. Park a creator before its physical `repo.set`, start deletion, then release the write and assert no row survives.

- **Low — the init hydration fence is implemented but its required test is absent.** [service.ts:144](apps/extension/src/wallet/services/token-balance/service.ts:144), [service.test.ts:251](apps/extension/src/wallet/services/token-balance/service.test.ts:251)

  The existing slow-rebuild test directly exercises `onActiveProfileChanged`, not `init()`. Park init’s `getTokensRaw`, invoke a profile switch, release the stale init read, and assert it cannot repopulate the old profile.

- **Low — the repair count can claim writes that never occurred.** [service.ts:301](apps/extension/src/wallet/services/token-balance/service.ts:301)

  `createTokenBalanceHoldingLock` returns early on generation or liveness failure, but the caller increments `repaired` regardless. Return a boolean indicating whether `repo.set` ran and increment only on `true`.

- **Low — comment/documentation cleanup.**

  - [service.ts:39](apps/extension/src/wallet/services/token-balance/service.ts:39) retains audit-history language (`Q9`, “was…missing”, “joined when…”); state only the startup invariant.
  - [service.ts:309](apps/extension/src/wallet/services/token-balance/service.ts:309) incorrectly attributes every repair to worker death; key mismatch or other invariant damage can also cause it.
  - [reconcile-pairs.ts:1](apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:1), [reconcile-pairs.ts:26](apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:26), and [reconcile-pairs.ts:87](apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:87) narrate names or visible branches and can be removed or compressed.
  - [reconcile-pairs.ts:63](apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:63) says “tracked separately” without a durable reference.
  - [helpers.ts:1661](apps/extension/tests/e2e/fixtures/helpers.ts:1661) records copy-count history; remove it.
  - [balance-row-reconciliation.test.ts:62](apps/extension/tests/e2e/network/balance-row-reconciliation.test.ts:62) says both sweeps run, but this restart lands locked; unlock exercises the profile-switch sweep. Its “boot enqueue” claim is also undermined by auth’s refresh.
  - [ARCHITECTURE.md:97](ARCHITECTURE.md:97) omits `onTokenDeleted` and describes `purgeForTokens` as an allocating path.
  - [service.ts:281](apps/extension/src/wallet/services/token-balance/service.ts:281) deserves one sentence explaining why the account snapshot intentionally precedes the balance lock.
  - [service.ts:429](apps/extension/src/wallet/services/token-balance/service.ts:429) deserves a concise note that no in-worker balance-event subscriber re-enters this service.

## Targeted questions

- The lock participant set is complete: both live handlers, both sweeps, restore, both purge passes, and `onTokenDeleted`. Queue projection writes need not participate because they do not allocate/create pairs and are protected by invalidation, ownership, and generation fences.
- I found no direct or indirect nested acquisition. `onTokenDeleted`’s emit cannot currently cycle back into this lock; there are no in-worker `onTokenBalance*` subscribers.
- `isSameTokenLive` is load-bearing. Both live handlers retain tokens across awaits/lock acquisition, and token deletion removes map membership synchronously even while waiting for the lock. Identity comparison also protects ID reuse.
- The requested init gap is fenced correctly. JavaScript cannot interleave between the synchronous hydration commit and entering `reconcileBalanceRows`; its first await is the account read, followed immediately by a generation check, with further checks inside the hold.
- `getAccountsRaw` belongs outside the hold. The balance lock cannot make AccountService mutations atomic anyway. Account additions are closed by the locked handler; account deletion remains the already-deferred orphan case. After fixing the High finding, concurrent inclusion plus handler delivery will also be idempotent.

reject (with blocking findings: live handlers bypass pair reconciliation and can create duplicate balance rows)
---

## Round 2 — re-review

**Verdict:** `conditional approve` — no production defect remained; the same-pair test was theatre and comments needed correcting. Both adopted.

No production correctness defect remains in the fix. The duplicate-pair window is closed, but one regression test does not exercise that window.

### Findings

- **Medium — [service.test.ts:611](apps/extension/src/wallet/services/token-balance/service.test.ts:611): the same-pair race test starts with the pair already created.** `services.start()` sees token 100 and account `0xa`, so the boot sweep creates the row before the allocation spy is installed. Both subsequent handlers only exercise the already-exists skip path. The test would still pass if existence were checked outside the lock. Have `getAccountsRaw()` return `[]`, retain `getAccounts()` returning `0xa`, and assert allocation occurs exactly once.

- **Low — [service.ts:264](apps/extension/src/wallet/services/token-balance/service.ts:264): the helper contract is partly inaccurate and omits its most important constraint.** It is not “the one path that creates rows”—`restore()` deliberately writes directly. More importantly, an supplied `existing` snapshot must have been read during the current lock hold. State that explicitly; it is what makes the sweep’s optimization safe.

- **Low — [service.ts:336](apps/extension/src/wallet/services/token-balance/service.ts:336): the repair-cause comment remains too strong.** An identity-hidden row did physically complete its write, and the sweep can also win a normal race with a live handler. The count is factual; the claimed cause is not. Remove the causal attribution.

- **Low — [service.ts:442](apps/extension/src/wallet/services/token-balance/service.ts:442): the future-deadlock comment is incorrect.** `EventHandler.invoke()` does not await subscriber promises. A subscriber calling an async lock-taking entry point would queue behind the current hold, not deadlock it. There is no current nested acquisition, but this explanation should be removed or corrected.

- **Low — [balance-row-reconciliation.test.ts:1](apps/extension/tests/e2e/network/balance-row-reconciliation.test.ts:1): the header still contradicts the corrected inline explanation.** Lines 2–13 claim boot recovery and a boot enqueue isolated by `maxRefreshes: 0`; lines 62–76 correctly establish that repair occurs on unlock and `auth.vue` explicitly refreshes. Rewrite the header around restart-plus-unlock end-to-end recovery.

- **Low — [service.test.ts:650](apps/extension/src/wallet/services/token-balance/service.test.ts:650), [service.test.ts:762](apps/extension/src/wallet/services/token-balance/service.test.ts:762): mutation-history comments are permanent noise.** “Reverting…” and “Removing… must fail something” should directly state the tested invariant instead.

The sweep’s `existing` is safe today: `repo.getAll()` occurs after acquiring the same lock used by every relevant creator, so no other holder can write between the snapshot and `ensurePairsHoldingLock`. Returning `true` after a generation change following `repo.set` is also correct—the row physically exists, so both `have` and the repair count should reflect it. Suppressing its emit/enqueue is intentional; a later activation sees it as stale.

The deletion-race, init-fence, and stale-enqueue tests genuinely pin their intended behavior. The targeted service suite passes: 23/23.

conditional approve (with conditions: make the same-pair test begin with an absent pair and correct the inaccurate comments)
---

## Round 3 — convergence

**Verdict:** `conditional approve` — "no production or test-behavior issue found"; one comment ordering fix, applied. Loop converged.

One remaining comment defect; no production or test-behavior issue found.

- **Low — [service.test.ts:656](apps/extension/src/wallet/services/token-balance/service.test.ts:656):** the comment reverses the ordering. Under serialization, the deletion’s storage snapshot occurs **after** the parked write, not before it. Suggested wording: “Deletion queues behind an in-flight creation, so its snapshot includes and sweeps the completed write.”

The same-pair test now genuinely enters the race and asserts one physical allocation. The remaining comment changes are accurate. Targeted verification passed: 23/23.

conditional approve (with conditions: correct the deletion-race comment’s snapshot ordering)