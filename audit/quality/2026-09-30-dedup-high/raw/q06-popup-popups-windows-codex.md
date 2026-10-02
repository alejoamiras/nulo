# q06-popup-popups-windows — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`, supplied repo maps, clone leads, and both prior audit reports.
- `apps/extension/src/popup/components/popups/`: production scripts, popup registration, and targeted templates/CSS.
- `apps/extension/src/popup/windows/`: all seven window entry components; execute display components and helpers; capabilities components and transformation helpers; verification header helper; shared window CSS.
- Supporting implementations: `useEntityCrud.ts`, `useDappApprovalWindow.ts`, `useDappHostname.ts`, `DappStatusStrip.vue`, `CapabilityDisclosure.vue`, the contact handlers in `pages/send.vue`, and `ContactRow.vue`.
- Targeted regression-test excerpts and FPC client/transport lifecycle code.

Reviewed `dev` at `910a4defcbacbb4e76b53c1d57551a457b1d3fb0`. No files modified or tests executed. Commit counts below are path-level counts; all-history counts equal counts since `2026-06-01`.

## q06-popup-popups-windows-X-1: Keyed list reconciliation is copied across nine consumers

**Title:** Repeated entity-list reducers. **Confidence:** high. **RECURRING (prior: 2026-08-16-extension-mid/Q-07)** — the collection-handler portion remains; the keyboard-handler portion is fixed.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** Structural. Eight popup components and the Send page independently reconcile service events into lists; `useEntityCrud` contains another implementation. Individual files have 4–19 commits, detailed below.

**Concrete evidence:** The repeated logic locates an entity by `id`, replaces or inserts it on an update, and removes it on deletion. The three ordinary contact consumers are effectively identical. FPC, profile, and token consumers repeat the same mechanics with legitimate policy differences: update-only versus upsert, duplicate-add checks, transformations, scope checks, and edit-target side effects.

`useEntityCrud.ts:104-140` already implements this operation family, but its immediate subscription/fetch lifecycle prevents safe wholesale substitution into every popup.

**Why it harms future change:** Changing how replayed adds, updates for absent rows, or entity identity are handled requires locating and checking nine implementations. The existing helper’s duplicate-add handling does not propagate to these independent copies.

**Smallest safe refactoring:** Extract Function for keyed list operations into `apps/extension/src/utils/entity-list.ts`, then reuse them from the consumers and `useEntityCrud`. Preserve explicit append/upsert/replace-only policies. Keep service ownership, popup timing, scope guards, draft refresh, and close-on-delete behavior in their current owners.

**What disappears:** Repeated lookup/replace/upsert and removal branches in nine consumers. Event callbacks with additional domain behavior remain; no popup needs to disappear.

**Instances:**

| Location | Behavior | Commits |
|---|---|---:|
| `apps/extension/src/popup/components/popups/NewContactPopup.vue:36-49` | Append, upsert, remove | 8 |
| `apps/extension/src/popup/components/popups/EditContactPopup.vue:38-62` | Same mechanics around edit-target handling | 9 |
| `apps/extension/src/popup/components/popups/ImportContactsPopup.vue:35-48` | Append, upsert, remove | 6 |
| `apps/extension/src/popup/pages/send.vue:196-209` | Append, upsert, remove | 19 |
| `apps/extension/src/popup/components/popups/NewFpcPopup.vue:89-99` | Append, replace-existing, remove | 6 |
| `apps/extension/src/popup/components/popups/EditFpcPopup.vue:136-153` | Same mechanics around edit-target handling | 8 |
| `apps/extension/src/popup/components/popups/SelectFpcPopup.vue:81-91` | Same mechanics with `prepareFpc` | 4 |
| `apps/extension/src/popup/components/popups/SelectProfilePopup.vue:77-91` | Upsert and remove | 5 |
| `apps/extension/src/popup/components/popups/SelectTokenPopup.vue:77-89` | Guarded append, replace-existing, remove | 4 |
| `apps/extension/src/composables/useEntityCrud.ts:104-140` | Existing reusable implementation, with different lifecycle | 2 |

## q06-popup-popups-windows-X-2: Verification bypasses the shared hostname policy

**Title:** A second implementation of dApp hostname normalization and warning detection. **Confidence:** high.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** Local implementation duplication affecting consistency across four window surfaces. Two implementation files: verification has 7 commits; the shared composable has 1.

**Concrete evidence:** Verification independently computes the URL hostname, falls back to the raw URL on parsing failure, scans for non-ASCII characters, and checks each hostname label for `xn--`. These are precisely the computations in `useDappHostname`.

Execute, capabilities, and discover already consume that composable at `execute/index.vue:134`, `capabilities/index.vue:121`, and `discover/index.vue:53`.

**Why it harms future change:** A change to malformed-URL fallback or hostname-warning rules updates three windows through the helper while leaving verification on the old behavior.

**Smallest safe refactoring:** Replace Inline Code with Function Call: use `useDappHostname(dapp)` in verification, retaining its current template-facing aliases. The existing C0 composable is the correct layer and accepts the existing ref shape.

**What disappears:** The two local computed implementations, approximately 15 net lines after adding the import and call.

**Instances:**

- `apps/extension/src/popup/windows/verify/index.vue:52-67`
- `apps/extension/src/composables/useDappHostname.ts:9-25`

## q06-popup-popups-windows-X-3: Endpoint forms maintain parallel error classifiers

**Title:** Add and Edit endpoint duplicate the RPC-error decision ladder. **Confidence:** high.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** Local. Two popup files, each with 7 commits; both consume the same network-service error vocabulary.

**Concrete evidence:** Both handlers normalize the caught error, then check `ENDPOINT_CHAIN_MISMATCH`, `DUPLICATE_ENDPOINT`, the exact message `Failed to fetch node info`, and a generic fallback. The duplicate-endpoint wording differs appropriately between adding and editing; the classification and other messages are shared.

**Why it harms future change:** Changing the service’s probe-failure message or improving chain-mismatch feedback requires synchronized edits to both forms. One overlooked branch leaves equivalent failures explained differently depending on which form the user opened.

**Smallest safe refactoring:** Extract Function into `apps/extension/src/popup/components/popups/endpoint-error.ts`. Accept the error, chain ID, and duplicate-endpoint copy; return the existing display text. Keep submission, refresh, and loading state in each popup.

**What disappears:** One duplicated four-way classifier, leaving two calls and the intentional per-form wording.

**Instances:**

- `apps/extension/src/popup/components/popups/NewEndpointPopup.vue:54-63`
- `apps/extension/src/popup/components/popups/EditEndpointPopup.vue:69-78`

## q06-popup-popups-windows-X-4: Both send-operation cases build the same draft

**Title:** Identical send-operation materialization branches. **Confidence:** high.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** Local. One frequently changed file: `execute/index.vue`, 19 commits.

**Concrete evidence:** The `aztec_sendTx` and `send_transaction` cases both resolve the network/account, spread the operation, attach identical resolved fields, derive the same optional embedded-fee settings through `isEmbeddedFeePayment`, and register the account. Their executable bodies are identical after comments are removed; this was checked directly.

**Why it harms future change:** Adding a resolved field or changing draft initialization requires editing both cases even though the existing fee helper already owns their format-specific distinction.

**Smallest safe refactoring:** Consolidate Duplicate Conditional Fragments: stack both case labels over one body inside `buildOperationsFromPayload`. Keep the operation-specific fee interpretation in the existing helper.

**What disappears:** One complete materialization body—11 non-comment statements/lines, plus its duplicated explanatory comment. Both discriminants remain supported.

**Instances:**

- `apps/extension/src/popup/windows/execute/index.vue:331-348`
- `apps/extension/src/popup/windows/execute/index.vue:349-365`

## q06-popup-popups-windows-X-5: Execute disclosures duplicate one visual control

**Title:** Raw-argument and authorization disclosures independently implement the same toggle. **Confidence:** high.

**Smell name:** Duplicate Code — Fowler. This is a repeated visual control, beyond generic flex-layout similarity.

**Maintenance impact:** Local. Two components within execute: `CallArguments.vue` has 1 commit; `OperationCard.vue` has 11.

**Concrete evidence:** Both render a native button with `aria-expanded`, a rotating 10px chevron, and an 11px secondary label. Their toggle and chevron CSS is identical after renaming `.toggle` to `.details_toggle`: 19 lines per location. The state ownership and label text differ; the control’s presentation does not.

**Why it harms future change:** Changing the disclosure hit area, focus treatment, or chevron motion requires parallel edits to two controls presented together in the approval window.

**Smallest safe refactoring:** Extract Component into `apps/extension/src/components/composite/DisclosureToggle.vue`, receiving expanded state and label content and emitting a toggle event. Preserve both callers’ state, test IDs, and labels. Keep it service-free under L3.

**What disappears:** Two copies of the button/icon structure become component calls; one copy of the 19-line style contract disappears.

**Instances:**

- `apps/extension/src/popup/windows/execute/CallArguments.vue:107-117`, `149-167`
- `apps/extension/src/popup/windows/execute/OperationCard.vue:260-269`, `582-600`

## q06-popup-popups-windows-X-6: Name/address rows repeat a shared typography contract

**Title:** Contact and account-picker identity text carry duplicated styles. **Confidence:** moderate.

**Smell name:** Duplicate Code — Fowler, applied to a shared visual role: a primary entity name above a secondary address.

**Maintenance impact:** Local across two UI modules. `ContactRow.vue` has 2 commits; `AccountSelectRow.vue` has 5.

**Concrete evidence:** Both define the same body-font name treatment—14px, weight 600, 20px line height—and mono address treatment—11px, 16px line height—with the same colors, overflow clipping, ellipsis, and nowrap behavior. The contact name additionally specifies letter spacing. These styles support matching name/address stacks despite different row interactions.

**Why it harms future change:** Adjusting identity-text readability or truncation requires updating both components. Existing design tokens centralize individual values, but not this multi-property visual contract.

**Smallest safe refactoring:** Extract a shared style module—the stylesheet equivalent of Extract Function—under `apps/extension/src/components/composite/`. Compose its name/address classes from both components, preserving the contact-only letter spacing and each row’s independent interaction/layout rules.

**What disappears:** One repeated pair of typography/truncation definitions, approximately 20 nonblank CSS lines. No combined interactive row component is needed.

**Instances:**

- `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:126-148`
- `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:176-197`

## Non-findings considered

- **Prior Q-07 keyboard duplication:** the cited CRUD popups now use `usePopupEntity`; do not re-report their former hand-written Enter handling.
- **Prior 2026-08-16/Q-11 approval shells:** execute, capabilities, and discover now share `DappApprovalFooter` and `window-shell.module.css`.
- **Prior 2026-08-14/Q-08 identity strips:** `DappStatusStrip`, `SignerIdentityStrip`, and verification use `IdentityStrip`; their remaining label decisions differ legitimately.
- **Prior clipboard/address-truncation findings:** inspected cluster consumers now use clipboard helpers and `trimAddress`; the previous implementations should not be re-reported.
- **Prior copied dead popup styles:** the named account/network popup blocks are gone; the remaining sender `.shake` styling has a template reference.
- **Confirm/Import/IncomingTrust/SelectNetworks setup clones:** store imports, `show` props, close emits, and popup-order expressions do not establish a shared business operation.
- **ChangeAuthwitsRegistry/RevokeAuthwits setup clones:** registry state is already shared through `useAuthRegistryStatus`; single-toggle and chunked-revocation execution have distinct behavior.
- **Approval-window setup clones:** these largely wire existing composables and explicit parent-owned service lifecycles. Combining whole windows would obscure distinct approval, completion, and rejection rules.
- **Verification session-ready wait:** the short shared wait does not justify making the already-established session window adopt pending-interaction rejection semantics.
- **Passkey window:** a registered route with a documented purpose and shared `runPasskeyCeremony`; absence of current callers alone is insufficient for a dead-code finding.
- **Capability transformation switches:** `build-items.ts` already shares `plainRows` between new and held grants; grant construction and disclosure rendering perform different transformations.
- **CapabilityDisclosure reuse for X-5:** its full-width panel, heading typography, and internally owned expansion differ from the compact execute toggle; replacing it wholesale would change the visual contract.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/popup/components/popups/SelectFpcPopup.vue:51` — Showing, hiding, then showing the registered popup again creates another connected `FpcServiceClient` without disconnecting the previous one. Both retain `onFpcAdded` callbacks targeting the same list, so a subsequent add event appends the row twice. The component stays mounted through `PopupManager.vue:342`. **Confidence: high**, conditional on opening this registered popup; no current direct opening call was found.
- `apps/extension/src/popup/windows/json/index.vue:42` and `apps/extension/src/popup/windows/logger/index.vue:41` — Navigating away through the hash router unmounts the viewer without unloading the document. The unmount hooks remove `beforeunload` listeners but never call `onClose`, leaving the profile connection—and the logger subscription—alive. **Confidence: high** for this navigation counter-example.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

IDs below retain the `q06-popup-popups-windows-` prefix. Confidence: high unless stated otherwise.

- **C-1 — Partially agree.** Duplication is real, but the proposed substitution changes behavior: FPC updates ignore missing rows, whereas `useEntityCrud` upserts. Its `dispose()` permanently disables refresh and removes subscriptions (`apps/extension/src/composables/useEntityCrud.ts:148-153`), so disposing on hide and refreshing on reopen cannot work. Extract list operations first.
- **C-2 — Partially agree.** New/Edit share validation, but Import has different acceptance semantics: `apps/extension/src/popup/components/popups/ImportContactsPopup.vue:128` deselects when **both** name and address collide; New/Edit reject either conflict. Share conflict detection, preserve separate acceptance rules. The claimed Send-page uniqueness instance is unsupported.
- **C-3 — Partially agree.** Repeated keys/arithmetic warrant consolidation, but “displacement” conflates two values: `apps/extension/src/popup/components/popups/ConfirmPopup.vue:87-88` passes raw order to `Popup` and reverse depth to `PopupCard`. These control z-index and displacement respectively. A shared interface must retain both; renaming one popup also does not require editing all 25 files.
- **C-4 — Agree, with narrower impact.** Verification’s hostname implementation duplicates the helper exactly; the current range is `apps/extension/src/popup/windows/verify/index.vue:52-67`. Small close-window/session-wait extractions are reasonable, but this is shared utility duplication rather than duplicated window lifecycles.
- **C-5 — Partially agree.** Cancellation classification repeats, but the proposed generic runner conceals material differences: discovery deliberately remains loading after success (`apps/extension/src/popup/windows/discover/index.vue:103-109`); execute rearms estimates/previews before classifying failures (`apps/extension/src/popup/windows/execute/index.vue:523-535`). Extract classification only; existing composable wiring is not itself a smell.
- **C-6 — Partially agree.** Queue extraction is reasonable, but only three sites compare scope equality; the other two check scope availability. One predicate cannot replace all five. Also, a C1 hook owning connection lifecycle contradicts `CLAUDE.md:273-278`: pass connected clients and retain parent teardown.
- **C-7 — Partially agree.** Shared popup padding and three heading styles are real candidates, but the fourth heading instance is wrong: `apps/extension/src/popup/components/popups/ImportContactsPopup.vue:301-309` defines overflow/truncation, not headline typography. Replacing three-line padding blocks with three-line `composes` blocks also does not deliver the claimed line reduction.
- **C-8 — Agree.** The executable bodies at `apps/extension/src/popup/windows/execute/index.vue:331-365` are identical after removing comments; stacked case labels safely remove the duplication.

**2. What Claude missed that I found**

- **X-3:** Endpoint error classification repeats four branches at `apps/extension/src/popup/components/popups/NewEndpointPopup.vue:54-63` and `apps/extension/src/popup/components/popups/EditEndpointPopup.vue:69-78`; extract classification while preserving their duplicate-URL wording.
- **X-5:** I retain the disclosure finding: matching button semantics accompany the identical CSS at `apps/extension/src/popup/windows/execute/CallArguments.vue:149-167` and `apps/extension/src/popup/windows/execute/OperationCard.vue:582-600`. Hit-area, focus, and motion changes provide concrete shared maintenance scenarios.
- **X-6:** I retain this narrowly, **moderate confidence**: name/address typography and truncation repeat at `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:126-148` and `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:176-197`. Shared styles suffice; merging interactive rows would be unjustified.

**3. What BOTH of us missed**

No additional findings established in this light pass.