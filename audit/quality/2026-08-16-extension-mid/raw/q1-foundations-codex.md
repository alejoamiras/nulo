<!-- codex session 01a00a86-4433-77b3-a9e5-e2a4dbc9ca8d -->

### Finding: Event subscriber failures are silently erased

1. **Title:** Event subscriber failures are silently erased.

2. **Smell name:** **Exception swallowing** — an error-handling analog of a missing error boundary. The event boundary catches subscriber exceptions but supplies no reporting, result, or diagnostic channel.

3. **Maintenance impact:** **Architectural.** The behavior is centralized in one module but inherited by 52 production files across wallet services, clients, messaging, stores, and composables. Production dispatch occurs through extension configuration/log stores and `extension-messaging`. The implementation has not changed since the initial import on 2026-05-19, although four representative dispatch modules changed across 10 commits since then.

4. **Concrete evidence:** `EventHandler.invoke()` catches every synchronous subscriber exception with an empty `catch {}` at `packages/wallet-core/src/utils/event-handler.ts:22-26`. The callback contract provides no error channel at `packages/wallet-core/src/utils/event-handler.ts:1-3`. Representative production handoffs include `apps/extension/src/wallet/config/store.ts:65`, `apps/extension/src/wallet/logger/store.ts:41`, `packages/extension-messaging/src/background/client.ts:57`, and `packages/extension-messaging/src/core/base-client.ts:211`. No colocated `event-handler.test.ts` exists.

5. **Why it harms future change:** If a subscriber starts throwing after a refactor or schema change, the publisher still appears successful and the failure leaves no stack, event identity, or subscriber identity. Maintainers must trace every possible listener to discover why one downstream projection stopped updating.

6. **Smallest safe refactoring:** **Introduce Error Boundary** (named analog): preserve per-subscriber isolation, but accept an optional error reporter and invoke it with the caught error and event context. Add a focused contract test.

7. **What disappears after the refactoring:** The empty catch and the need to reproduce or instrument every subscriber manually to locate a failed listener.

8. **Instances:** `packages/wallet-core/src/utils/event-handler.ts:22-26`.

### Finding: Force-release watchdog machinery is maintained twice

1. **Title:** Force-release watchdog machinery is maintained twice.

2. **Smell name:** **Duplicate Code.** `Lock` and `ReadWriteGuard` need different exclusion policies, but independently implement the same timer lifecycle and force-release infrastructure.

3. **Maintenance impact:** **Structural.** A watchdog hardening change currently spans two production modules and their two large test suites. The primitives reach 24 production files containing `Lock` and the PXE guard modules using `ReadWriteGuard`. The pair has changed in three commits since the initial import: `ReadWriteGuard` in July 2026 and `Lock` independently in August 2026.

4. **Concrete evidence:**

   - Both own a mutable timer handle: `packages/wallet-core/src/utils/lock.ts:12` and `packages/wallet-core/src/utils/rw-guard.ts:72`.
   - Both arm `setTimeout`, inspect live ownership, log expiry, forcibly release ownership, and possibly wake waiters: `packages/wallet-core/src/utils/lock.ts:49-59` and `packages/wallet-core/src/utils/rw-guard.ts:160-195`.
   - Both manually clear and reset the timer handle: `packages/wallet-core/src/utils/lock.ts:78-82` and `packages/wallet-core/src/utils/rw-guard.ts:197-201`.
   - The copies have already drifted: `Lock` guards timer creation and logging against exceptions at `packages/wallet-core/src/utils/lock.ts:49-59` and `packages/wallet-core/src/utils/lock.ts:94-100`; the corresponding `ReadWriteGuard` path calls both directly at `packages/wallet-core/src/utils/rw-guard.ts:160-194`. Its documentation also still says “35 minutes” at `packages/wallet-core/src/utils/rw-guard.ts:53` while the constant is 90 minutes at line 16.
   - Separate watchdog contracts are maintained in `packages/wallet-core/src/utils/lock.test.ts:65-71`, `packages/wallet-core/src/utils/lock.test.ts:128-138`, `packages/wallet-core/src/utils/lock.test.ts:373-383`, and `packages/wallet-core/src/utils/rw-guard.test.ts:351-395`.

5. **Why it harms future change:** A cross-cutting change such as making timers platform-failure-safe, attaching structured diagnostics, or changing cancellation behavior must be rediscovered and implemented twice. The August hardening reaching only `Lock` demonstrates that amplification rather than merely predicting it.

6. **Smallest safe refactoring:** Fowler’s **Extract Class**: introduce a small internal force-release watchdog that owns `arm`, `cancel`, timer-handle state, and best-effort reporting. Keep each primitive’s distinct expiry callback and timeout policy injected into it.

7. **What disappears after the refactoring:** Two timer fields, two arm/cancel implementations, duplicated platform-failure handling, and the obligation to harden timer infrastructure separately.

8. **Instances:** `packages/wallet-core/src/utils/lock.ts:12`, `packages/wallet-core/src/utils/lock.ts:49-59`, `packages/wallet-core/src/utils/lock.ts:78-82`; `packages/wallet-core/src/utils/rw-guard.ts:72`, `packages/wallet-core/src/utils/rw-guard.ts:160-201`.

### Finding: ActivityScopeReset is an unused public protocol shape

1. **Title:** `ActivityScopeReset` is an unused public protocol shape.

2. **Smell name:** **Dead Code.**

3. **Maintenance impact:** **Structural.** The declaration is local to the activity model, but wildcard export makes it part of the public `@nulo/wallet-core/activity` surface. It was introduced in the activity feature commit on 2026-07-24 and has never been used.

4. **Concrete evidence:** The interface is declared at `packages/wallet-core/src/activity/model.ts:59-63` and publicly exposed by `packages/wallet-core/src/activity/index.ts:2` through the package subpath configured at `packages/wallet-core/package.json:16`. Repo-wide search outside its declaration found no source reference; the only other occurrence is design prose in `implementations-plan/account-profile-siloing/plan.md:187`. The implemented reset path instead accepts a bare `ActivityIncarnation` at `packages/wallet-core/src/activity/causal.ts:256-261`. Auto-import cannot provide a hidden consumer: `apps/extension/vite.config.ts:143` scans only extension composable/store/utility directories, while component registration at lines 155-157 scans component directories and the design resolver.

5. **Why it harms future change:** A maintainer evolving the reset protocol must decide whether this exported envelope is a supported transport contract, update it defensively, or prove again that it was never wired. It also suggests a nonexistent envelope-based reset path to consumers.

6. **Smallest safe refactoring:** Fowler’s **Remove Dead Code**. Remove the interface; if externally published consumers must be protected, deprecate it for one release before removal.

7. **What disappears after the refactoring:** An unsupported public protocol concept and the ambiguity between envelope-based reset and the actual `resetScope(state, incarnation)` API.

8. **Instances:** `packages/wallet-core/src/activity/model.ts:59-63`; public exposure at `packages/wallet-core/src/activity/index.ts:2`.

### Finding: PXE KDF identity has two sources of truth

1. **Title:** PXE KDF identity has two sources of truth.

2. **Smell name:** **Duplicate Code** — the same consensus-critical literal independently defines the actual HKDF input and the exported vector identity.

3. **Maintenance impact:** **Local.** The duplication affects one production module and the external key-vector test. The module was introduced in one commit on 2026-07-18 and has not changed since.

4. **Concrete evidence:** The derivation input embeds `"nulo:pxe-store:v1"` at `packages/wallet-crypto/src/pxe-store-key.ts:20`, while the exported label repeats it at `packages/wallet-crypto/src/pxe-store-key.ts:23`. Derivation consumes only the encoded copy at line 32. The vector separately asserts the exported string at `apps/extension/src/wallet/crypto/key-vectors.test.ts:217` and tests the derived bytes at lines 216-225.

5. **Why it harms future change:** Any deliberate versioned KDF migration must update two source literals. Updating only the exported identity or only the encoded derivation input creates contradictory API metadata and vector failures rather than a single explicit version change.

6. **Smallest safe refactoring:** Fowler’s **Replace Magic Literal with Symbolic Constant**: declare `PXE_STORE_KDF_LABEL` once, then compute `PXE_STORE_INFO = new TextEncoder().encode(PXE_STORE_KDF_LABEL)`.

7. **What disappears after the refactoring:** The second literal and the synchronization obligation between exported metadata and actual cryptographic input.

8. **Instances:** `packages/wallet-crypto/src/pxe-store-key.ts:20` and `packages/wallet-crypto/src/pxe-store-key.ts:23`.

## Non-findings considered

- `EntityStorage` versus `ValueStorage`: **NON-FINDING** — their shared adapter shape is small, while malformed-data behavior is deliberately different, documented at `entity_storage.ts:45-83` and `value-storage.ts:8-20`, and extracting it would obscure the safety boundary.
- Error normalization paths: **NON-FINDING** — `errorMessageFromUnknown`, `getErrorMessage`, and `normalizeError` serve explicitly different persisted/wire semantics; `utils/errors.ts:18-27` documents why coercion cannot currently be unified.
- `utils/index.ts` barrel: **NON-FINDING** — it is broad, but the package export map intentionally exposes `./utils` as the supported subpath; no measurable change amplification was found.
- AES-GCM framing in `EncryptionKey` and `SessionSecretBox`: **NON-FINDING** — the similar mechanics implement intentionally distinct password and session domains, formats, KDFs, and failure contracts.
- Missing colocated passkey/PXE tests: **NON-FINDING** — the production contracts are pinned by the extension-level key-vector suite, so no concrete test brittleness was established.
- `Migrator` size: **NON-FINDING** — its length follows one cohesive journaled migration state machine; no separable Long Method or Divergent Change root cause was established.