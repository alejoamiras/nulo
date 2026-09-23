## Findings

### 1. Five popups carry an identical dead stylesheet, with additional unused selectors elsewhere

**Smell:** **Dead Code** and **Duplicate Code**. The same unreachable CSS-module rules were copied into five components; several other components retain similar isolated dead selectors.

**Impact bucket:** **structural** — 13 files contain unused CSS; the largest duplicated block spans five popup modules and approximately 280 lines. The affected files had 19 unique commits in the last 12 months, although blame shows the five copied blocks themselves have remained untouched since the initial import on 2026-05-19.

**Evidence:**

The same `.network`, `.icons`, and `.item` block appears in all five locations:

- `apps/extension/src/popup/components/popups/NewAccountPopup.vue:138-193`
- `apps/extension/src/popup/components/popups/EditAccountPopup.vue:97-152`
- `apps/extension/src/popup/components/popups/NewNetworkPopup.vue:194-249`
- `apps/extension/src/popup/components/popups/EditNetworkPopup.vue:133-188`
- `apps/extension/src/popup/components/popups/NewSenderPopup.vue:180-235`

Each copy defines identical row borders, hover/active behavior, icon opacity, and `.item.selected`/`.item.disabled` states. Searches within every owning SFC found no `$style.network`, `$style.icons`, `$style.item`, literal class assignment, or dynamic bracket access.

Additional dead CSS confirmed by the same reference check:

- `apps/extension/src/popup/components/popups/EditContactPopup.vue:300-318` — `.shake` and its keyframes.
- `apps/extension/src/popup/components/popups/EditProfilePopup.vue:185-198` — `.icon_btn`.
- `apps/extension/src/popup/components/popups/AccountsPopup.vue:142-191` — `.account`, `.account_name`, `.txt_button`, and `.icons`; the separate `.icon_btn` at line 193 is live.
- `apps/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue:313-316` — nested `.row`.
- `apps/extension/src/popup/components/popups/SelectProfilePopup.vue:148-165` — `.token`.
- `apps/extension/src/popup/components/popups/SelectTokenPopup.vue:111-128` — `.token`.
- `apps/extension/src/popup/components/modules/general/BalanceView.vue:388-398` — `.hover_red`.
- `apps/extension/src/popup/components/popups/SelectNetworksPopup.vue:135-137,145-149` — `.icons`.

These are local `<style module>` symbols. Vue exposes them through the owning SFC’s `$style` binding; component/composable auto-registration does not register or apply CSS-module selectors. No registration mechanism therefore accounts for the missing references.

**Why it harms future change:** A future list-row or theme redesign presents five apparently relevant implementations to update even though none affects rendered output. Reviewers must repeatedly determine whether the rules are intentionally dormant, and copying one of these popups can propagate another obsolete stylesheet.

**Smallest safe refactoring:** **Remove Dead Code**. Delete the five identical blocks and the listed isolated selectors/keyframes. Approximately 280 duplicated lines plus the scattered residue disappear without introducing a new abstraction.

**Instances:**

- `NewAccountPopup.vue:138-193`
- `EditAccountPopup.vue:97-152`
- `NewNetworkPopup.vue:194-249`
- `EditNetworkPopup.vue:133-188`
- `NewSenderPopup.vue:180-235`
- `EditContactPopup.vue:300-318`
- `EditProfilePopup.vue:185-198`
- `AccountsPopup.vue:142-191`
- `RevokeAuthwitsPopup.vue:313-316`
- `SelectProfilePopup.vue:148-165`
- `SelectTokenPopup.vue:111-128`
- `BalanceView.vue:388-398`
- `SelectNetworksPopup.vue:135-137,145-149`

### 2. Clipboard policy is implemented independently at ten call sites

**Smell:** **Duplicate Code**, producing **Shotgun Surgery**. Each location directly invokes the browser clipboard and coordinates its own success/error toast.

**Impact bucket:** **structural** — 10 files across shared components, popup modules, and popup screens. These files accumulated 18 unique commits in the last 12 months.

**Evidence:**

All production clipboard writes in scope are:

- `apps/extension/src/components/ScopeAddress.vue:47-54`
- `apps/extension/src/components/ScopeClassId.vue:21-25`
- `apps/extension/src/components/header-copy-address.ts:11-20`
- `apps/extension/src/popup/components/modules/general/BalanceView.vue:135-138`
- `apps/extension/src/popup/components/popups/AccountsPopup.vue:44-52`
- `apps/extension/src/popup/components/popups/EditFpcPopup.vue:146-149`
- `apps/extension/src/popup/components/popups/ReceivePopup.vue:26-29`
- `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:74-83`
- `apps/extension/src/popup/components/popups/TokenMetadataPopup.vue:39-42`
- `apps/extension/src/components/JsonViewer/JsonViewer.vue:72-81`

The repeated logic is: prepare a value, call `navigator.clipboard.writeText(...)`, then emit a copy toast. Existing divergence demonstrates the maintenance split:

- `header-copy-address.ts:11-20` awaits, handles rejection, and strips control characters.
- `IncomingTrustPopup.vue:74-83` awaits and handles rejection but does not use the address sanitization policy.
- The other eight sites announce success synchronously and contain no shared failure path.
- `ScopeAddress.vue:47-54` substantially duplicates the existing header helper’s address transformation and success message but does not reuse it.

**Why it harms future change:** Standardizing permission-denied feedback, clipboard telemetry, address sanitization, or toast wording requires auditing ten handlers across unrelated UI layers. The already-divergent awaiting, error, and sanitization behavior makes partial adoption likely.

**Smallest safe refactoring:** **Extract Function** and **Move Function**. Generalize `header-copy-address.ts` into a shared `copyToClipboard(text, options)` helper that owns awaiting, failure feedback, and success feedback; retain a small `copyAddressToClipboard` wrapper for address sanitization. Local visual state such as `isCopied` remains in its component. Nine inline browser-call/toast sequences disappear.

**Instances:**

- `ScopeAddress.vue:47-54`
- `ScopeClassId.vue:21-25`
- `header-copy-address.ts:11-20`
- `BalanceView.vue:135-138`
- `AccountsPopup.vue:44-52`
- `EditFpcPopup.vue:146-149`
- `ReceivePopup.vue:26-29`
- `IncomingTrustPopup.vue:74-83`
- `TokenMetadataPopup.vue:39-42`
- `JsonViewer.vue:72-81`

### 3. The dApp identity strip has three independently maintained implementations

**Smell:** **Duplicate Code** with **Divergent Change**. A common presentation component has split into a shared single-account version, an execute-specific version, and an inline verify version.

**Impact bucket:** **structural** — three implementations serving four windows/modules: discover, capabilities, execute, and verify. The files have four unique commits in the last 12 months.

**Evidence:**

- `apps/extension/src/components/composite/DappStatusStrip.vue:20-28` renders the status dot, account, separator, network, and `NULO` mark; its duplicated styles occupy `:32-94`.
- `apps/extension/src/popup/windows/execute/SignerIdentityStrip.vue:20-38` repeats that scaffold and adds multi-signer branches; its near-identical styles occupy `:42-103`.
- `apps/extension/src/popup/windows/verify/index.vue:179-192` inlines the same scaffold, while `:271-330` repeats the corresponding identity-strip styles.

The shared version is consumed by discover and capabilities at:

- `apps/extension/src/popup/windows/discover/index.vue:143-148`
- `apps/extension/src/popup/windows/capabilities/index.vue:262-267`

Execute consumes its private copy at `apps/extension/src/popup/windows/execute/index.vue:460`; verify embeds its copy directly.

Across all three implementations, the duplicated logic includes the outer strip layout, status dot, account/network typography and truncation, separator, and trailing brand mark. Only display-value selection and the execute/verify `MIXED` state differ.

**Why it harms future change:** Changing this anti-phishing trust anchor—such as its spacing, brand treatment, status semantics, accessibility attributes, or account truncation—requires coordinated changes in three implementations. A change to the shared component alone silently leaves execute and verify visually inconsistent.

**Smallest safe refactoring:** **Extract Component**. Introduce a presentation-only identity-strip frame that owns the common markup and CSS and accepts status plus slots or normalized account/network display values. Keep signer-count and fallback-address calculation in the existing window adapters. The duplicate scaffold and style blocks disappear from all three implementations.

**Instances:**

- `components/composite/DappStatusStrip.vue:20-28,32-94`
- `popup/windows/execute/SignerIdentityStrip.vue:20-38,42-103`
- `popup/windows/verify/index.vue:179-192,271-330`

## Non-findings

- **New/Edit popup pairs:** The shared `FormPopup`, `useFormState`, and entity composables already centralize the stable lifecycle. Remaining similarities are mostly field-specific validation, persistence, and edit gating; a single parameterized CRUD component would introduce conditional configuration rather than remove a stable duplicate algorithm.
- **“Already exists” validation:** The message/rendering shape repeats, but each predicate and edit-warning gate is domain-specific. The common fragment is too small to justify a validation abstraction beyond the existing form API.
- **Confirm-dialog invocation:** No repeated invocation exists inside this cluster; its callers are outside the audited directories.
- **Large files by LOC:** Size alone was not treated as Long Method or Large Class; no additional repeated change axis was established from the scoped pass.