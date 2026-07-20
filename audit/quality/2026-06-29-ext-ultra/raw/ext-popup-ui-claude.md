# QUALITY findings — `extension/popup-{pages,windows,popups,modules}` (L4–L6 Vue SFCs)

Scope: `packages/extension/src/popup/pages/**`, `popup/windows/**`,
`popup/components/popups/**`, `popup/components/modules/**`. Excludes `*.test.ts`.
Lens: typing + dedup (Vue-aware). 3 findings.

---

### POPUI-1 dApp Execute window re-narrows the wallet-bridge Operation union with `as unknown as` instead of trusting its own discriminated union
- Smell: Stringly/cast-as-narrowing + Under-exploited Discriminated Union (analog of Primitive Obsession at a type boundary — the union carries the discriminant `kind`, but consumers bypass it with structural casts).
- Lens: typing
- Maintenance impact: structural (highest-trust boundary: dApp operation approval)
- Blast radius: 2 files (the execute window + its row card); the casts defeat type-checking on the exact payload that leaves the popup for the SW executor.
- Instances:
  - `windows/execute/index.vue:135` — `op as unknown as Operation`
  - `windows/execute/index.vue:314` — `op as unknown as UIOperation`
  - `windows/execute/index.vue:330` — `op as unknown as import("./types").DraftOperation`
  - `windows/execute/index.vue:341` — `rest as unknown as import("./types").DraftOperation`
  - `windows/execute/index.vue:353` — `{ ...draft, previewedInterface } as unknown as Operation`
  - `windows/execute/index.vue:398` — `op as unknown as import("./types").DraftOperation`
  - (single casts) `index.vue:120, 312, 479, 485, 486`
  - `windows/execute/OperationCard.vue:201,205,209` — `parseTransferIntent(call) as { from } / { to } / { amount }`
  - `windows/execute/OperationCard.vue:455,459,463,471,472` — `op.messageHashOrIntent as { ... }` (5 inline structural casts to dig `.call.to` / `.innerHash` out of a loosely-typed field)
- Evidence:
  - `operations` is typed `ref<UIOperation[]>` where `UIOperation = DraftUIOperation = DraftOperation & { network; account? }` (`types.ts:55-59`). A `DraftUIOperation` is therefore structurally assignable to `DraftOperation`, yet `requiresFeeSelection(op)` is called as `requiresFeeSelection(op as unknown as DraftOperation)` at `index.vue:330` **and** `:398` — `requiresFeeSelection` already takes `DraftOperation` (`operation-validation.ts:48`). These two double-casts are gratuitous; the value already has that type.
  - The remaining `as unknown as` casts (135, 314, 341, 353) are all annotated with the same root cause: *"a pre-existing AztecAddress/Fr structural mismatch between popup-resolved Operation and wallet-bridge's"* (comments at `:131-134, :307-311, :327-329`). The popup defines an honest `Draft*` union (`types.ts`) + an `assertExecutableOperation` assertion (`operation-validation.ts:72`) precisely to make the Draft→Operation narrowing compiler-checked — then immediately discards that work with `as unknown as Operation` at `:353`, which erases the assertion's guarantee.
  - `OperationCard.vue` calls `parseTransferIntent(call)` 6× in the template (`:179,192,199,201,205,209`) and casts the result 3× (`as { from }`, `as { to }`, `as { amount }`) even though `parseTransferIntent` returns a *clean* discriminated union `TransferIntent` (`utils/transfer-intent.ts:39-42`). The template throws that union away and re-extracts fields by structural cast.
- Why it harms future change: This is the security-critical surface — the operation list that crosses popup→SW for signing/execution. `as unknown as` is a total type erasure: if the wallet-bridge `Operation` shape changes (a field renamed, a variant added), none of these six sites fail to compile; the regression surfaces only at runtime in the approval flow (the exact failure `types.ts:11-13` documents shipping once already: `Cannot read properties of undefined (reading 'priorityLevel')`). Every future Operation-shape change must be manually re-audited across both files because the compiler is blindfolded here.
- Refactoring: (1) Delete the two gratuitous `as unknown as DraftOperation` casts at `:330/:398` (the value is already `DraftOperation`). (2) For the genuine Fr/AztecAddress mismatch, fix it once at the seam — either align `DraftUIOperation`'s address fields to the wallet-bridge `Operation` representation, or add a single typed `toExecutable(draft): Operation` mapper that owns the conversion (Extract Function + Replace Cast-with-Conversion) so the `as` lives in one audited place instead of six. (3) In `OperationCard.vue`, compute `const intent = parseTransferIntent(call)` once and `v-if="intent.kind === 'transfer'"` to narrow — removes all 3 result casts and the 5 redundant re-parses; type `messageHashOrIntent` via its wallet-bridge union to kill the 5 `.call`/`.innerHash` casts.
- Effort: days (the Fr/AztecAddress seam fix is the slow part; the gratuitous-cast + template-narrow cleanups are hours)
- Confidence: high

---

### POPUI-2 Edit/New/Select popup family hand-rolls identical behavioral scaffolding (service lifecycle, Enter-key handler, error-tooltip) that `FormPopup` did NOT centralize
- Smell: Duplicate Code + Shotgun Surgery (one contract change → edit N popups).
- Lens: dedup
- Maintenance impact: structural
- Blast radius: up to 26 popup SFCs
- Instances:
  - **Service-client open/close lifecycle** — `watch(() => props.show, …)` that `new XServiceClient()` + subscribes events on open and `disconnect()` + resets refs + removes listeners on close, in **26** files: `ChangeAuthwitsRegistryPopup, EditContactPopup, NewContactPopup, SelectFpcPopup, IncomingTrustPopup, ConfirmPopup, SelectNetworksPopup, EditFpcPopup, EditAccountPopup, DataViewerPopup, SelectProfilePopup, NewFpcPopup, NewAccountPopup, SelectBalanceTypePopup, EditEndpointPopup, SelectTokenPopup, TokenMetadataPopup, ImportContactsPopup, NewEndpointPopup, RevokeAuthwitsPopup, EditProfilePopup, NewTokenPopup, ReceivePopup, NewSenderPopup, NewNetworkPopup, EditNetworkPopup` (`components/popups/*.vue`).
  - **Verbatim Enter-key handler** — identical 5-line block in **10** files (`EditContactPopup, NewContactPopup, EditFpcPopup:189-194, NewFpcPopup:121-127, EditAccountPopup:74-78, NewAccountPopup, EditEndpointPopup, NewTokenPopup:296-300, NewNetworkPopup, EditNetworkPopup:88-92`):
    ```js
    const onKeydown = (e) => {
      if (e.key !== "Enter") return
      const target = e.target
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
      handleXxx()
    }
    ```
    plus the paired `document.addEventListener/removeEventListener("keydown", onKeydown)` inside each show-watch.
  - **`processingError` ref + `#aboveSubmit` tooltip** — same `ref({ show, title, tooltip })` state shape + ~20-line `<Tooltip v-if="processingError.show">` template block, verbatim in `EditContactPopup, EditFpcPopup:99 + :274-295, NewContactPopup, NewFpcPopup:58 + :178-207`.
- Evidence: `FormPopup.vue` already centralizes the *visual* shell (title/headerRight/aboveSubmit/belowSubmit slots + a `@submit` emit — `FormPopup.vue:2,25-52`), and 11 popups consume it. But the *behavioral controller* was never extracted: every consumer re-implements the connect-on-show / disconnect-on-hide lifecycle, re-adds a global keydown listener (redundant with FormPopup's own `@submit`), and re-declares the error-tooltip state+markup. `EditFpcPopup.vue` and `NewFpcPopup.vue` are ~80% identical in their `<script setup>` (lifecycle watch, the three `onFpcAdded/Updated/Deleted` subs, `onKeydown`, `processingError`, `isAvailableTo…` gating).
- Why it harms future change: A change to the popup lifecycle contract — e.g. the service `disconnect()` ordering rule the repo already enforces elsewhere (CLAUDE.md "Cleanup order in onBeforeUnmount"), adding a teardown step, or fixing the keydown double-fire guard — must be applied by hand to up to 26 files, and they *will* drift (they already differ subtly: `NewContactPopup` has a long rationale comment on the keydown guard, the others have none; `processingError` init differs between NewFpc and EditFpc). Drift in a security-relevant teardown (a service left connected after a popup closes) is the concrete risk.
- Refactoring: Extract a `usePopupEntity(serviceFactory, { onShow, onHide })` composable (C1) that owns the show-watch + connect/disconnect + keydown wiring, and either fold the Enter handler into `FormPopup`'s `@submit` (drop the per-popup global listener entirely) or move it into that composable; move the error-tooltip into a `FormPopup` `#error` slot or a tiny `<ProcessingError>` composite. Removes the 26× lifecycle / 10× keydown / 4× tooltip duplication.
- Effort: days
- Confidence: high

---

### POPUI-3 Popups, modules, and pages are written in untyped `<script setup>` — the L4↔L5↔L6 prop/emit contract surface is uncheckable, and even typed islands degrade to `unknown`
- Smell: Boilerplate-per-consumer drift / loss of type contract (analog: every component re-declares an untyped boundary; "Stringly-Typed" emits via `defineEmits(["onClose"])`).
- Lens: typing
- Maintenance impact: structural
- Blast radius: 93 SFCs (29 popups + 28 modules + 36 pages)
- Instances:
  - `components/popups/**` — **0 of 29** use `<script setup lang="ts">`.
  - `components/modules/**` — **0 of 28** use `lang="ts"`.
  - `pages/**` — **1 of 37** uses `lang="ts"`.
  - Contrast (same layers, opposite choice): `windows/**` — **9 of 11** typed; shared `components/composite/**` and the dApp boundary are typed. The inconsistency shows this is drift, not a deliberate blanket policy.
  - Concrete cost trail: `OperationCard.vue:48` declares `feeEstimate?: unknown` and passes it to `FeeSettingsCard.vue`, which (untyped) declares `feeEstimate: { type: Object, default: null }` (`FeeSettingsCard.vue:32`) and reads `props.feeEstimate.maxFeeFormatted` / `.maxFeeUsd` (`:90`) with zero checking — even though a real `FeeEstimate` type exists at `utils/fee-estimation.ts:95`. The typed shape is thrown away at both ends of the prop.
- Evidence: untyped SFCs compile `defineProps({ show: Boolean })` and `defineEmits(["onClose"])` (e.g. `EditFpcPopup.vue:20-23`, `NewFpcPopup.vue:18-21`) into runtime-only validators. Prop *values*, emit *payloads*, service-client refs (`let fpcService = null`), and store reads are all `any`-inferred. A parent that listens `@close` for a child that emits `onClose`, or passes a renamed/mis-typed prop, gets no compile error.
- Why it harms future change: This is change-amplification with no safety net. Renaming a prop or changing an emit payload anywhere in the popup/module/page tree is invisible to `vue-tsc` and surfaces only in e2e or manual smoke — the slowest, flakiest feedback loop the repo has. The `FeeEstimate` case is the live example: rename `maxFeeFormatted` and the two consumers silently read `undefined`. The repo already proves it values this (windows + composites are typed); the gap is the high-churn UI layer where it would help most.
- Refactoring: Adopt `<script setup lang="ts">` with `defineProps<…>()` / `defineEmits<…>()` incrementally, starting with the most-consumed shared modules (`FeeSettingsCard`, `TokenCard`, `BalanceView`) and the popups that already import typed service clients; replace `feeEstimate: unknown`/`Object` with the existing `FeeEstimate` type. Restores compile-time checking on the L4↔L5↔L6 boundary.
- Effort: weeks (incremental; not a single change)
- Confidence: moderate (high that it costs; moderate on prioritization vs. the repo's chosen migration cadence)

---

## Out-of-focus notes (not scored — correctness/other focus)
- `components/modules/settings/{fpcs,authwits,connected-apps}/*-helpers.ts` share a *module shape* (Raw→Decorated type + sort + match/format) but the per-entity logic genuinely differs (different fields, sort keys, search columns). Checked for dedup — this is incidental similarity, **not** flagged (collapsing it would over-abstract, per the prompt's "wise dedup" rule).
- `connected-app-helpers.ts:1-3` uses `@ts-expect-error` for luxon's missing types — a vendored-types gap, not a quality smell in this code.

## Summary
3 findings. Highest-value: **POPUI-1** — the dApp Execute window erases type-checking on the operation payload that crosses popup→SW for signing via 6× `as unknown as` (2 of them gratuitous), blindfolding the compiler on the wallet's highest-trust boundary.
