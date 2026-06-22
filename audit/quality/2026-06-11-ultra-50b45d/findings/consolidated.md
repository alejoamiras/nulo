# Consolidated findings — 2026-06-11
## Summary table
| # | Title | Bucket | Priority | Cross-model | Clusters |
|---|---|---|---|---|---|
| 1 | Wallet method metadata scattered across parallel registries | architectural | A/W/Hot | convergent | C3 |
| 2 | Popup/onboarding profile flows duplicated and coupled to popup-only passkey UI | architectural | A/W/Hot | convergent | C4 |
| 3 | Background/offscreen RPC transports are forked base-class stacks | architectural | A/W/Hot | convergent | C5 |
| 4 | `ExecutionService` remains a multi-responsibility hotspot | structural | S/W/Hot | convergent | C1 |
| 5 | Four journaled execution pipelines are duplicated in the execution facade | structural | S/W/Hot | convergent | C1 |
| 6 | Activity-feed extraction is half-done around `RecentActivityView` | structural | S/W/Hot | convergent | C4 |
| 7 | Build/test config policy is forked across Vite/Vitest configs | structural | S/W/Hot | convergent | C6 |
| 8 | Popup form abstractions are half-finished, so dialogs reassemble common lifecycle logic | structural | S/W/Hot | convergent | C4 |
| 9 | Service readiness is split between declarative deps and hand-copied `ensureInitialized()` | architectural | A/W/Warm | convergent | C2 |
| 10 | Shared infrastructure wiring is half-migrated out of the composition root | Potential architectural | A/W/Warm | disagreement | C2 |
| 11 | `WalletSdkDispatcher` remains a hotspot class with duplicated internal flows | structural | S/W/Warm | convergent | C3 |
| 12 | E2E harness setup/grant/bootstrap logic is duplicated in the hottest fixture module | structural | S/W/Warm | codex-only | C6 |
| 13 | PXE in-process contract surface is manually synchronized across subset interfaces | architectural | A/W/Warm | convergent | C5 |
| 14 | `backup()/restore()` loop is duplicated across nine services | structural | S/W/Warm | convergent | C2 |
| 15 | Profile/chain purge cascade is duplicated across the service fleet | structural | S/W/Warm | convergent | C2 |
| 16 | Dead/speculative public surface persists across shared packages and the build graph | structural | S/W/Warm | convergent | C5,C6 |
| 17 | Contract/function resolution and PXE registration abstractions are half-done | structural | S/W/Warm | convergent | C1,C2 |
| 18 | Execution contracts rely on positional tuples and primitive clumps | structural | S/W/Warm | convergent | C1 |
| 19 | Active-profile guards are duplicated with drifted error strings | structural | S/W/Warm | convergent | C2 |
| 20 | CAIP parsing/formatting is duplicated across bridge and extension | structural | S/M/Warm | convergent | C3 |
| 21 | Scope-enforcement checker family is hand-copied | structural | S/M/Warm | convergent | C3 |
| 22 | Serialization policy is split across three wallet-core helpers | structural | S/M/Warm | convergent | C6 |
| 23 | Claim/cancel lifecycle depends on cross-file temporal coupling | structural | S/M/Warm | convergent | C1 |

## Findings (sorted by priority)
### Q1: Wallet method metadata scattered across parallel registries
**Smell:** Shotgun Surgery via parallel registries. **Bucket:** architectural. **Blast radius:** wide (5 bridge files plus dispatcher consumers). **Change frequency:** hot (`dispatcher.ts`/`scope-enforcement.ts` are active hotspots). **Cross-model:** convergent  
**Instances:** `packages/wallet-bridge/src/capability-map.ts:18,21-46`; `packages/wallet-bridge/src/dispatcher.ts:163-198,237-280,867-956`; `packages/wallet-bridge/src/scope-enforcement.ts:9-10,348-362`.  
**Evidence:** `METHOD_CAPABILITY_MAP`, `EXEMPT_METHODS`, `METHOD_TO_KIND`, `NETWORK_ONLY_KINDS`, `ACCOUNT_KINDS`, both operation-build switches, and `METHOD_SCOPE_CHECKER` all restate the same method-name facts. `scope-enforcement.ts:9-10` explicitly says the checker map must stay in sync with dispatcher logic.  
**Why it harms change:** Adding or reclassifying one wallet method is a multi-file scavenger hunt with silent omission modes.  
**Smallest safe refactoring:** Introduce a single `MethodDescriptor` registry and derive capability lookup, routing kind, and scope checker from it.  
**Corrections applied:** Kept the registry finding; dropped broader comment-style claims that did not add distinct change amplification.

### Q2: Popup/onboarding profile flows duplicated and coupled to popup-only passkey UI
**Smell:** Duplicate Code plus Inappropriate Intimacy. **Bucket:** architectural. **Blast radius:** wide (4 page files plus shared dialog). **Change frequency:** hot (`import.vue`/`profile/new.vue` are UI hotspots). **Cross-model:** convergent  
**Instances:** `packages/extension/src/popup/pages/import.vue:92-340,459-539,656-667`; `packages/extension/src/onboarding/pages/import.vue:62-297,385-468,528-539`; `packages/extension/src/popup/pages/profile/new.vue:72-175`; `packages/extension/src/onboarding/pages/create.vue:51-136`; `packages/extension/src/onboarding/pages/import.vue:10,470`; `packages/extension/src/onboarding/pages/create.vue:8,263`; `packages/extension/src/popup/components/popups/PasskeyCeremonyDialog.vue:10-14,31,82`.  
**Evidence:** Popup and onboarding import/create pages duplicate the same validation, passkey ceremony, bootstrap, and error-routing handlers. The shared passkey dialog still imports popup-only utilities and teleports to `#popup`, so onboarding depends on popup internals.  
**Why it harms change:** One profile-flow change now requires synchronized edits across two shells and one popup-coupled dialog.  
**Smallest safe refactoring:** Extract `useProfileImportFlow`/`useProfileCreateFlow`; move the passkey overlay behind an entrypoint-neutral adapter.  
**Corrections applied:** Merged the duplicated-flow and popup-boundary findings; kept the boundary erosion, not just the stale dialog comment.

### Q3: Background/offscreen RPC transports are forked base-class stacks
**Smell:** Duplicate Code plus Alternative Classes with Different Interfaces. **Bucket:** architectural. **Blast radius:** wide (4 base classes, 40+ background consumers, PXE offscreen consumers). **Change frequency:** hot enough to matter because every transport-layer policy change touches both forks. **Cross-model:** convergent  
**Instances:** `packages/extension-messaging/src/background/client.ts:37-46,94-132,134-247`; `packages/extension-messaging/src/offscreen/client.ts:36-52,88-137,176-296`; `packages/extension-messaging/src/background/service.ts:14-19,29-38,62-102,139-215`; `packages/extension-messaging/src/offscreen/service.ts:19-25,34-43,52-186`.  
**Evidence:** Both clients own the same request map, id allocation, timeout, A6 JSON-fallback parse, and logging quartet; both services own the same validate/unwrap/invoke/sanitize/respond flow and verbatim `ensureInitialized()`. Background reconstructs typed `WalletError` payloads; offscreen rejects with plain strings.  
**Why it harms change:** Every RPC-layer improvement or bug fix is paid twice, and equivalent transport failures surface with incompatible error contracts.  
**Smallest safe refactoring:** Extract a shared request-correlator/service-core layer; keep only transport send/receive hooks separate.  
**Corrections applied:** Removed out-of-scope re-implementation evidence from outside C5; kept only in-scope transport duplication.

### Q4: `ExecutionService` remains a multi-responsibility hotspot
**Smell:** Large Class with Divergent Change. **Bucket:** structural. **Blast radius:** wide (central execution facade and its collaborators). **Change frequency:** hot (`service.ts` is the wallet hotspot). **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/execution/service.ts:252-335,405-823,914-1408,1476-1575,1713-2300`.  
**Evidence:** One 2302-line class owns transfer flows, journal/cancel flow, gas-balance caching, fee-estimate reuse, dApp execution, and Aztec RPC adapters. The same file keeps the largest state cluster and the widest fan-in in the execution subsystem.  
**Why it harms change:** Unrelated execution concerns collide in one file, so every change starts with the same large reload cost.  
**Smallest safe refactoring:** Extract narrower executors/coordinators and leave `ExecutionService` as a thin RPC facade.  
**Corrections applied:** Dropped the overstated “no facade test exists” claim; the hotspot finding stands without it.

### Q5: Four journaled execution pipelines are duplicated in the execution facade
**Smell:** Duplicate Code. **Bucket:** structural. **Blast radius:** wide (4 top-level send paths in the hottest file). **Change frequency:** hot. **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/execution/service.ts:405-610,1130-1213,1860-2015,2022-2205`; stale extraction doc at `packages/extension/src/wallet/services/execution/execution-coordinator.ts:15-19`.  
**Evidence:** `executeTransfer`, `executeSendTransaction`, `executeAztecSendTx`, and `executeNoFromSendTx` each hand-roll controller setup, stage transitions, prove/send/history persistence, failure marking, and cleanup. `execution-coordinator.ts` still documents a missing `proveAndSend` extraction.  
**Why it harms change:** Any lifecycle-stage or persistence change is a 4-copy edit with proven drift risk.  
**Smallest safe refactoring:** Form Template Method / Extract Method for the shared prove→send→persist pipeline.  
**Corrections applied:** Kept the stale `proveAndSend` doc; reduced inflated duplicated-line counts from the raw reports.

### Q6: Activity-feed extraction is half-done around `RecentActivityView`
**Smell:** Large Component plus Duplicate Code. **Bucket:** structural. **Blast radius:** wide (widget, page, shared utils). **Change frequency:** hot (`RecentActivityView.vue` is a UI hotspot). **Cross-model:** convergent  
**Instances:** `packages/extension/src/popup/components/modules/general/RecentActivityView.vue:91-109,148-185,205-251,345-400,704-817`; `packages/extension/src/popup/pages/activity.vue:38-44,52-77,87-93,147-156,172-179`; `packages/extension/src/utils/activity-rows.ts:11-14,42-76`; `packages/extension/src/utils/journal-state.ts:324-352`.  
**Evidence:** `RecentActivityView` duplicates its awaiting-card template branch, re-derives awaiting card props already extracted for terminal cards, and re-wires incoming-transfer/config/token sources that the activity page wires separately. `activity-rows.ts` already claims the merge logic was extracted from both surfaces, but `RecentActivityView` still reimplements it.  
**Why it harms change:** Feed rule changes now hit the widget, the page, and partial utility extractions separately.  
**Smallest safe refactoring:** Extract `buildJournalAwaitingCardProps` and `useIncomingTransfers`; collapse the two template branches into one renderer.  
**Corrections applied:** Kept the real awaiting/data-source duplication; dropped overbroad claims about terminal-card logic that is already shared.

### Q7: Build/test config policy is forked across Vite/Vitest configs
**Smell:** Config Sprawl plus Mutable Data in the browser wrappers. **Bucket:** structural. **Blast radius:** wide (8 config files). **Change frequency:** hot enough to show shipped drift. **Cross-model:** convergent  
**Instances:** `packages/extension/vite.config.ts:8-17,44,48-55,310-316`; `packages/extension/vitest.config.ts:13-22,38-44,46-52,73-77`; `packages/extension/vitest.e2e.config.ts:7,21-41`; `packages/extension/vitest.e2e.network.config.ts:7,17-20,29-48,51-55`; `packages/extension/vitest.e2e.all.config.ts:7,10-31`; `packages/extension/vite.chrome.config.mts:7-22`; `packages/extension/vite.firefox.config.mts:7-22`.  
**Evidence:** `resolvePackageFile`, aliases, define blocks, and e2e runner settings are duplicated under literal “Keep in sync” comments. `vitest.e2e.all.config.ts` already drifted from `vitest.e2e.network.config.ts` by missing noir aliases and `retry: 2`. Browser wrappers mutate the imported base config in place.  
**Why it harms change:** Tooling changes now require manual sync across build, unit, and e2e configs, with already-shipped divergence.  
**Smallest safe refactoring:** Extract shared config helpers and compose wrappers via `mergeConfig` or config factories.  
**Corrections applied:** Wrapper mutation kept as part of config sprawl; not as a separate temporal-coupling lead finding.

### Q8: Popup form abstractions are half-finished, so dialogs reassemble common lifecycle logic
**Smell:** Duplicate Code and half-done abstraction. **Bucket:** structural. **Blast radius:** wide (form composable, popup shell, many dialogs). **Change frequency:** hot across popup forms. **Cross-model:** convergent  
**Instances:** `packages/extension/src/composables/useFormState.ts:89-117,153-169`; `packages/extension/src/popup/components/popups/EditEndpointPopup.vue:37-43,85,148`; `EditNetworkPopup.vue:43-53,78,137`; `EditContactPopup.vue:120-130,149,434-463`; `packages/extension/src/composables/useEntityCrud.ts:7-8`; hand-rolled event/list sync in `NewContactPopup.vue:30-47,181-292`, `EditContactPopup.vue:32-74,348-463`, `NewFpcPopup.vue:83-108,121-207`, `EditFpcPopup.vue:128-167,189-295`, `SelectFpcPopup.vue:47-50,77-87`, `SelectTokenPopup.vue:26-37`, `SelectBalanceTypePopup.vue:45-65`, `SelectProfilePopup.vue:20-23,46-60`, `BalanceView.vue:150-169`.  
**Evidence:** `useFormState` fixes its baseline at construction, so async edit forms rebase manually. `FormPopup` consumers duplicate enter-key listeners and error-tooltip blocks. `useEntityCrud` exists, but many dialogs still hand-roll add/update/delete list mirroring with drift.  
**Why it harms change:** Edit-form, submit-key, and service-event behavior are all changed in N dialogs instead of in the shared abstractions.  
**Smallest safe refactoring:** Add async rebase support to `useFormState`; move enter-key/error-shell ownership into `FormPopup`; migrate hand-rolled list sync to `useEntityCrud`.  
**Corrections applied:** Reframed from “consumers ignored existing abstractions” to “the abstractions do not yet cover the async edit lifecycle.”

### Q9: Service readiness is split between declarative deps and hand-copied `ensureInitialized()`
**Smell:** Temporal coupling plus Duplicate Code. **Bucket:** architectural. **Blast radius:** wide (21 services, shared base class). **Change frequency:** warm, with repeated new methods extending the pattern. **Cross-model:** convergent  
**Instances:** dependency declarations at `packages/extension/src/wallet/services/contact/service.ts:19` and `packages/extension/src/wallet/services/incoming-transfer/service.ts:68-75`; fallback mechanism at `packages/extension-messaging/src/background/service.ts:187-199`; topology contract at `packages/wallet-core/src/base/index.ts:55-70`; repeated preamble counts: profile `24/25`, network `17/19`, fpc `9/10`, contact `8/10`, account `7/10`, token `7/13`, auth-registry `4/8`, dapp-session `3/17`, transaction `2/7`, config `0/6`.  
**Evidence:** Only two services declare startup dependencies; the rest rely on per-method `await this.ensureInitialized()` and reviewer discipline. `ServiceCollection.start()` already has topological phases specifically to avoid mysterious readiness timeouts.  
**Why it harms change:** “Does this method need the preamble?” is encoded per method, not per service graph, so readiness policy keeps drifting method-by-method.  
**Smallest safe refactoring:** Move readiness gating to one dispatch boundary; keep inter-service ordering in declared dependencies.  
**Corrections applied:** Kept as architectural drift, not as proof of a pervasive current null-deref path.

### Q10: Shared infrastructure wiring is half-migrated out of the composition root
**Smell:** Half-done composition root / ports migration. **Bucket:** Potential architectural. **Blast radius:** wide (runtime wiring plus many services). **Change frequency:** warm. **Cross-model:** disagreement  
**Instances:** `packages/extension/src/wallet/runtime.ts:105-125`; browserApi fallback seams at `contact/service.ts:35-39`, `profile/repository.ts:42-45`, `profile/session-manager.ts:130-132`; hard-coded storage in `account/service.ts:23`, `token/service.ts:42`, `transaction/service.ts:36`, `network/service.ts:143,687,752,758`, `fpc/service.ts:43`, `auth-registry/service.ts:29-30`, `dapp-session/service.ts:29`; per-service PXE clients at `token/service.ts:57`, `transaction/service.ts:52`, `network/service.ts:163`, `fpc/service.ts:60`, `note/service.ts:46`, `execution/service.ts:342`, `token-balance/service.ts:67`, `account-state/service.ts:36`.  
**Evidence:** The runtime explicitly says only some services are port-migrated. Remaining services still hard-code `chrome.storage.local` or construct their own `PxeServiceClient`, despite the codebase already using explicit runtime-owned collaborators elsewhere.  
**Why it harms change:** Storage/PXE wiring changes fan across service constructors and `init()` bodies instead of staying at the composition root.  
**Smallest safe refactoring:** Inject storage/PXE factories or shared instances from `runtime.ts`; centralize the fallback seam once.  
**Corrections applied:** Dropped the refuted `lastActiveProfile`/`sentinel` coupling claim; kept only the source-backed composition-root drift.

### Q11: `WalletSdkDispatcher` remains a hotspot class with duplicated internal flows
**Smell:** Large Class with internal Duplicate Code. **Bucket:** structural. **Blast radius:** wide (package hub for every wallet-sdk request). **Change frequency:** warm-to-hot. **Cross-model:** convergent  
**Instances:** `packages/wallet-bridge/src/dispatcher.ts:227-292,404-521,531-760,867-1006`; duplicated session-account resolution at `347-358,494-497,599-600,721-747,989-997`.  
**Evidence:** One 1011-line class owns routing, popup orchestration, grant persistence, response shaping, operation building, and session-aware account resolution. The session-account pipeline is reimplemented in multiple places inside that same class.  
**Why it harms change:** Protocol-routing, grants, popups, and account selection all collide in the same hub, so local bridge changes keep reopening the same file.  
**Smallest safe refactoring:** Extract grant-management and account-resolution collaborators; route all session-account projection through one shared helper.  
**Corrections applied:** Folded the duplicated session-account flow and `handleRequestCapabilities` maintenance pressure into this hotspot instead of keeping separate lower-level findings.

### Q12: E2E harness setup/grant/bootstrap logic is duplicated in the hottest fixture module
**Smell:** Duplicate Code plus mixed-concern hotspot module. **Bucket:** structural. **Blast radius:** wide across the e2e suite. **Change frequency:** warm-to-hot (`fixtures/extension.ts` is the hottest scoped file). **Cross-model:** codex-only  
**Instances:** `packages/extension/tests/e2e/fixtures/extension.ts:282-296,383-390,391-399,407-414,415-421,429-457,468-475,476-482,490-513,524-530,532-538,547-570,997-1018,1088-1236`; `packages/extension/tests/e2e/fixtures/helpers.ts:2,20`.  
**Evidence:** The same phase wrapper appears 4 times, the same setup ladder 4 times, capability-grant choreography 3 times, and `openOnboarding()`/`openPopupOnce()` repeat the same page bootstrap. Generic DOM helpers live in the launcher file and are imported back into `helpers.ts`; `TEST_PASSWORD` is defined but not exported.  
**Why it harms change:** Harness changes repeatedly hit the same 1,249-line file and require synchronized edits across setup variants and helper call sites.  
**Smallest safe refactoring:** Extract `withConnectedPlayground`, `grantCapabilities`, `fixtures/dom.ts`, and a single exported `TEST_PASSWORD`.  
**Corrections applied:** Kept only in-scope fixture evidence; dropped broader out-of-scope password-count inflation from the raw reports.

### Q13: PXE in-process contract surface is manually synchronized across subset interfaces
**Smell:** Manual subset interface drift surface. **Bucket:** architectural. **Blast radius:** wide (PXE spec, client, in-process facade, proxy, shim). **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/aztec-runtime/src/pxe/spec.ts:24-81`; `packages/aztec-runtime/src/pxe/ipxe.ts:27-50`; `packages/aztec-runtime/src/pxe/proxy.ts:32-102`; `packages/aztec-runtime/src/pxe/client.ts:72-201`; `packages/extension/src/wallet/services/pxe/client.ts:24`.  
**Evidence:** `Methods` declares 21 RPC methods, while `IPXE` and `PXEProxy` each restate a narrower 18-method subset by hand. The subset is not mechanically derived, so omissions are unchecked.  
**Why it harms change:** PXE surface changes must be replayed across multiple hand-maintained declarations even when only the subset boundary is meant to change.  
**Smallest safe refactoring:** Derive `IPXE` from `Methods` with a mapped type and generate the proxy/delegation layer from one source.  
**Corrections applied:** Narrowed the claim from “already accidental drift” to “manual subset boundary with unchecked synchronization.”

### Q14: `backup()/restore()` loop is duplicated across nine services
**Smell:** Duplicate Code. **Bucket:** structural. **Blast radius:** wide (9 services plus backup UI collectors). **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/config/service.ts:43-59`; `account/service.ts:213-234`; `contact/service.ts:290-319`; `token/service.ts:532-558`; `transaction/service.ts:302-324`; `network/service.ts:614-657`; `fpc/service.ts:470-520`; `auth-registry/service.ts:285-311`; `profile/service.ts:830-975`.  
**Evidence:** The same accumulate/persist/catch/`restoreError` loop is reimplemented across the fleet. `contact` already diverged by storing the raw `err` object while peers normalize to messages.  
**Why it harms change:** Any restore-contract change becomes a 9-file edit with live shape drift.  
**Smallest safe refactoring:** Extract generic restore helpers (`restoreEntities`, shared backup walkers) and leave only service-specific persistence hooks.  
**Corrections applied:** Kept the family; corrected the consequence from “error lost” to “error-shape drift.”

### Q15: Profile/chain purge cascade is duplicated across the service fleet
**Smell:** Duplicate Code. **Bucket:** structural. **Blast radius:** wide (8 services, 11 sites). **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/account/service.ts:43-50,194-202`; `token/service.ts:72-79,515-521`; `transaction/service.ts:74-82,166-174`; `contact/service.ts:256-270`; `fpc/service.ts:71-80,447-461`; `dapp-session/service.ts:325-338`; `auth-registry/service.ts:56-70`; `network/service.ts:671-691`.  
**Evidence:** The same load/filter/delete/emit purge loop appears for profile and chain cleanup, with inconsistent lock discipline and even different intra-file strategies.  
**Why it harms change:** Cleanup semantics, batching, or error policy must be changed across a dispersed family of nearly identical listeners.  
**Smallest safe refactoring:** Extract purge helpers that own filtering, deletion, and emit order; let services supply only predicates and events.  
**Corrections applied:** Merged `clearChainState` and `onProfileDeleted` variants under one root cause.

### Q16: Dead/speculative public surface persists across shared packages and the build graph
**Smell:** Dead Code plus Speculative Generality. **Bucket:** structural. **Blast radius:** wide (shared package APIs, exported subpaths, build entrypoints). **Change frequency:** warm enough because these surfaces stay visible to every maintainer. **Cross-model:** convergent  
**Instances:** `packages/extension-messaging/src/lazy-listener.ts:1-129`; `packages/extension-messaging/src/subscribe-with-snapshot.ts:1-88`; `packages/wallet-core/src/utils/random.ts:18`; `utils/event-handler.ts:1-4`; `utils/queue.ts:47-55`; `storage/entity_storage.ts:62-82,137-142`; `base/index.ts:33-34`; `jobs/index.ts:3,10`; `packages/wallet-crypto/src/index.ts:19`; `packages/wallet-crypto/package.json:15`; `packages/extension/vite.config.ts:134-136,298`; `packages/extension/src/setup/*`.  
**Evidence:** Exported messaging subpaths have zero production consumers, several wallet-core/wallet-crypto exports are unreferenced outside their own files/tests, `@aztec/stdlib` is declared but unused, and `src/setup/` is built but unreferenced anywhere reachable.  
**Why it harms change:** Dead surface still counts as API/build surface: it expands review, audit, and compatibility burden without delivering behavior.  
**Smallest safe refactoring:** Remove Dead Code; delete unused subpaths/exports/dependency/entry, and inline the compatibility shim path that remains.  
**Corrections applied:** Removed the phantom `isTerminalStage` claim, excluded live `loadProductionNoteSchemas`, and corrected the false `walletErrorFromPayload` deadness story.

### Q17: Contract/function resolution and PXE registration abstractions are half-done
**Smell:** Duplicate Code from stopped extractions. **Bucket:** structural. **Blast radius:** wide across execution/token/fpc helpers. **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/execution/tx-request-builder.ts:113-125,279-334,404-424`; `authwit-discoverer.ts:149-225`; `helpers/batched-view-simulation.ts:177-192,494-591`; `execution/service.ts:1434-1446`; `token/service.ts:275-359,361-449,289-305,374-390`; `fpc/service.ts:245-261,347-357`.  
**Evidence:** Name/selector lookup and “ensure contract registered” loops are duplicated across modules even though `ContractResolver` and adjacent helpers already exist. Token/fpc repeat the same registration prologue separately.  
**Why it harms change:** Contract-resolution policy changes now require synchronized edits across execution builders and unrelated service modules.  
**Smallest safe refactoring:** Move shared lookup and registration helpers into one resolver/registrar module and parameterize per-caller variations.  
**Corrections applied:** Dropped speculative broader centralization claims; kept only the verified lookup/registration families.

### Q18: Execution contracts rely on positional tuples and primitive clumps
**Smell:** Data Clumps plus Primitive Obsession. **Bucket:** structural. **Blast radius:** wide across spec/client/service/fee helpers. **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/execution/tx-request-builder.ts:69-70,373,477`; `fee/fee-strategy.ts:72-81`; `service.ts:538-545,739-742,903,1173-1177,1411,1967-1971,2081`; `fee/fee-juice-strategy.ts:20-34`; `fee/fee-juice-with-claim-strategy.ts:28-42`; `fee/embedded-strategy.ts:35-51`; `fee/fpc-strategy.ts:47-85`; `spec.ts:18-27,48-56`; `client.ts:22-43,53-63`; `operation-planner.ts:71-79`; `service.ts:154-162,405-414,620-629,717-725`.  
**Evidence:** Execution helpers exchange 6/7/8-slot tuples and repeat the same transfer-argument bundle across spec, client, service, and planner. Many consumers only use subsets but still depend on slot order or repeated positional signatures.  
**Why it harms change:** Adding or reordering one field becomes a manual audit across builders, strategies, and call sites.  
**Smallest safe refactoring:** Replace tuples with named result objects and introduce `TransferRequest` as a first-class parameter object.  
**Corrections applied:** Removed the overclaim that client/service arity drift would compile silently; the same-typed transposition hazard remains.

### Q19: Active-profile guards are duplicated with drifted error strings
**Smell:** Duplicate Code. **Bucket:** structural. **Blast radius:** wide (many wallet services). **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/contact/service.ts:48,58,73,87,120,152,188`; `network/service.ts:169,204,214,224,238,263,284,308,331,374,422,449,473,495`; `fpc/service.ts:115,217,238,293,319,389,414`; `dapp-session/service.ts:44,86,109`; `token/service.ts:468,526`; `transaction/service.ts:282`; `auth-registry/service.ts:265`.  
**Evidence:** The same `getActiveProfile()`+throw preamble is copied across dozens of methods, but the lock-state error has already drifted to `"Profile locked"`, `"Wallet locked"`, and `"Wallet is locked"`.  
**Why it harms change:** Lock-state policy, typed-error migration, or telemetry grouping must be changed method-by-method instead of in one guard.  
**Smallest safe refactoring:** Extract `requireActiveProfile()` and reuse typed/shared ownership guards where needed.  
**Corrections applied:** Removed `account/service.ts:189`; the divergent-string count is three, not four.

### Q20: CAIP parsing/formatting is duplicated across bridge and extension
**Smell:** Duplicate Code. **Bucket:** structural. **Blast radius:** medium (2 modules, many downstream consumers). **Change frequency:** warm enough because both sides are protocol helpers. **Cross-model:** convergent  
**Instances:** `packages/wallet-bridge/src/caip.ts:24-70`; `packages/extension/src/wallet/utils/caip.ts:22-29,49-87`; headers at `wallet-bridge/src/caip.ts:5-9` and `extension/src/wallet/utils/caip.ts:2-9`.  
**Evidence:** `formatCaipChain`, `formatCaipAccount`, `parseCaipAccount`, and `resolveNetworkByChainId` are line-for-line duplicates. The extension header still claims dispatcher uses that file, but dispatcher imports the bridge copy.  
**Why it harms change:** Any CAIP rule change must be patched twice across two halves of the same protocol boundary.  
**Smallest safe refactoring:** Move the shared CAIP helpers to one owner and re-export from the other layer.  
**Corrections applied:** Dropped the false “both headers point at each other” framing; the code duplication remains.

### Q21: Scope-enforcement checker family is hand-copied
**Smell:** Duplicate Code. **Bucket:** structural. **Blast radius:** medium (one file, public policy surface). **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/wallet-bridge/src/scope-enforcement.ts:53-88,90-130,286-319`; repeated empty-grants pass-through at `58,70,83,99,118,141,158,288,302,315`.  
**Evidence:** The file contains byte-identical checker pairs and repeated four-step checker skeletons with only capability type, flag, or error label changing.  
**Why it harms change:** Shared scope-policy conventions must be propagated across many near-clones, so new checkers are born by copy/paste.  
**Smallest safe refactoring:** Parameterize checker factories (`makeFlagChecker`, `makeAddressChecker`, `makeCallsChecker`).  
**Corrections applied:** Kept only source-backed checker families; did not promote adjacent comment drift as a separate finding.

### Q22: Serialization policy is split across three wallet-core helpers
**Smell:** Divergent Change / serialization-policy sprawl. **Bucket:** structural. **Blast radius:** medium (3 shared helpers feeding wire and persistence paths). **Change frequency:** warm enough to matter because drift is silent. **Cross-model:** convergent  
**Instances:** `packages/wallet-core/src/utils/serialization.ts:24-57`; `packages/wallet-core/src/jobs/error.ts:60-77`; `packages/wallet-core/src/utils/arrays.ts:23-39`.  
**Evidence:** The same “safe stringify hostile JS values” concern is implemented three ways, with bigint encoded as `"123"` in one path and `"123n"` in another, and Error payloads shaped differently again.  
**Why it harms change:** Exotic-value serialization rules can improve in one path while the others silently stay stale.  
**Smallest safe refactoring:** Extract a shared serialization core and layer only local concerns like truncation on top.  
**Corrections applied:** None beyond keeping the stronger cross-file policy split rather than the weaker single-file `EntityStorage` duplication.

### Q23: Claim/cancel lifecycle depends on cross-file temporal coupling
**Smell:** Temporal coupling. **Bucket:** structural. **Blast radius:** medium (claim helper, execution service, mutex flow). **Change frequency:** warm. **Cross-model:** convergent  
**Instances:** `packages/extension/src/wallet/services/execution/claim-helper.ts:82-165` (especially `144-163`); `packages/extension/src/wallet/services/execution/service.ts:836-866,1285-1346`.  
**Evidence:** Controller registration, journal transitions, FIFO baton release, and cancellation semantics rely on exact interleaving across `claim-helper.ts` and `service.ts`; the code comments explicitly call out “correctness-by-microtask-interleaving”.  
**Why it harms change:** Refactors that look local can silently break queue/cancel invariants because the order dependency is implicit and cross-file.  
**Smallest safe refactoring:** Extract one cancellation/claim coordinator that owns journal transition plus controller lifecycle.  
**Corrections applied:** Kept as a maintainability finding; it is not just a correctness note.

## Dropped findings (one line each + reason)
- `isTerminalStage` dead export — dropped; the symbol does not exist, and live code imports `isTerminal`.
- “ExecutionService has no service-level tests” — dropped; `feesettings-invariant.test.ts` instantiates the facade.
- `walletErrorFromPayload` “tests-only” / popup-utils / jobs-FSM consumers — dropped; the cited popup/FSM hits were comments, and `background/client.ts` is a live non-test consumer.
- `loadProductionNoteSchemas` dead export — dropped; `PxeService.getNoteSchemas()` calls it.
- `lastActiveProfile` + `sentinel` as one activation contract — dropped; `setSentinel()` tracks build/reset epoch, not activation state.
- CAIP “both headers point at each other” — dropped; only the extension copy self-claims authority, while dispatcher actually imports the bridge copy.
- Fee-strategy finding that treated `FpcStrategy` as a twin of the three single-pass strategies — dropped; `FpcStrategy` is materially different and explicitly byte-parity-sensitive.
- Broad milestone/comment-policy sweeps in C1/C3 — dropped as standalone findings; only concrete false/stale docs survived as supporting evidence.
- Re-export shims as a standalone `Middle Man` lead finding — dropped; after round-2 narrowing, the proven cost was export-list maintenance only, below the final threshold.
- Standalone `EntityStorage.parseOrDelete` vs `getVersion` duplication — dropped; `getVersion` is unused and is better removed under the broader dead-surface finding.
- `PasskeyCeremonyDialog` stale ownership header — dropped; true, but lower-signal than the stronger entrypoint-boundary coupling already retained.
- Standalone `NetworkInfo` duplication / `OFFSCREEN_KEEPALIVE` duplication — dropped; kept as supporting evidence under stronger transport-layer findings.

## Cross-cutting observations
- Half-done migration is the dominant repo-level pattern: declarative startup deps, browserApi ports, PXE composition, popup form abstractions, config sharing, and the dead `setup` entry all show migrations that stopped midstream and now force dual maintenance.
- Manual parallel registries recur across layers: bridge method tables, execution tuples/clumps, PXE subset surfaces, config aliases/defines, and wallet-core serializers all repeat “same fact, many places.”
- Sync-by-comment is a recurring failure mode: `keep in sync` config comments, `scope-enforcement` sync notes, stale `proveAndSend` documentation, false extraction claims in activity helpers, and wrong ownership comments all point to missing single sources of truth.
- Dead/public surface bloat is not isolated: unused library subpaths, dead core exports, an unused dependency, and an unreachable built entry all survived import/open-source migration without consumers.
- The hottest files are the ones where extraction stopped halfway: `execution/service.ts`, `dispatcher.ts`, `RecentActivityView.vue`, and `tests/e2e/fixtures/extension.ts` each combine size with duplicated subflows rather than one coherent abstraction.
- Round-2 corrections materially improved the set: phantom dead exports, false “tests-only” consumers, over-broad fee-strategy twins, and sentinel/activation coupling were all removed rather than softened.