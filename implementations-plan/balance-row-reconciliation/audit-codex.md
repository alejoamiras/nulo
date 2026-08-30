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