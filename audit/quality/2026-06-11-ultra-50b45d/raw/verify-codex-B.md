### Q9 — ADJUSTED (high)
Independent assessment: the cited code shows two readiness mechanisms coexisting: declarative startup deps on a few services, and repeated per-method `await this.ensureInitialized()` everywhere else. That is real temporal-policy drift plus copied guard code.  
Instance check: all cited exact locations support the claim, but the family is undercounted; the same preamble also appears heavily in `account-state`, `execution`, `note`, `operation-journal`, `dapp-interaction`, and `token-balance`.  
Corrections: adjust the instance list upward; the smell is broader than the ten counted services. No cited location is false.  
Refactoring sanity: “move gating to one dispatch boundary” is not the smallest safe change because many calls are in-process, not RPC-only. Safer first step: centralize transport-side gating in the base service class and separately expand `dependencies`.

### Q10 — ADJUSTED (high)
Independent assessment: `runtime.ts` is visibly half-injecting infrastructure while many services still hard-bind `chrome.storage.*` or instantiate their own `PxeServiceClient`. That does create constructor/init fan-out when storage or PXE wiring changes.  
Instance check: the cited lines are valid, but incomplete. Missed nearby examples include `profile/service.ts:56-67`, `operation-journal/service.ts:74-87`, `token-balance/balance-repository.ts:19-20`, and `incoming-transfer/repository.ts:33-35`.  
Corrections: keep the smell, widen the instance set.  
Refactoring sanity: injecting shared storage/PXE collaborators from `runtime.ts` is directionally right, but the smallest safe step is per-collaborator factory/port injection, not a broad composition-root rewrite.

### Q11 — ADJUSTED (high)
Independent assessment: [dispatcher.ts](packages/wallet-bridge/src/dispatcher.ts:227) is a 1011-line hub mixing routing, capability handling, popup orchestration, operation building, and account projection. The session-account lookup/projection logic is repeated.  
Instance check: real duplication exists around `494-497`, `721-747`, and `989-997`. But `347-358` is the extracted helper itself, and `599-600` is only a partial account-load snippet. The broad ranges `227-292`, `404-521`, `531-760`, `867-1006` show hotspot scope, not pure duplicate-code regions.  
Corrections: this is “Large Class plus a smaller duplicated account/session flow,” not one giant duplicated block.  
Refactoring sanity: extracting account-resolution first is the smallest safe move; extracting grant management too can follow.

### Q12 — ADJUSTED (high)
Independent assessment: four fixtures repeat the same `phase()` wrapper and the same launch/register/open/switch/connect ladder, and three fixtures repeat near-identical capability-grant choreography. The module is also overloaded with page-bootstrap and DOM helper duties.  
Instance check: `extension.ts:383-570` clearly supports duplication. `extension.ts:997-1018,1088-1236` and `helpers.ts:2,20` support hotspot/mixed-concern concerns, but they are not duplicate-code instances by themselves.  
Corrections: keep the hotspot finding, narrow the duplication evidence; “`TEST_PASSWORD` is defined but not exported” is not a smell on its own.  
Refactoring sanity: extracting `phase`, a shared connected-playground setup helper, and a parametrized cap-grant helper is safe and small. Splitting DOM utilities out is optional second-step cleanup.

### Q13 — ADJUSTED (high)
Independent assessment: `Methods` is the canonical PXE RPC surface, while `IPXE` and `PXEProxy` restate a hand-maintained network-bound subset. That is a real synchronization surface even without a current bug.  
Instance check: `spec.ts`, `ipxe.ts`, `proxy.ts`, and `client.ts` support the claim. `extension/src/wallet/services/pxe/client.ts:24` is just a re-export shim and does not itself exhibit the smell.  
Corrections: this is unchecked duplicated interface projection, not proof of existing drift across five active implementations.  
Refactoring sanity: deriving everything from one generated source is larger than needed. Smallest safe move: define one canonical subset key list and add type-level assertions that `IPXE` and `PXEProxy` stay aligned with `Methods`.

### Q14 — ADJUSTED (high)
Independent assessment: most cited `restore()` methods share the same pattern: initialize result collection, try per item, persist, and attach `restoreError` on failure. The duplication is real, but the per-service validation/locking/id-allocation logic varies.  
Instance check: valid for `config`, `account`, `contact`, `token`, `transaction`, `network`, `fpc`, and `auth-registry`. `profile/service.ts:830-975` is an outlier with secret-handling and profile-type branching, not the same loop. Missed similar instances: `token-balance/service.ts:256-271` and `account-state/service.ts:183-225`.  
Corrections: the real root cause is duplicated restore-result handling across at least ten services, not identical `backup()/restore()` loops across nine.  
Refactoring sanity: a generic `restoreEntities` abstraction is too coarse. Safer: extract only the per-item result/error accumulation helper.

### Q15 — ADJUSTED (moderate)
Independent assessment: several services do the same purge choreography: load matching rows, delete each row, emit deleted events, and sometimes clear a side cache. That is a real change-amplifying family.  
Instance check: most cited lines fit, but `auth-registry/service.ts:56-70` is account-deletion cleanup, not profile/chain purge. Missed siblings include `incoming-transfer/service.ts:190-248` and `operation-journal/service.ts:154-160`.  
Corrections: either broaden the smell to “lifecycle purge cascade duplication” or drop `auth-registry` from the current title.  
Refactoring sanity: one global purge helper would be too aggressive because services differ on locks, pending-map cleanup, cache eviction, and emit decoration. Smallest safe step is a shared row-iteration/delete helper with service-owned side effects.

### Q16 — REFUTED (high)
Independent assessment: a few cited items do look unused in this repo, but the finding bundles them with clearly live exports and build-registered entrypoints. As written, it overreaches.  
Instance check: plausible narrow candidates are `lazy-listener.ts`, `subscribe-with-snapshot.ts`, `random.ts:getRandomElement`, `queue.ts:dequeueBatch`, `entity_storage.ts:getVersion/setVersion/findByPredicate`, and possibly `wallet-crypto`’s unused `@aztec/stdlib` dependency. But `wallet-core/utils/event-handler.ts`, `jobs/index.ts`, `wallet-crypto/src/index.ts:19`, `vite.config.ts:298`, and `packages/extension/src/setup/*` are live; `src/setup` is explicitly built by Vite.  
Corrections: refuted per prompt: this makes dead-code claims in build-registration/public-surface contexts without sufficient proof.  
Refactoring sanity: split this into small, independently-proven removals; do not delete the setup entry or live exports.