<!-- codex session 01a00a88-cb63-7041-8040-23d8c8b3d793 -->

### Finding: Incoming-transfer service owns too many change axes

1. **Smell name:** Large Class and Divergent Change. `IncomingTransferService` combines storage-facing APIs, trust-state policy, two unrelated discovery mechanisms, scheduler lifecycle, reorg reconciliation, receipt-fee caching, sync-state projection, dust filtering, and balance-refresh delivery.

2. **Maintenance impact:** Architectural. Primary blast radius is `incoming-transfer/service.ts`, but changes commonly involve its repository/spec and at least one of token, account, transaction, journal, balance, task, price, PXE, or config services. The file changed in 9 commits since the June 30 restructure, including separate public-transfer, sync-indicator, account-isolation, backup/deletion, and locking changes.

3. **Concrete evidence:**

   - Eleven service dependencies and six public event streams are held together at `apps/extension/src/wallet/services/incoming-transfer/service.ts:119`.
   - Scheduler, polling, public-indexing, class-gate, fee-cache, lifecycle-epoch, and sync-state fields occupy `service.ts:126`.
   - `init()` resolves all dependencies, creates the public indexer, registers token/account/profile/transaction lifecycle listeners, rebuilds schedulers, and drains the balance outbox at `service.ts:218`.
   - User-facing record, fee, dust, sync, and trust APIs occupy `service.ts:391`.
   - Lifecycle purge and scheduler rebuilding occupy `service.ts:634`.
   - Private-note discovery begins at `service.ts:939`.
   - Public-event indexing, cursor persistence, forward scanning, and reorg reconciliation occupy `service.ts:1171`.
   - Durable balance-refresh outbox processing begins at `service.ts:1804`.

4. **Why it harms future change:** A new receipt source, trust rule, profile lifecycle event, reorg policy, or balance-refresh guarantee must be integrated into one 1,996-line state owner. For example, changing scheduler identity requires reasoning simultaneously about `schedulers`, `watchedContracts`, `publicSchedulers`, `publicWatched`, both polling guards, lifecycle epochs, purge paths, and sync-state eviction.

5. **Smallest safe refactoring:** Fowler’s **Extract Class**. First extract a `PublicIncomingScanner` containing the public scheduler, cursor/class-gate state, forward scan, and reconciliation methods. Keep the existing service as the RPC/event facade and inject callbacks for trust-aware record commit and balance invalidation.

6. **What disappears after the refactoring:** The public-indexing state maps and roughly half of the lifecycle/polling reasons to modify `IncomingTransferService`; public-chain reorg work would no longer require navigating private-note polling and user-facing query policy.

7. **Instances:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:119`, `:126`, `:218`, `:391`, `:634`, `:939`, `:1171`, `:1804`.

---

### Finding: Private-note and public-event commits duplicate the trust workflow

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** Structural. Blast radius is currently one file, but the duplicated workflow crosses `IncomingTransferRepository`, `TokenService`, `TransactionService`, `OperationJournalService`, `TokenBalanceService`, and emitted protocol events. It sits in the same 9-commit high-change file described above.

3. **Concrete evidence:** Both incoming arms independently perform this sequence:

   - Re-resolve the token inside the service lock.
   - Check for an existing record.
   - Suppress own outgoing and journal-in-flight transaction hashes.
   - Read trust state; transition `unknown → pending`.
   - Emit `onIncomingTrustChanged` and conditionally `onIncomingTransferPending`.
   - Write the balance outbox before the receipt record.
   - Persist the record.
   - Emit `onIncomingTransferAdded` only for trusted, visible receipts.

   The private-note implementation is at `apps/extension/src/wallet/services/incoming-transfer/service.ts:1013`; its trust transition is at `:1045` and persistence tail at `:1083`. The public-event sibling begins at `:1712`; its dedupe is at `:1736`, trust transition at `:1743`, and persistence tail at `:1762`.

4. **Why it harms future change:** Adding a trust state, changing prompt visibility, modifying dedupe inputs, or altering the outbox-before-record ordering must be applied identically to both arms. A one-arm edit would produce source-dependent behavior for receipts representing the same user concept.

5. **Smallest safe refactoring:** Fowler’s **Extract Function**. Extract a locked `commitIncomingReceipt` workflow parameterized by record identity, existing-record behavior, amount, account/token context, and a record factory. Keep note backfill and public reorg-update behavior outside it.

6. **What disappears after the refactoring:** The second copy of the trust transition, pending-event construction, balance-dirty ordering, record insertion, and trusted visibility emission.

7. **Instances:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:1013`, `:1045`, `:1083`, `:1712`, `:1736`, `:1743`, `:1762`.

---

### Finding: Estimate-reuse caches duplicate lifecycle and drift validation

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** Structural. Blast radius is both estimate-reuse modules plus their construction in `execution/service.ts`. `transfer-estimate-reuse.ts` changed in 4 commits since June 30; its operation sibling was introduced later and has 1 commit, making the duplication a recent extension of the original implementation.

3. **Concrete evidence:** `TransferEstimateReuse` and `OperationEstimateReuse` independently implement:

   - A `Map<string, Entry>` cache.
   - Store, opportunistic stale sweep, and one timer per entry.
   - Explicit eviction.
   - Destructive one-shot lookup.
   - The same 120-second `builtAt` TTL.
   - Active-profile validation.
   - Primary endpoint ID and URL validation.
   - Pending-transaction set equality.
   - Predicted minimum-fee fetch, multiplier application, and base-fee fingerprint comparison.
   - A full-map stale sweep.

   Transfer locations: `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:123`, `:131`, `:141`, `:150`, `:155`, `:179`, `:185`, `:203`, `:228`, `:238`.

   Operation locations: `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:93`, `:98`, `:106`, `:117`, `:122`, `:129`, `:133`, `:138`, `:171`, `:185`.

   Their nearly identical dependency adapters are also wired separately at `apps/extension/src/wallet/services/execution/service.ts:201` and `:208`.

4. **Why it harms future change:** A change to retention, timer cleanup, endpoint identity, pending-set comparison, fee prediction, or logging must be synchronized across two validation ladders. Adding a third estimate-confirm flow would likely copy the same machinery again.

5. **Smallest safe refactoring:** Fowler’s **Extract Class** for a generic one-shot TTL store, followed by **Extract Function** for the shared profile, endpoint, pending-set, and base-fee validators. Each flow retains its operation-specific fingerprint, chain-identity, and FPC checks.

6. **What disappears after the refactoring:** The duplicated map/timer/TTL lifecycle and four duplicated drift gates; the two classes become policy-specific validation adapters.

7. **Instances:** `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:123`, `:131`, `:141`, `:150`, `:155`, `:179`, `:185`, `:203`, `:228`, `:238`; `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:93`, `:98`, `:106`, `:117`, `:122`, `:129`, `:133`, `:138`, `:171`, `:185`; `apps/extension/src/wallet/services/execution/service.ts:201`, `:208`.

---

### Finding: Execution initialization is a 200-line dependency graph encoded imperatively

1. **Smell name:** Long Method, with **config sprawl** as a close analog. Config sprawl maps here because collaborator configuration is distributed across many inline dependency objects and adapter closures rather than represented by a stable execution-component boundary.

2. **Maintenance impact:** Structural. Blast radius is `execution/service.ts` and whichever executor, strategy, cache, or service port is being changed. The facade changed in 12 commits since June 30, the highest observed frequency among the sampled files.

3. **Concrete evidence:**

   - The facade holds more than twenty late-initialized service/component fields at `apps/extension/src/wallet/services/execution/service.ts:98`.
   - `init()` runs from `service.ts:166` through `:367`.
   - It constructs gas balances at `:182`, both reuse caches at `:201`, cancellation and lane machinery at `:222`, transfer execution at `:239`, request building at `:261`, discovery-aware estimation at `:272`, dApp execution at `:286`, view execution at `:316`, fee strategies at `:328`, and cache invalidation listeners at `:342`.
   - Many dependencies are re-exposed through inline forwarding closures, such as network/node/account/journal/logging adapters at `:201`, `:230`, `:239`, and `:286`.

4. **Why it harms future change:** Adding one execution collaborator or changing a port signature requires editing a dense composition method while preserving subtle identity-sharing constraints—such as every consumer receiving the same resolver, lane, builder, and cache instances. Those constraints are implicit in local construction order.

5. **Smallest safe refactoring:** Fowler’s **Extract Function** into cohesive builders such as `buildEstimateCaches`, `buildExecutionLane`, `buildExecutors`, and `buildFeeStrategies`, returning explicitly typed component groups. Preserve construction order and instance identity.

6. **What disappears after the refactoring:** The single 200-line initializer and much of its inline adapter noise; each execution subsystem gains one reviewable composition boundary.

7. **Instances:** `apps/extension/src/wallet/services/execution/service.ts:98`, `:166`, `:182`, `:201`, `:222`, `:230`, `:239`, `:261`, `:272`, `:286`, `:316`, `:328`, `:342`.

---

### Finding: Wallet-SDK startup embeds several runtime controllers in long functions

1. **Smell name:** Long Method, accompanied by Long Parameter List.

2. **Maintenance impact:** Structural. Blast radius is `wallet-sdk/background.ts` plus session baton, queued journal, dApp session/interaction, execution dispatch, and browser-event integrations. The file changed in 4 commits since June 30, spanning quality, security, and activity-siloing work.

3. **Concrete evidence:**

   - `initWalletSdkHandler` spans 374 lines, from `apps/extension/src/wallet/services/wallet-sdk/background.ts:76` through `:450`.
   - Within one closure it constructs the dispatcher (`:86`), owns discovery and session queue state (`:109`, `:120`, `:131`), configures the upstream handler and content-message validation (`:135`), manages session establishment/termination (`:212`), implements wallet-message FIFO and queued-journal choreography (`:263`), monkey-patches decryption serialization (`:326`), reacts to dApp-session deletion and profile unlock (`:346`, `:382`), and installs browser tab listeners (`:416`).
   - `handleDiscovery` is another 158-line method at `:469` and takes nine parameters at `:469-478`, largely because it needs state captured and created by the initializer.
   - The initializer must thread those parameters at both discovery entry points, `:198` and `:397`.

4. **Why it harms future change:** Changing discovery admission, session cleanup, message serialization, or Chrome listener lifecycle requires modifying one closure whose local maps are shared by unrelated callbacks. Extracted handlers still depend on a nine-argument bundle, so adding another shared policy or state owner amplifies edits at every call site.

5. **Smallest safe refactoring:** Fowler’s **Extract Class** plus **Introduce Parameter Object**. A `WalletSdkRuntime` can own the handler, discovery controller, session/decrypt queues, and listener callbacks; `initWalletSdkHandler` then constructs and starts it.

6. **What disappears after the refactoring:** The 374-line closure, the nine-argument discovery calls, and implicit coupling through locally captured mutable maps.

7. **Instances:** `apps/extension/src/wallet/services/wallet-sdk/background.ts:76`, `:86`, `:109`, `:120`, `:131`, `:135`, `:198`, `:212`, `:263`, `:326`, `:346`, `:382`, `:397`, `:416`, `:469`.

---

### Finding: ProfileService changes for authentication, deletion, integrity, and backup

1. **Smell name:** Large Class and Divergent Change.

2. **Maintenance impact:** Architectural. Primary blast radius is `profile/service.ts`; changes can propagate into session management, passkey recovery, integrity coordination, profile deletion, PXE generation fencing, and full-backup flows. The file changed in 9 commits since June 30 across backup, security, Aztec identity, integrity, import, and locking work.

3. **Concrete evidence:**

   - The class owns restore secrets, deletion tombstones/epochs, two integrity repositories, restore-pending markers, delegates, password sealing, and session management at `apps/extension/src/wallet/services/profile/service.ts:90`.
   - Startup restores deletion fences and sessions and applies integrity gates at `service.ts:173`.
   - Password creation/unlock begins at `:260`; passkey creation/unlock/import occupies `:377`.
   - Session, password-change, and operation-confirmation behavior occupies `:551`.
   - The shared session-open integrity/deletion chokepoint begins at `:795`.
   - Durable multi-phase deletion and crash resume occupy `:882` and `:947`.
   - Import/export formats and secret handling begin at `:995`.
   - Full-backup restore and late activation occupy `:1325` through `:1607`, including the class-owned `pendingRestoreSecrets` temporal state.

4. **Why it harms future change:** A change to passkey recovery, backup activation order, password encryption, integrity verification, or deletion fencing all modifies the same 1,608-line service and its global lock discipline. For example, adding a profile credential type requires touching creation, unlock, export, restore, finalization, session opening, deletion cleanup, and several type switches in one class.

5. **Smallest safe refactoring:** Fowler’s **Extract Class**. Start with a `ProfileRestoreCoordinator` owning `restorePending`, `pendingRestoreSecrets`, `restore()`, and `finalizeRestore()`, with narrow repository and verified-session callbacks.

6. **What disappears after the refactoring:** Backup-import temporal state and roughly 280 lines of restore-specific branching leave the core profile/session facade; backup changes stop competing with deletion and ordinary unlock logic in the same class.

7. **Instances:** `apps/extension/src/wallet/services/profile/service.ts:90`, `:173`, `:260`, `:377`, `:551`, `:795`, `:882`, `:947`, `:995`, `:1325`, `:1541`.

## Non-findings considered

- The three mapped TTL caches are not one valid three-way duplicate: `GasBalanceReader` implements stale-while-revalidate, single-flight epochs, degraded results, and cross-profile eviction at `gas-balance-reader.ts:52`; only the two one-shot estimate caches share a lifecycle and change driver.
- The 8,242-line `execution/` directory is not itself a Large Class. Production behavior is already divided among planner, builder, lane, coordinator, executors, resolver, fee strategies, and caches; only its facade composition method remains concentrated.
- `sessionQueues`, `decryptQueues`, `pendingDiscoveryPromises`, and profile-deletion `inflight` are not interchangeable keyed-promise chains: they respectively implement early-release FIFO, completion FIFO, popup single-flight, and idempotent purge single-flight.
- FPC sponsored-fast-path and two-pass estimation have similar scaffolding, but their payload timing, simulation counts, cancellation points, and gas derivations are protocol-distinct; shared pieces such as `probedFirstSimOpts`, `suggestGasLimits`, `finalizeGasLimits`, and `startEstimateTask` are already extracted.
- `packages/bridge-core/src/fee-juice.ts` is a cohesive, stateless extension-reachable leaf; no maintainability smell was found there.
- `apps/extension/src/wallet/services/crypto/` contains only `key-vectors.test.ts`; there is no production implementation in that scoped directory to audit.