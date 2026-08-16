<!-- codex session 01a00a86-4479-7f10-8136-9546eee87703 -->

### Finding: Network RPC methods are declared across parallel registries

1. **Title:** Network RPC methods are declared across parallel registries.

2. **Smell name:** **Shotgun Surgery.** A single RPC addition or signature change must be reproduced in the method type, schema registry, service allowlist/validation, and handwritten client proxy.

3. **Maintenance impact:** **Structural.** Blast radius: `network/spec.ts`, `network/service.ts`, and `network/client.ts`, plus their tests. Git history shows active change: 21 commits for `service.ts`, 9 for `spec.ts`, and 4 for `client.ts`.

4. **Concrete evidence:** The same 16 method identities and argument shapes appear in four forms:

   - Schema registry: `apps/extension/src/wallet/services/network/spec.ts:200`
   - Type-level method contract: `apps/extension/src/wallet/services/network/spec.ts:269`
   - Service RPC allowlist: `apps/extension/src/wallet/services/network/service.ts:152`
   - Handwritten client wrappers: `apps/extension/src/wallet/services/network/client.ts:35`
   - Server-side parameter validation repeats the schema/name/argument tuple at `apps/extension/src/wallet/services/network/service.ts:247`, `:268`, `:276`, `:287`, `:296`, `:310`, `:331`, `:347`, `:389`, `:407`, `:444`, `:486`, `:508`, `:527`, and `:543`.
   - Client-side wrappers repeat the same schema/name/argument tuple and result schema at `apps/extension/src/wallet/services/network/client.ts:35`, `:41`, `:47`, `:53`, `:59`, `:65`, `:71`, `:77`, `:83`, `:89`, `:95`, `:101`, `:112`, `:118`, `:124`, and `:130`.

5. **Why it harms future change:** Adding an RPC such as endpoint priority requires synchronized edits to all four registries. Type checking proves some relationships, but it does not generate the client wrapper or server validation; a missed edit can leave validation asymmetric or make a valid implementation unreachable over RPC.

6. **Smallest safe refactoring:** **Replace Repetition with a schema-aware generated proxy**—a close analog of Fowler’s **Extract Function**. Add an exhaustive `defineValidatedPassthroughs<Methods>()` driven by `NetworkMethodSchemas`, and use the same metadata to install server boundary validation.

7. **What disappears after the refactoring:** The 16 handwritten client bodies and the 15 repeated service-side `validateParams(schema, args, methodName)` statements. The method schemas remain the authoritative runtime contract.

8. **Instances:** All duplicated declarations are at:

   - `apps/extension/src/wallet/services/network/spec.ts:200-267`
   - `apps/extension/src/wallet/services/network/spec.ts:269-337`
   - `apps/extension/src/wallet/services/network/service.ts:152-169`
   - `apps/extension/src/wallet/services/network/service.ts:247,268,276,287,296,310,331,347,389,407,444,486,508,527,543`
   - `apps/extension/src/wallet/services/network/client.ts:35-134`

### Finding: NetworkService owns persistence, connectivity, and deletion orchestration

1. **Title:** `NetworkService` combines three independently changing subsystems.

2. **Smell name:** **Large Class.** The class owns network-row CRUD, active-selection persistence, live node/cache management, endpoint probing, and a cross-service deletion cascade.

3. **Maintenance impact:** **Architectural.** Blast radius: the 869-line `network/service.ts`, its 1,069-line test file, and consumers including transaction polling, PXE, account, token, FPC, and auth-registry services. `service.ts` has changed in 21 commits, the hottest file in this audit cluster.

4. **Concrete evidence:**

   - Row storage, mutation lock, two connection caches, node factory, and service collaborators coexist at `apps/extension/src/wallet/services/network/service.ts:172-196`.
   - Network and endpoint CRUD occupy `apps/extension/src/wallet/services/network/service.ts:209-522`.
   - Node probing, active-node construction, URL-pinned transient caching, and failure eviction occupy `apps/extension/src/wallet/services/network/service.ts:524-628`.
   - Cross-service purge ordering and error aggregation occupy `apps/extension/src/wallet/services/network/service.ts:630-689`.
   - Backup, restore, profile deletion, cache invalidation, and active-pointer cleanup occupy `apps/extension/src/wallet/services/network/service.ts:691-782`.
   - Active selection is separately persisted through raw storage keys at `apps/extension/src/wallet/services/network/service.ts:846-853`.

5. **Why it harms future change:** A change to RPC retry behavior or transient-node eviction requires editing the same class and tests that enforce row ownership, endpoint invariants, backup restoration, and deletion ordering. Conversely, a storage or deletion change risks the connection-cache lifecycle because both share the same lock and profile-change handler.

6. **Smallest safe refactoring:** Fowler’s **Extract Class**. First extract a `NetworkNodePool` owning `nodes`, `transientNodes`, `nodeFactory`, probing, failure reporting, and cache clearing. Keep `NetworkService` as its facade so callers and RPC contracts do not change.

7. **What disappears after the refactoring:** Two cache maps, cache failure policy, node construction/probing, and profile-switch cache clearing disappear from the row service. A later independent extraction can move the purge coordinator without coupling it to the first change.

8. **Instances:**

   - Mixed state and dependencies: `apps/extension/src/wallet/services/network/service.ts:172-196`
   - Row/endpoint responsibility: `apps/extension/src/wallet/services/network/service.ts:209-522`
   - Connectivity responsibility: `apps/extension/src/wallet/services/network/service.ts:524-628`
   - Cascade responsibility: `apps/extension/src/wallet/services/network/service.ts:630-689`
   - Backup/profile lifecycle responsibility: `apps/extension/src/wallet/services/network/service.ts:691-782`
   - Active-pointer persistence: `apps/extension/src/wallet/services/network/service.ts:846-853`

### Finding: Token import orchestration is duplicated for user and seeded tokens

1. **Title:** User and default-token imports duplicate one durable state machine.

2. **Smell name:** **Duplicate Code.**

3. **Maintenance impact:** **Structural.** Blast radius: `token/service.ts` and the token composition/seeder tests. The service has changed in 14 commits.

4. **Concrete evidence:** `addToken` and `addSeededToken` both perform the same sequence:

   - Check `(profileId, chainId, contract)` idempotency.
   - Create a `token_import` journal operation.
   - Acquire the token lock.
   - Transition the journal to `simulating`.
   - Recheck token existence under the lock.
   - Allocate an ID and copy all function descriptors from `TokenInterface`.
   - Persist and emit `onTokenAdded`.
   - Transition to `succeeded`.
   - On failure, classify, transition to `failed`, and rethrow.

   The two implementations are at `apps/extension/src/wallet/services/token/service.ts:178-268` and `apps/extension/src/wallet/services/token/service.ts:283-350`. Their legitimate differences are metadata acquisition and journal labels, not orchestration.

5. **Why it harms future change:** Any change to token-import journal stages, error classification, idempotency boundaries, or emitted payloads must be applied twice while preserving subtle lock ordering. The existing comments explicitly pin that ordering, increasing the chance that one path drifts during a future workflow change.

6. **Smallest safe refactoring:** Fowler’s **Extract Function** with a Template Method-style callback: extract `persistImportedToken(context, resolveMetadata)` and supply either the user metadata fetch or the already-validated seed snapshot.

7. **What disappears after the refactoring:** One copy of the journal/lock/idempotency/persist/success/failure state machine and one copy of the 17-field token construction.

8. **Instances:**

   - User import: `apps/extension/src/wallet/services/token/service.ts:178-268`
   - Seed import: `apps/extension/src/wallet/services/token/service.ts:283-350`

### Finding: Malformed-note fallback repeats eight exception frames

1. **Title:** Note field projection repeats the same exception-swallowing conversion eight times.

2. **Smell name:** **Duplicate Code.** The fallback behavior is intentional; the smell is the repeated `try { convert(field) } catch { return sentinel }` implementation.

3. **Maintenance impact:** **Local.** Blast radius: only `note/service.ts`; the eight methods are used while constructing success and render-error rows. The file has changed in 5 commits.

4. **Concrete evidence:** Five string projections and three numeric projections differ only by selected field and fallback:

   - `safeContractAddress`: `apps/extension/src/wallet/services/note/service.ts:144`
   - `safeStorageSlot`: `apps/extension/src/wallet/services/note/service.ts:152`
   - `safeTxHash`: `apps/extension/src/wallet/services/note/service.ts:160`
   - `safeSiloedNullifier`: `apps/extension/src/wallet/services/note/service.ts:168`
   - `safeNoteHash`: `apps/extension/src/wallet/services/note/service.ts:176`
   - `safeBlockNumber`: `apps/extension/src/wallet/services/note/service.ts:184`
   - `safeTxIndex`: `apps/extension/src/wallet/services/note/service.ts:192`
   - `safeNoteIndex`: `apps/extension/src/wallet/services/note/service.ts:200`

5. **Why it harms future change:** If malformed-field handling later needs diagnostics, a different sentinel, or explicit distinction between missing and conversion-failed data, eight methods must change consistently. The conversions are already called from both normal and error-row construction at `apps/extension/src/wallet/services/note/service.ts:102-127`.

6. **Smallest safe refactoring:** Fowler’s **Extract Function**: a generic `safeConvert(convert, fallback)` helper, with small `safeString` and `safeNumber` wrappers if that improves inference.

7. **What disappears after the refactoring:** Eight repeated try/catch frames; only declarative field selection and the intended fallback values remain.

8. **Instances:** `apps/extension/src/wallet/services/note/service.ts:144-206`, consumed at `apps/extension/src/wallet/services/note/service.ts:102-127`.

## Non-findings considered

- **Three-file service/spec/client convention:** NON-FINDING generally. The files represent real process-boundary roles; pure clients already use the exhaustive passthrough extraction from the prior dedup remediation. Only Network’s residual schema-aware handwritten layer creates measurable change amplification.
- **Per-service `new Lock()`:** NON-FINDING. Each instance protects independent mutable state, while the duplicated acquisition/release algorithm was already removed by `Lock.withLock()` in Q-01.
- **Alarm consumers:** NON-FINDING for this cluster. Price alarms require synchronous module-scope MV3 dispatch and config/session reconciliation; session expiry uses a one-shot timestamp gate. The only close periodic twins are JournalReaper and JournalGC, outside this scan’s source scope.
- **Remaining backup/restore/purge methods:** NON-FINDING. Shared loops and allocation/ownership rules are already extracted; the residual validation, event, ID, and ordering policies are service-specific.
- **Storage migration template and empty registry:** NON-FINDING because they are migration authoring/registration infrastructure, not duplicated production behavior or production-wired dead code.
- **Task async/sync accessors:** NON-FINDING. Their small duplication serves two distinct call surfaces and does not currently create cross-file change amplification.