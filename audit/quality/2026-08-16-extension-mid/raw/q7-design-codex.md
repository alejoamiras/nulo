<!-- codex session 01a00a89-091b-7192-8da7-c974efc55dbf -->

### Finding: Public components advertise inert API features

1. **Title:** Public components advertise inert API features.

2. **Smell name:** **Dead Code**. `Input` exposes an unused prop, while the base and extension buttons declare an event that neither emits nor forwards.

3. **Maintenance impact:** **Structural**. Blast radius: three production modules across the design package and extension wrapper. Since January 2026, `Input.vue` changed twice, design `Button.vue` five times, and the wrapper once; the inert declarations therefore remain on actively maintained public surfaces.

4. **Concrete evidence:**

   - `packages/design/src/ui/Input.vue:48-51` declares the `suffix` prop, but the component never reads or renders it. `packages/design/src/ui/Input.vue:305` instead exposes a distinct named slot, `#suffix`.
   - `packages/design/src/ui/Button.vue:7` declares `onKeybind`, but the file has no emitter reference or `emit(...)` call.
   - `apps/extension/src/components/ui/Button.vue:17` repeats the same declaration, also without emitting or forwarding it.
   - A repository-wide production search found no `suffix=`/`:suffix=` use on `<Input>` and no `@onKeybind`, `@on-keybind`, or other `onKeybind` listener. Existing suffix consumers consistently use `<template #suffix>`.
   - Auto-registration does not invalidate the dead-code result: `apps/extension/scripts/design-resolver.ts:10-29` only registers component names, and `apps/extension/vite.config.ts:134-159` only configures symbol/component discovery. Neither mechanism synthesizes prop reads or event emissions. The components are publicly exported at `packages/design/src/index.ts:27,30`.

5. **Why it harms future change:** Consumers and generated Vue typings present these names as supported contracts. Implementing a real string suffix later must reconcile it with the established slot, while implementing or removing keyboard behavior requires discovering that the event was independently copied into the wrapper.

6. **Smallest safe refactoring:** **Remove Dead Code** — delete the unused `suffix` prop and both `onKeybind` declarations. Preserve the existing `#suffix` slot.

7. **What disappears after the refactoring:** The false string-suffix API, the false keyboard-event API, and the wrapper’s redundant synchronization point.

8. **Instances:**

   - `packages/design/src/ui/Input.vue:48-51`
   - `packages/design/src/ui/Button.vue:7`
   - `apps/extension/src/components/ui/Button.vue:17`

### Finding: The byte-identical sanitizer fork has no identity guard

1. **Title:** The byte-identical sanitizer fork has no identity guard.

2. **Smell name:** **Duplicate Code** plus **Comments-as-deodorant**. The same normalization algorithm exists in two production packages because of a legitimate dependency boundary, but comments claim a byte-identity guarantee that no executable check enforces. The comment is compensating for missing structural enforcement.

3. **Maintenance impact:** **Structural**. Blast radius: two implementation modules, one misleading guard test, and four direct production consumer modules: design `Input`, extension backup import, contact import/export, and contact service. Change frequency is low but independent: the design copy has one commit since introduction, while the extension utility has two commits.

4. **Concrete evidence:**

   - `packages/design/src/internal/sanitize.ts:9-18`
   - `apps/extension/src/utils/string.ts:33-42`

   Both contain the same falsy guard, `/[^\p{L}0-9 \-._]/gu` replacement, post-cleaning length cap, and return logic.

   `packages/design/src/internal/sanitize.ts:1-7` calls the implementation a “byte-identical copy.” Likewise, `packages/design/src/internal/sanitize.test.ts:4-6` calls its fixture suite a “Byte-identity pin,” but that test imports only the design copy at line 2 and never imports, reads, or executes `apps/extension/src/utils/string.ts`. Repository search found no other cross-copy parity test.

5. **Why it harms future change:** A change to the permitted character set, Unicode handling, or truncation order can land in either copy while its local tests remain green. `Input sanitize` behavior would then diverge from backup/contact normalization despite the source claiming they are identical.

6. **Smallest safe refactoring:** **Introduce Assertion** — add one cross-package contract test that runs a shared edge-case table through both exported functions and asserts identical results. This preserves the deliberate dependency boundary. A later dependency-neutral extraction can remove the duplication if the repository gains an appropriate lower-level utility package.

7. **What disappears after the refactoring:** Silent behavioral drift and the unenforced “byte-identical” assumption; the unavoidable physical fork remains explicit and guarded.

8. **Instances:**

   - `packages/design/src/internal/sanitize.ts:9-18`
   - `apps/extension/src/utils/string.ts:33-42`
   - Missing-guard evidence: `packages/design/src/internal/sanitize.test.ts:2-35`

## Non-findings considered

- **Two authoring conventions:** NON-FINDING — runtime `PropType` and generic `defineProps` styles are both typed now; the remaining syntactic split does not demonstrate synchronized edits or behavioral drift.
- **Two toast implementations:** NON-FINDING — `Toast.vue` is a queue-driven dismissible item, while `ToastManagerBase.vue` owns a teleported singleton lifecycle; their different interfaces reflect different responsibilities rather than duplicated implementation.
- **Toast raw-color axis:** NON-FINDING — the earlier severity audit introduced `SeverityTone`; `severity.ts:12-14` explicitly retains the manager’s separate raw-color contract. Re-reporting it would duplicate that remediation decision.
- **Badge / Tag / DisclaimerTag trio:** NON-FINDING — Badge is a filled semantic-status surface, Tag is an outlined contextual label, and DisclaimerTag centralizes fixed product copy. They do not contain a common variant implementation that can safely be substituted.
- **`Input.vue` as Large Class:** NON-FINDING — its modes are numerous, but the input, paste, clamping, warning, and focus paths remain one cohesive input-normalization responsibility.
- **Repeated uppercase/letter-spacing declarations:** NON-FINDING — most occurrences differ in role, font, size, weight, and tracking; the genuinely identical CTA typography block was already consolidated by the 2026-08-14 remediation.