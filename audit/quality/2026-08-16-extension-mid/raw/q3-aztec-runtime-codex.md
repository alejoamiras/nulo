<!-- codex session 01a00a86-4451-7580-97ea-ebc3ed475b4d -->

### Finding: `PxeService` combines RPC façade, concurrency control, lifecycle fencing, and storage erasure

1. **Smell name:** Large Class, with Divergent Change. The class changes for unrelated reasons: Aztec RPC adaptation, locking policy, profile-incarnation fencing, artifact resolution, public-event access, and persistent-store cleanup.

2. **Maintenance impact:** **Structural.** The immediate blast radius is `packages/aztec-runtime/src/pxe/service.ts` plus its service/client and lifecycle tests; all 25 RPC methods share this central class. It is also high-churn: the file changed in 14 commits between 2026-05-19 and 2026-08-16.

3. **Concrete evidence:**

   - The class declares 25 RPC endpoints at `packages/aztec-runtime/src/pxe/service.ts:75`.
   - It owns five separate lifecycle/concurrency state collections at `service.ts:131`, `service.ts:138`, `service.ts:139`, `service.ts:146`, and `service.ts:162`.
   - It performs orphan-store discovery and deletion at `service.ts:224`.
   - It adapts and validates Aztec RPC calls across `service.ts:273`–`service.ts:615`.
   - It coordinates destructive chain/profile teardown at `service.ts:626` and `service.ts:655`.
   - It implements runtime binding, retry, locking, generation checks, and purge fencing at `service.ts:803`–`service.ts:904`.
   - Artifact-registry construction and use add another responsibility at `service.ts:142`, `service.ts:168`, `service.ts:273`, and `service.ts:313`.

4. **Why it harms future change:** An Aztec SDK signature upgrade, a profile-deletion policy change, and a lock/fencing change all modify the same class and frequently the same helper paths. This increases merge conflicts and forces maintainers changing a thin RPC adapter to reason about profile barriers, store-key erasure, IndexedDB compatibility, and runtime resurrection.

5. **Smallest safe refactoring:** Fowler’s **Extract Class**. First extract a `PxeLifecycleCoordinator` owning guards, purge epochs, profile generations, store keys, runtime binding, and destructive teardown. Keep `PxeService` as the RPC boundary delegating operations through that coordinator.

6. **What disappears after the refactoring:** The service’s five-map lifecycle state block, its lock acquisition/rebind machinery, and storage-erasure orchestration disappear from the RPC façade. Changes to lifecycle policy no longer edit the same class as ordinary RPC additions.

7. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:72`, `:75`, `:103`, `:131`, `:138`, `:139`, `:142`, `:146`, `:162`, `:224`, `:273`, `:313`, `:329`, `:416`, `:437`, `:586`, `:626`, `:655`, `:720`, `:760`, `:803`, `:816`, `:875`.

---

### Finding: IndexedDB deletion protocol is implemented three times

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** **Local.** Blast radius is one module, `pxe/service.ts`, but it covers three destructive storage paths: orphan PXE databases, the legacy shared key-value database, and awaited profile/chain erasure. The variants were introduced and modified in different commits: the sweep wrappers date from the initial import/5.0.1 work, while `deleteDb` was added in the 2026-07-12 deletion hardening.

3. **Concrete evidence:** All three locations call `indexedDB.deleteDatabase`, wrap its request in a `Promise`, and install `onsuccess`, `onerror`, and `onblocked` handlers:

   - Orphan database sweep: `packages/aztec-runtime/src/pxe/service.ts:242`–`:250`. Blocked deletion logs and resolves `false`.
   - Shared `keyval-store` sweep: `service.ts:259`–`:267`. Blocked deletion logs and resolves successfully.
   - Extracted destructive helper: `service.ts:760`–`:774`. Blocked deletion starts a timeout and eventually rejects.

   The subtle policy differences are embedded inside otherwise duplicated request plumbing.

4. **Why it harms future change:** A future IndexedDB compatibility change—normalizing missing `req.error`, clearing blocked timers, adding telemetry, or handling a browser-specific event—must be made three times. The already-different blocked semantics make it easy to accidentally copy the fail-closed behavior into best-effort sweeping, or vice versa.

5. **Smallest safe refactoring:** Fowler’s **Extract Function**. Create one request adapter such as `requestDeleteDb(name, blockedPolicy)` and represent the intentional policies explicitly (`skip`, `ignore`, `rejectAfter(timeout)`).

6. **What disappears after the refactoring:** Three copies of `deleteDatabase` event-to-promise plumbing disappear; only the three explicit blocked-deletion policies remain at call sites.

7. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:242`, `:259`, `:760`.

---

### Finding: Purge-epoch resurrection fencing is duplicated across read and write paths

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** **Local.** Blast radius is the two runtime-binding paths in `pxe/service.ts`. Both copies were introduced together in the 2026-07-18 Aztec 5.0.1 change; the file has changed five more times since then.

3. **Concrete evidence:**

   - `withPxeRead` snapshots the epoch at `packages/aztec-runtime/src/pxe/service.ts:828`, re-reads it at `:844`, and throws the purge-resurrection error at `:845`.
   - `withPxeWrite` independently snapshots it at `service.ts:879`, re-reads it at `:889`, and emits the same error at `:890`.
   - Both copies construct the same key through `chainKey(profileId, chainId)`, default a missing epoch to zero, compare against the entry snapshot, and reject runtime recreation with the same message.

4. **Why it harms future change:** If the fence gains a typed error, richer epoch state, telemetry, or a different rule for newly re-added networks, both paths must change identically. This fence exists specifically because one path previously lacked the check, so leaving two independent copies preserves the same change-amplification risk.

5. **Smallest safe refactoring:** Fowler’s **Extract Function**: `capturePurgeEpoch(network)` plus `assertPurgeEpochCurrent(network, capturedEpoch, label)`, or a small immutable fence token exposing `assertCurrent()`.

6. **What disappears after the refactoring:** The repeated chain-key lookup, zero default, comparison, and duplicated resurrection-error construction.

7. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:828`, `:844`–`:846`, `:879`, `:889`–`:891`.

---

### Finding: Profile-event integration retains one unused hook and one no-op subscription

1. **Smell name:** Dead Code. The deletion event is a required interface member with no production read, while the active-profile event is subscribed to a handler whose body performs no action.

2. **Maintenance impact:** **Structural.** The production declaration and wiring are in `pxe/service.ts`; three runtime test harnesses must manufacture both event properties. The deletion subscriber was removed on 2026-07-12, but its interface requirement remained.

3. **Concrete evidence:**

   - `IProfileReader` requires `onProfileDeleted` at `packages/aztec-runtime/src/pxe/service.ts:68`, but repository search finds no `this.profiles.onProfileDeleted` access in the runtime package. The only cluster occurrences outside the declaration are inert test fixture fields at:
     - `packages/aztec-runtime/src/pxe/service.test.ts:40`
     - `packages/aztec-runtime/src/pxe/stub-overrides.test.ts:47`
     - `packages/aztec-runtime/src/pxe/incarnation-fence.test.ts:27`
   - `onActiveProfileChanged` is required at `service.ts:69` and subscribed at `service.ts:210`, but its handler at `service.ts:906`–`:914` contains only comments.
   - The corresponding inert test fields are `service.test.ts:41`, `stub-overrides.test.ts:48`, and `incarnation-fence.test.ts:28`.
   - `createPxeOffscreen` manually constructs `PxeService` at `packages/aztec-runtime/src/offscreen/entry.ts:45`; there is no auto-registration mechanism that can invoke the deleted hook.

4. **Why it harms future change:** Every alternative profile-reader or test fake must expose events the PXE service does not use. More importantly, the live subscription suggests profile-switch behavior exists, so future maintainers must inspect a nine-line comment and history before discovering that the integration is intentionally inert.

5. **Smallest safe refactoring:** Fowler’s **Remove Dead Code**: remove both event members from `IProfileReader`, remove the active-profile subscription and empty handler, and delete the fixture-only properties.

6. **What disappears after the refactoring:** The unused deletion-event contract, the no-op runtime subscription, the empty handler, and six test-fixture accommodations.

7. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:68`–`:69`, `:210`, `:906`–`:914`; `packages/aztec-runtime/src/pxe/service.test.ts:40`–`:41`; `packages/aztec-runtime/src/pxe/stub-overrides.test.ts:47`–`:48`; `packages/aztec-runtime/src/pxe/incarnation-fence.test.ts:27`–`:28`; manual construction confirmation at `packages/aztec-runtime/src/offscreen/entry.ts:45`.

---

### Finding: Artifact resolution carries unused future-policy plumbing

1. **Smell name:** Speculative Generality. The source explicitly says the network argument exists for “future per-chain policy hooks,” while production uses neither per-chain context nor configurable policy.

2. **Maintenance impact:** **Structural.** Blast radius covers `artifact-registry.ts`, the PXE barrel, the service call, and policy-only consumer tests. The registry has changed three times since initial import, but the production policy surface remains unused.

3. **Concrete evidence:**

   - `ArtifactNetworkContext.chainId` is declared solely for future hooks at `packages/aztec-runtime/src/pxe/artifact-registry.ts:14`–`:18`.
   - `resolve` receives it as an intentionally unused `_network` parameter at `artifact-registry.ts:159`–`:164`.
   - Configurable policy types/defaults are defined at `artifact-registry.ts:20`–`:35`; policy state and accessors are at `:63`, `:90`, and `:96`–`:104`.
   - Resolution pays for the generic order/pinning loop and switch at `artifact-registry.ts:165`–`:189`.
   - Production has exactly one `resolve` caller, at `packages/aztec-runtime/src/pxe/service.ts:316`, and no production call to `setPolicy` or `getPolicy`.
   - `defaultPolicy`, `ArtifactPolicy`, and `ArtifactSource` are exported at `packages/aztec-runtime/src/pxe/index.ts:3`; repository search finds their only consumer outside the registry in `apps/extension/src/wallet/services/pxe/artifact-registry.test.ts:5`, `:104`, and `:123`.

4. **Why it harms future change:** Adding or changing an artifact source requires reasoning about an extensibility model that no running code configures. Conversely, changing `NetworkInfo` or the resolver signature must preserve and thread an argument that contributes nothing to current resolution.

5. **Smallest safe refactoring:** Fowler’s **Change Function Declaration** and **Inline Function**: remove `_network`, setters/getter, exported policy types/default factory, and express the actual fixed `pxe-local → known` resolution directly.

6. **What disappears after the refactoring:** The unused network-context interface and parameter, mutable policy state, public policy accessors, pin/order branching, barrel exports, and policy-only tests.

7. **Instances:** `packages/aztec-runtime/src/pxe/artifact-registry.ts:14`–`:35`, `:63`, `:90`, `:96`–`:104`, `:159`–`:189`; `packages/aztec-runtime/src/pxe/service.ts:316`; `packages/aztec-runtime/src/pxe/index.ts:3`; `apps/extension/src/wallet/services/pxe/artifact-registry.test.ts:5`, `:104`–`:105`, `:123`.

---

### Finding: Transaction construction exposes six positional collaborators and inputs

1. **Smell name:** Long Parameter List.

2. **Maintenance impact:** **Structural.** The signature is duplicated in the account interface and implementation and has three production call sites. `nulo-account.ts` changed in five commits between May and July 2026, including multiple Aztec protocol upgrades.

3. **Concrete evidence:**

   - `IAccountContract.buildTxExecutionRequest` declares six positional parameters at `packages/aztec-runtime/src/account/index.ts:29`–`:36`.
   - `NuloAccount` repeats the signature at `packages/aztec-runtime/src/account/nulo-account.ts:116`–`:123`.
   - Production callers assemble the positional sequence at:
     - `apps/extension/src/wallet/utils/fn.ts:95`–`:105`
     - `apps/extension/src/wallet/services/execution/tx-request-builder.ts:360`–`:371`
     - `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:453`–`:464`
   - The list mixes infrastructure collaborators (`node`, `pxe`) with transaction data (`payload`, entrypoint options, chain identity, optional gas settings).

4. **Why it harms future change:** Adding another execution context value or splitting gas/fee behavior requires coordinated edits to the interface, implementation, and every builder. At call sites, the meaning of `node, pxe, payload, options, chainInfo, gasSettings` is carried only by position, making protocol-upgrade edits harder to review.

5. **Smallest safe refactoring:** Fowler’s **Introduce Parameter Object**, for example `BuildTxExecutionRequestArgs`. Keep it narrow and use named fields; no new abstraction hierarchy is needed.

6. **What disappears after the refactoring:** The six-value positional convention and duplicated multiline ordering at all three callers. Future optional execution inputs become localized object fields.

7. **Instances:** `packages/aztec-runtime/src/account/index.ts:29`–`:36`; `packages/aztec-runtime/src/account/nulo-account.ts:116`–`:123`; `apps/extension/src/wallet/utils/fn.ts:95`–`:105`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:360`–`:371`; `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:453`–`:464`.

---

### Finding: Block timestamp lookup silently converts every failure into “not found”

1. **Smell name:** Exception Swallowing / error-as-success-path. This is the named error-handling analog: validation failures, transport failures, and genuine missing blocks are collapsed into the same normal `undefined` result without preserving or logging the exception.

2. **Maintenance impact:** **Structural.** The immediate smell is local to `pxe/service.ts`, but the conflated result is encoded through the RPC spec/client and consumed by the extension note/incoming-transfer services. The behavior was introduced on 2026-06-05 and has not been refined since.

3. **Concrete evidence:**

   - `getBlockTimestamp` wraps both schema parsing and `node.getBlock` at `packages/aztec-runtime/src/pxe/service.ts:566`–`:574`.
   - Its bare catch at `service.ts:575`–`:576` returns `undefined` for every exception.
   - The RPC contract documents network errors as ordinary `undefined` at `packages/aztec-runtime/src/pxe/spec.ts:75`–`:82`; the client preserves that at `packages/aztec-runtime/src/pxe/client.ts:283`–`:289`.
   - The immediate extension handler already has an error boundary that logs failures at `apps/extension/src/wallet/services/note/service.ts:67`–`:75`, but node/schema errors never reach it because the inner service catch has swallowed them.
   - The resulting `undefined` is cached as if it were a resolved lookup at `apps/extension/src/wallet/services/incoming-transfer/service.ts:999`–`:1004`.

4. **Why it harms future change:** Adding retries, outage telemetry, invalid-block diagnostics, or different fallback behavior requires changing a cross-process return contract because the origin of `undefined` has been erased. During maintenance, node outages are indistinguishable from legitimate absent blocks, and the existing outer logging boundary cannot observe them.

5. **Smallest safe refactoring:** **Replace Error-as-Success with Exception Propagation**: return `undefined` only when `node.getBlock` genuinely returns no block; let parse and node exceptions propagate to the already-present `NoteService` catch/log boundary. If callers later need typed differentiation, introduce a small result type there.

6. **What disappears after the refactoring:** The bare catch, silent loss of failure context, and unreachable-for-node-errors portion of the outer logging boundary.

7. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:564`–`:577`; contract propagation at `packages/aztec-runtime/src/pxe/spec.ts:75`–`:82` and `packages/aztec-runtime/src/pxe/client.ts:283`–`:289`; immediate handler and consumer at `apps/extension/src/wallet/services/note/service.ts:67`–`:75` and `apps/extension/src/wallet/services/incoming-transfer/service.ts:999`–`:1004`.

## Non-findings considered

- `pxe/index.ts`’s 12-file re-export fan-in is a barrel boundary, not a named smell by itself; it introduces no cycle or duplicated behavior.
- Untested `effective-class`, adapter, fetch, and account modules were not flagged merely for coverage asymmetry; their structures do not inherently resist testing.
- `ArtifactRegistry.clear()` has no production caller and a stale deletion comment, but it has explicit test callers and is public API, so it does not satisfy the requested no-inbound-reference standard for Dead Code.
- `ChainRuntime.dispose()` deliberately ignores `pxe.stop()` failure while still propagating the store-close failure; this is bounded best-effort teardown rather than an unqualified exception-swallowing finding.
- The generated `PXEProxy` forwarding surface is driven by descriptors and compile-time consistency assertions, so it is not duplicate client code.
- The long concurrency comments in `service.ts` document non-obvious lock and lifecycle invariants; they are not Comments-as-deodorant on their own.
- No package-internal cyclic dependency was found.