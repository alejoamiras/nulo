### Q1 DApp payloads are trusted by generic assertion
- Smell: Schema/Type Drift (analog: runtime dApp payload schemas and TS payload types can diverge because the boundary only asserts, not decodes)
- Lens: typing
- Maintenance impact: structural
- Blast radius: 5 modules
- Instances: `packages/extension/src/composables/useDappInteractionPayload.ts:16`, `:18`, `:60`, `:86`, `:90`; `packages/extension/src/popup/windows/execute/index.vue:117`, `:120`, `:129`, `:135`, `:314`, `:330`, `:341`, `:353`, `:398`, `:479`, `:485`, `:486`; `packages/extension/src/popup/windows/capabilities/index.vue:76`, `:79`, `:108`, `:141`, `:195`; `packages/extension/src/popup/windows/discover/index.vue:54`; `packages/extension/src/popup/windows/json/index.vue:1`, `:11`, `:14`, `:16`, `:31`
- Evidence: `getInteractionPayload()` returns `Promise<unknown>`, but `useDappInteractionPayload<TPayload>()` turns it into `TPayload` with `as TPayload`. Execute and capabilities then re-cast operation/capability subfields locally, including multiple `as unknown as Operation` / `DraftOperation` bridges in the execute window.
- Why it harms future change: adding or reshaping an operation/capability payload requires updating the service contract, the caller’s generic argument, and scattered local casts. A stale caller can still compile because the runtime payload was never decoded at the boundary.
- Refactoring: Encapsulate Downcast / Introduce typed codec → decode by interaction kind in the service client or composable, returning validated `ExecutionPayload`, `CapabilityPayload`, or `DiscoveryPayload` plus typed `dappMetadata`; move the Operation draft→executable bridge behind one assertion function.
- Effort: days
- Confidence: high

### Q2 Full-backup import reconstructs the backup schema with casts
- Smell: Schema/Type Drift (analog: the backup wire schema is not represented by one checked DTO, so every consumer rebuilds pieces of it with casts)
- Lens: typing
- Maintenance impact: structural
- Blast radius: 10 modules
- Instances: `packages/extension/src/composables/useFullBackupImport.ts:38`, `:54`, `:70`, `:71`, `:92`, `:93`, `:139`, `:162`, `:165`, `:167`, `:190`, `:200`, `:201`, `:208`, `:245`, `:246`, `:300`, `:321`, `:363`, `:370`, `:374`, `:381`, `:383`, `:385`, `:386`, `:387`, `:388`, `:389`, `:390`, `:391`, `:397`, `:399`, `:427`, `:428`
- Evidence: backup data is repeatedly cast from `BackupSelection`, `Record<string, unknown>`, `unknown[]`, and service-name string keys. The heterogeneous restore loop erases clients to `{ restore: (...args: unknown[]) => Promise<unknown> }`, forcing seven `as never` client casts.
- Why it harms future change: a backup v3 field, service rename, or restore signature change has to be patched across string keys, DTO casts, remap code, and restore dispatch. TypeScript cannot tell whether a service slice is missing, has the wrong element shape, or receives the wrong extra arguments.
- Refactoring: Introduce Schema / Introduce Parameter Object → define a `BackupV2` DTO or zod-backed schema plus typed `RestoreStep<TSlice, TResult>` registry keyed by service name; remove `Record<string, unknown>` and `as never` from the restore pipeline.
- Effort: days
- Confidence: high

### Q3 DApp approval windows duplicate the same lifecycle shell
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 3 files
- Instances: `packages/extension/src/popup/windows/execute/index.vue:82`, `:110`, `:151`, `:300`, `:370`, `:376`, `:408`, `:411`, `:441`; `packages/extension/src/popup/windows/capabilities/index.vue:67`, `:69`, `:102`, `:167`, `:225`, `:231`, `:238`, `:241`, `:270`; `packages/extension/src/popup/windows/discover/index.vue:46`, `:48`, `:72`, `:88`, `:116`, `:122`, `:133`, `:136`, `:165`
- Evidence: execute, capabilities, and discover each create interaction/profile clients, load a dApp interaction payload, reject on active-profile change, remove `beforeunload` only after completion, wait for `appStore.isSessionChecked`, redirect to auth, run `init()`, and disconnect the same service pair on unmount.
- Why it harms future change: auth gating, cancellation semantics, beforeunload rejection, or session-check behavior must be changed in three windows. The existing comments already show race gates were added independently in these windows, which is the maintenance cost of the duplication.
- Refactoring: Extract Function / Form Template Method → create an L5 window shell helper/component that centralizes session wait, auth redirect, cancellation, and beforeunload wiring while each window supplies payload-specific `init`/`approve` behavior.
- Effort: days
- Confidence: high

### Q4 Local design wrappers copy base prop contracts
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: local
- Blast radius: 4 files
- Instances: `packages/extension/src/components/ui/Button.vue:18`, `:34`, `:40`, `:57`; `packages/design/src/ui/Button.vue:7`, `:40`, `:44`, `:52`; `packages/extension/src/components/ui/SubPageHeader.vue:7`, `:48`; `packages/design/src/ui/SubPageHeaderBase.vue:8`
- Evidence: the extension `Button` wrapper re-declares most `@nulo/design` Button props and forwards them manually, while `SubPageHeader` repeats the base title/back/icon props. The host wrappers are deliberate, but the prop contracts are copied instead of shared.
- Why it harms future change: adding or narrowing a base prop requires remembering the local wrapper. Because the wrapper uses runtime `String` props, TS will not catch variant/size drift or a newly supported base prop being silently dropped.
- Refactoring: Extract Type Alias / Introduce Shared Type → export typed base prop contracts from `@nulo/design`, have wrappers extend them with host-only props (`link`, `backTo`), and forward a typed `baseProps` object.
- Effort: hours
- Confidence: high

## Likely false positives
Plain `<script setup>` is widespread, so I did not score a blanket TS-conversion finding. `ToastManager.vue` is an intentional pass-through wrapper and does not duplicate a prop contract. `useEntityCrud` already centralizes common CRUD subscription mechanics; the remaining per-entity helpers I checked are domain formatting/sort logic, not clear copy-paste CRUD.

## Summary
4 findings; highest-value fix is typing/decoding the dApp interaction payload boundary.