<!-- codex session 01a00a88-cf71-7800-9904-0fa9c6da0a4e -->

### Finding: Full-backup restore is a 532-line transaction coordinator

1. **Smell name:** Long Method.

2. **Maintenance impact:** Architectural. The method coordinates profile, network, account, token, transaction, balance, auth-registry, FPC, contact, config, and account-state restoration in one control flow. Blast radius is primarily `useFullBackupImport.ts`, its tests, and eleven service contracts. High change frequency: 10 commits touched the file since 2025-08-16.

3. **Concrete evidence:** `restoreBackup()` spans [useFullBackupImport.ts:208](apps/extension/src/composables/useFullBackupImport.ts:208) through line 739. Within it:

   - Backup validation and migration: lines 219–312.
   - Profile/passkey restoration: lines 317–396.
   - Network restoration and identifier remapping: lines 398–460.
   - Account restoration and provenance filtering: lines 462–557.
   - Token and token-balance relinking: lines 559–619.
   - Six additional service restores: lines 624–648.
   - Profile finalization and account-state chain synchronization: lines 650–701.
   - Completion and rollback policy: lines 703–738.

4. **Why it harms future change:** Adding a restored slice or changing rollback policy requires reasoning about nested service lifetimes, pre/post-finalization failure semantics, identifier remapping, error-log ordering, and completion behavior simultaneously. A change near one restore stage can accidentally alter cleanup or rollback owned hundreds of lines later.

5. **Smallest safe refactoring:** Fowler’s **Extract Function**, performed stage-by-stage: extract validation/migration, profile-and-network restore, account provenance filtering, token relinking, ordinary slice restore, and post-finalization chain sync. Keep the top-level method as the transaction coordinator and preserve its existing rollback bookkeeping.

6. **What disappears after the refactoring:** The single 532-line nested control flow, locally nested helpers such as `filterByAccount`, and dispersed service-lifetime reasoning.

7. **Instances:** [useFullBackupImport.ts:208](apps/extension/src/composables/useFullBackupImport.ts:208).

---

### Finding: Approval-window footer is maintained three times

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** Structural. Blast radius is all three dApp approval windows. These files have changed together or individually in 7 commits since 2025-08-16.

3. **Concrete evidence:** Each window repeats the same footer container, conditional tooltip, error icon/title/content, two-button row, and corresponding footer CSS:

   - Execute: [execute/index.vue:502](apps/extension/src/popup/windows/execute/index.vue:502), styles at line 592.
   - Discover: [discover/index.vue:166](apps/extension/src/popup/windows/discover/index.vue:166), styles at line 231.
   - Capabilities: [capabilities/index.vue:341](apps/extension/src/popup/windows/capabilities/index.vue:341), styles at line 410.

   The surrounding `.wrapper` and `.scroll_area` rules are also identical at execute lines 561–577, discover lines 209–225, and capabilities lines 388–404.

4. **Why it harms future change:** Changing approval error presentation, footer spacing, accessibility attributes, button layout, or window scroll behavior requires synchronized edits across three security-sensitive approval surfaces.

5. **Smallest safe refactoring:** Fowler’s **Extract Component**. Introduce a shared approval-window frame/footer component that owns the error banner and common layout, with slots or props for action labels, test IDs, and disabled predicates.

6. **What disappears after the refactoring:** Three copies of the error-tooltip template and the duplicated `.wrapper`, `.scroll_area`, and `.footer` style blocks.

7. **Instances:** `popup/windows/execute/index.vue:502,561`; `popup/windows/discover/index.vue:166,209`; `popup/windows/capabilities/index.vue:341,388`.

---

### Finding: Five popups duplicate the centralized Enter-key policy

1. **Smell name:** Vue-specific **composable-extraction opportunity**, mapping directly to Duplicate Code: the same DOM-event predicate is copied across component setup blocks even though `usePopupEntity` already defines that policy.

2. **Maintenance impact:** Structural. Blast radius is five popups plus the existing composable. These popups collectively changed in 4 commits since 2025-08-16.

3. **Concrete evidence:** Each handler tests for Enter, checks that the event target is an `HTMLInputElement` or `HTMLTextAreaElement`, then calls its local submit function:

   - [NewContactPopup.vue:151](apps/extension/src/popup/components/popups/NewContactPopup.vue:151)
   - [EditContactPopup.vue:195](apps/extension/src/popup/components/popups/EditContactPopup.vue:195)
   - [NewFpcPopup.vue:121](apps/extension/src/popup/components/popups/NewFpcPopup.vue:121)
   - [EditFpcPopup.vue:192](apps/extension/src/popup/components/popups/EditFpcPopup.vue:192)
   - [NewTokenPopup.vue:296](apps/extension/src/popup/components/popups/NewTokenPopup.vue:296)

   The same policy is already encoded in [usePopupEntity.ts:33](apps/extension/src/composables/usePopupEntity.ts:33). Three copies also retain explanatory comments for the same double-submit hazard.

4. **Why it harms future change:** Supporting another editable control, ignoring composition events, or changing Enter-submit accessibility semantics requires finding every copy. A partial update would give otherwise similar CRUD popups different keyboard behavior.

5. **Smallest safe refactoring:** Fowler’s **Extract Function** first: centralize the predicate as `isPopupSubmitKey(event)`. Popups whose async listener-order requirements match `usePopupEntity` can then use **Replace Inline Code with Function Call** without changing when listeners become active.

6. **What disappears after the refactoring:** Five copies of the element-type predicate and the repeated explanatory comments.

7. **Instances:** `NewContactPopup.vue:151–161`; `EditContactPopup.vue:195–203`; `NewFpcPopup.vue:121–127`; `EditFpcPopup.vue:192–197`; `NewTokenPopup.vue:296–301`.

---

### Finding: Balance-flight identity is encoded in ad hoc strings

1. **Smell name:** Primitive Obsession. A structured identity `(scope key, balance leg, epoch)` is represented by delimiter-joined strings. This also creates a Data Clump because the same three values must travel together at every lookup and cleanup site.

2. **Maintenance impact:** Structural. Blast radius is `balances.store.ts` and its state-machine tests; consumers depend on its externally visible fetch semantics. Low historical frequency—one commit since 2025-08-16—but high local coupling inside the store.

3. **Concrete evidence:** Both flight registries are declared as `Map<string, …>` at [balances.store.ts:170](apps/extension/src/stores/balances.store.ts:170). The encoding `${key}|${leg}|${epoch}` or a hard-coded gas/FPC variant is reconstructed at lines 335, 357, 385, 396, 452, 464, 469, 511, and 515.

4. **Why it harms future change:** Adding a balance leg or changing epoch identity requires editing every string-construction site. A single mismatched leg, delimiter, or epoch omission would bypass single-flight reuse or fail to clear a completed flight, and TypeScript cannot detect it.

5. **Smallest safe refactoring:** Fowler’s **Replace Primitive with Object** in a minimal form: introduce one typed/branded `flightKey(scopeKey, leg, epoch)` constructor and require both maps to accept only its result. A later extraction into per-entry flight state is optional.

6. **What disappears after the refactoring:** Nine scattered composite-key templates and unrestricted string keys for the two flight registries.

7. **Instances:** `balances.store.ts:170–171,335,357,385,396,452,464,469,511,515`.

---

### Finding: Barrier frame markup and styling have forked copies

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** Structural. Blast radius is the two production-wired root barriers and their component tests. The pair has changed in 2 commits since 2025-08-16.

3. **Concrete evidence:** Both components render a teleported full-screen warning frame with the same wrapper/card/title/sub/detail hierarchy:

   - [MigrationBarrier.vue:79](apps/extension/src/components/MigrationBarrier.vue:79)
   - [AccountIntegrityBarrier.vue:67](apps/extension/src/components/AccountIntegrityBarrier.vue:67)

   Their `.wrapper`, `.card`, `.title`, `.sub`, and `.detail` rules are effectively identical:

   - `MigrationBarrier.vue:106–144`
   - `AccountIntegrityBarrier.vue:91–129`

4. **Why it harms future change:** Adjusting overlay stacking, typography, width, warning presentation, or accessibility requires parallel edits. The migration component also has a separate banner mode, making it easy for changes to its shared full-screen frame to miss the account-integrity frame.

5. **Smallest safe refactoring:** Fowler’s **Extract Component**: create a visual-only `BlockingBarrierFrame` with title/default/detail slots. Keep raw-storage reads and their distinct staleness guards in their current owners.

6. **What disappears after the refactoring:** One complete copy of the full-screen frame markup and approximately 39 lines of repeated module CSS.

7. **Instances:** `components/MigrationBarrier.vue:79–102,106–144`; `components/AccountIntegrityBarrier.vue:67–87,91–129`.

---

### Finding: Two security interactions discard every rejection

1. **Smell name:** **Exception swallowing**, a named error-handling smell. The mapping is direct: catch blocks erase failures without recording, translating, or explicitly classifying them.

2. **Maintenance impact:** Local. Blast radius is the generic confirmation popup and encrypted-key export page. The two files have collectively changed in 3 commits since 2025-08-16; both empty catches date to their original implementation.

3. **Concrete evidence:**

   - [ConfirmPopup.vue:51](apps/extension/src/popup/components/popups/ConfirmPopup.vue:51) awaits passkey confirmation and has an empty `catch` at line 57.
   - [key.vue:52](apps/extension/src/popup/pages/settings/security/export/key.vue:52) automatically exports the encrypted key and has an empty `catch` at line 58.

   A scope-wide multiline search found no other completely empty catch blocks.

4. **Why it harms future change:** New service rejection types, protocol failures, and telemetry requirements cannot be distinguished from intentional cancellation. Maintainers investigating a stalled confirmation or blank encrypted-key view get no state transition or diagnostic signal.

5. **Smallest safe refactoring:** Introduce an **explicit error boundary** at each interaction: classify known user cancellation as an intentionally ignored result, and route all other failures to existing page error state, toast infrastructure, or logging.

6. **What disappears after the refactoring:** Both empty catches and their unused exception variables.

7. **Instances:** `popup/components/popups/ConfirmPopup.vue:51–57`; `popup/pages/settings/security/export/key.vue:52–59`.

## Non-findings considered

- The broader “ten hand-rolled popup lifecycles” lead is a non-finding as stated: listener timing, target guards, disabled-state gates, and async initialization differ, while `usePopupEntity` mandates listener-before-`onShow` ordering.
- Creation-popup CRUD wiring is not safely replaceable wholesale with `useEntityCrud`: that composable subscribes and fetches immediately for component scope, while several popups construct clients and subscribe only while shown; edit popups also have entity-specific update/delete side effects.
- `seed.vue` and `key.vue` are no longer near-identical twins: the key page now contains a public/private variant selector and a materially different state graph.
- The barriers’ staleness guards are not duplicate algorithms: migration reads fixed keys and lets per-key events outrank its initial snapshot, whereas account integrity scans a prefix and needs latest-refresh-wins generation fencing.
- The balance store’s promise reuse and retry timers are required state-machine behavior; the finding is limited to primitive composite-key representation, not their existence.