### Q1 — CONFIRMED (high)
Independent assessment: wallet-method facts are encoded in multiple places: capability gating, dispatcher routing/special-casing, network/account grouping, operation builders, and scope enforcement, with an explicit keep-in-sync warning in `scope-enforcement.ts`.
Instance check: all cited locations exhibit the smell; I did not find a bad instance or a clearly missed one beyond the already-cited dispatcher branches.
Corrections: none; “shotgun surgery via parallel registries” is the right diagnosis.
Refactoring sanity: a single `MethodDescriptor` source that derives capability/routing/scope data looks safe and is plausibly the smallest safe change, assuming generated maps preserve current method names and behavior exactly.

### Q2 — ADJUSTED (moderate)
Independent assessment: the popup/onboarding import pages duplicate real flow logic: name validation, error state, import handlers, passkey ceremony, backup wiring, and completion routing; popup/profile/new and onboarding/create also duplicate the create/passkey path.
Instance check: the page-file instances are valid. `PasskeyCeremonyDialog.vue` does show cross-shell coupling, but the stronger “popup-only” claim is overstated because onboarding intentionally provides the same `#popup` anchor in `src/onboarding/app.vue:76-78`.
Corrections: confirm duplicate flows; soften the boundary claim from “popup-only passkey UI” to “shared passkey UI still housed under popup paths.”
Refactoring sanity: extracting `useProfileImportFlow` / `useProfileCreateFlow` is safe. A neutral shared passkey module path is smaller and safer than a larger adapter rewrite.

### Q3 — ADJUSTED (moderate)
Independent assessment: background/offscreen clients and services repeat request bookkeeping, response decoding, JSON-fallback parsing, logging, and the same wait-until-initialized loop, but each side also owns materially different transport behavior.
Instance check: all cited ranges are real duplication; no obvious false instance.
Corrections: the smell is better framed as duplicate transport-policy / forked base implementations, not “Alternative Classes with Different Interfaces.” The public shapes are similar; the internals diverge around `Port` reconnects vs `sendMessage`, telemetry, and error typing.
Refactoring sanity: extracting a full shared “service core” is broader than the smallest safe move. Safer first slices are shared helpers for response decoding, timeout bookkeeping, JSON fallback, and `ensureInitialized()` behavior.

### Q4 — ADJUSTED (high)
Independent assessment: `ExecutionService` is not a thin facade; it owns caches, cancellation, mutex/backpressure, journal orchestration, transfer execution, dApp execution, gas-balance queries, and Aztec RPC adapters in one 2302-line class.
Instance check: every cited range exhibits the hotspot. I would also count `service.ts:1033-1128` (register contract/sender/token handlers) as additional responsibility spread.
Corrections: finding stands, but the proposed refactor is directional rather than the smallest safe next step.
Refactoring sanity: safest is one cohesive extraction at a time, such as gas-balance caching/query logic or one execution pipeline, while keeping the RPC surface and behavior stable.

### Q5 — ADJUSTED (high)
Independent assessment: the four send paths do share a duplicated lifecycle skeleton: journal/controller setup, stage transitions, prove, `toTx`, submit, persistence, terminal journal update, and cleanup. `executeNoFromSendTx` has extra discovery work, but the prove/send tail is still repeated.
Instance check: all `service.ts` ranges are valid. `execution-coordinator.ts:15-19` is a stale comment: `proveAndSend` is referenced there but does not exist.
Corrections: confirm the duplication, but narrow it to the shared lifecycle tail rather than the full methods end-to-end.
Refactoring sanity: the safest smallest move is a helper around the repeated prove→submit→persist sequence with per-path callbacks, not a fully generic template over all preparation logic.

### Q6 — ADJUSTED (moderate)
Independent assessment: `RecentActivityView` still inlines its own tx/journal/incoming merge, duplicates incoming-transfer/config/token wiring that `activity.vue` also owns, and repeats a large token-vs-non-token template branch with only small condition differences.
Instance check: `RecentActivityView.vue` and `activity.vue` are valid. `activity-rows.ts:42-76` and `journal-state.ts:324-352` are not smell sites themselves; they are good shared helpers, with `activity-rows.ts:11-14` reading more like stale/overstated extraction commentary.
Corrections: confirm half-finished extraction, but trim the bad instances to the widget/page code plus the stale helper comment.
Refactoring sanity: extracting `useIncomingTransfers` and collapsing the duplicated template branches are safe. Reusing/extending `buildActivityRows` in the widget is the smaller missing shared step.

### Q7 — CONFIRMED (high)
Independent assessment: this is real config duplication, not normal per-tool variance. `resolvePackageFile`, aliases, define constants, and e2e runner knobs are copied across configs, with explicit “Keep in sync” text and actual shipped drift.
Instance check: all cited files exhibit the issue. `vitest.e2e.all.config.ts` is visibly missing the noir aliases and `retry: 2` present in `vitest.e2e.network.config.ts`; the browser wrappers also mutate imported `viteConfig` in place.
Corrections: none.
Refactoring sanity: shared config factories/helpers plus `mergeConfig`-style wrapper composition is safe and is the smallest sane fix; it reduces drift without changing behavior.

### Q8 — ADJUSTED (moderate)
Independent assessment: edit dialogs are compensating for `useFormState`’s construction-time baseline with manual fill/reset/dirty logic, and several popups/selectors open-code the same add/update/delete list syncing that `useEntityCrud` is supposed to standardize. Repeated document-level Enter listeners reinforce the gap.
Instance check: `useFormState` and the edit-dialog slices are valid. `useEntityCrud.ts:7-8` is not itself a smell location, just evidence of an unused abstraction. `SelectBalanceTypePopup.vue` and `BalanceView.vue` show list-sync duplication, but they are outside the narrower “popup form lifecycle” scope.
Corrections: this finding conflates two issues: missing async rebase support in `useFormState` and incomplete adoption of `useEntityCrud`; the stated blast radius is inflated.
Refactoring sanity: adding a `rebase()` API to `useFormState` is safe. Moving all Enter/error behavior into `FormPopup` is only partly the smallest safe move; list-sync migration to `useEntityCrud` can proceed independently.