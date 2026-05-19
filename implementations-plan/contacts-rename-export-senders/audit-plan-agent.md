# Audit — Plan agent (architect perspective)

Date: 2026-04-29
Reviewer: Plan agent (Sonnet)

The plan is broadly directionally sound for the rename/empty-state portion, but it contains **one BLOCKING architectural error** in the export/import portion: the plan modifies `ContactService.exportContacts()` / `importContacts()` while the actual UI flow at `pages/settings/contacts/index.vue:115-235` does NOT call those service methods at all. Edits to the service would be dead code from the perspective of the user-facing button. Additional findings on schema versioning, separation of concerns, and carve-out integrity below.

---

## BLOCKING

### 1. The service methods the plan rewrites are not on the export/import code path

The plan's central work item is rewriting `ContactService.exportContacts()` and `importContacts()` (`packages/extension/src/wallet/services/contact/service.ts:179-249`). But the popup-side handlers at `packages/extension/src/popup/pages/settings/contacts/index.vue:115-150` (export) and `:152-235` (import) **bypass these service methods entirely** and re-implement the work inline:

- `handleExportContacts` (`index.vue:115-150`) builds `JSON.stringify(contacts.value.map(...))` directly from the popup-side `contacts` ref, then calls `downloadFile`. It never touches `contactService.exportContacts()`.
- `handleImportContacts` (`index.vue:152-235`) reads the file, sanitizes inline (`index.vue:158-164`), pushes to `cacheStore.importContacts`, opens `ImportContactsPopup`, and on resolution iterates calling `contactService.addContact`/`updateContact` per row (`index.vue:188-198`). It never calls `contactService.importContacts()`.

`ContactServiceClient.exportContacts/importContacts` are wired (`client.ts:42-48`) and the service tests exercise the methods (`service.test.ts:191-211`), but no production caller invokes them. They're dead at the UI surface today.

This means the plan as written would land service-side schema/sender code that nobody runs. The actual sender-state persistence has to land in **either** (a) `index.vue` + `ImportContactsPopup.vue` directly, **or** (b) the popup must be refactored to delegate through the service layer first.

**Fix options:**
- **Option A — converge on the service** (recommended longer-term, but bigger change). Refactor the popup to call `contactService.exportContacts()` and let the service produce the JSON. For import: split `importContacts` into `parseImportFile(data) → ImportCandidate[]` + `commitImportSelection(candidates) → Result[]`.
- **Option B — match reality, edit the popup** (smaller change, but leaks domain logic into the popup). Add `isSender` emit in `handleExportContacts:115-120`, fetch `accountStateService.getSenders` per-network there, OR across networks, write into the JSON. On import, after the per-row `addContact/updateContact` at `:191-198`, conditionally call `accountStateService.addSender(appStore.network.id, address)` with try/catch.

Note: there's a separate full-wallet backup/restore at `pages/import.vue:302-317` that already round-trips per-network sender state via `AccountStateService.backup()/restore()` (`account-state/service.ts:103-205`). That path is independent of this contact-list JSON export. The plan should explicitly mention it to clarify scope.

---

## SHOULD-FIX

### 2. Schema versioning envelope is unnecessary given the pre-launch + no-migration policy

The plan proposes `{version: 2, contacts: [...]}` with autodetect on import (lines 89-105). I disagree: the project's storage policy is a destructive wipe-and-reseed at version bumps (`wallet/storage/migrate.ts:1-14`) and the user/runbook explicitly says "never write storage migrations." That policy should logically extend to user-facing JSON exports too.

A flat per-entry `isSender` field also keeps the export shape stable across the legacy and v2 cases. **Recommendation:** drop the envelope, add `isSender?: boolean` to per-entry.

(Codex disagreed with this in the parallel review, distinguishing storage-migration policy from user-supplied file format. Plan v2 sides with codex on this point.)

### 3. Per-network OR semantics — call out of scope, not service membrane breakage

The plan has `ContactService.exportContacts` iterating networks via `networkService.getNetworks()` and calling `accountStateService.getSenders(networkId)` per-network, then OR'ing across. This adds two new dependencies to ContactService (`AccountStateService`, `NetworkService`).

**Cleaner approach:** put the OR-query on `AccountStateService` itself. Add a method like `getSenderProfiles(): Promise<Map<address, networkIds[]>>` (or simpler `isAnySender(address): Promise<boolean>`). ContactService consumes one method; the network enumeration and OR live where the sender concept lives.

If the plan goes Option B (popup-direct), the popup already has access to `accountStateService` and the networks list, so the OR could just be done in the popup. But putting "is this address a sender on any network" on AccountStateService is still better service hygiene if anyone else ever needs it.

### 4. Active-network resolution at import — accepted UX, but worth widening test coverage

Plan accepts the precision loss: export OR's anywhere; import re-registers on active network. User OK'd this. The deeper risk: silent surprise on cross-profile/cross-chainId imports.

**Recommendation:** the import dialog (`ImportContactsPopup.vue`) should display the active network name once at the top — "Senders will be registered on Testnet (active)" — so users have a chance to switch network before confirming.

### 5. Test plan misses key real-world scenarios

Missing:
- PXE entirely down at import time, all senders fail, all contacts saved
- No active network at import — `getActiveNetwork()` returns nullable
- Contact already exists with `isSender: true` incoming — sender registration should still apply on the existing contact
- SW lifecycle interruption mid-import — known limitation, document
- Concurrent imports — flag in risk register
- Sender-not-yet-loaded race at export

### 6. Carve-out leakage: `ImportContactsPopup` does not share the service path

The plan carves out `ImportContactsPopup` for a separate planning pass. This is technically correct given the bypass-the-service problem — `ImportContactsPopup.vue:31-44` only handles the user-confirmation UX, then the parent's `handleImportContacts:188-198` does the actual writes. So the carve-out doesn't bleed.

But the carve-out is only sound under the current-bypass topology. If finding #1 is fixed via Option A (route through the service), then `ImportContactsPopup` becomes the consent surface that hands the service the selected candidates, and the service is what triggers `addSender`. That collapses the carve-out.

**Recommendation:** make the carve-out conditional. If you go Option A on finding #1, fold in the popup. If Option B, the carve-out holds.

### 7. Branch / commit structure — split into two PRs

The plan bundles the rename + empty-state copy + export/import service rework into one branch with two commits. I'd split:

- **PR 1** (rename + empty-state): three files, no tests, low risk, 5-minute review.
- **PR 2** (export/import + sender state): touches service signature, adds dependencies, 6+ tests, has the architectural fix-up from finding #1.

Bundling them couples a low-risk copy change with a non-trivial behavior change.

---

## NICE-TO-HAVE

### 8. Naming: "Manage contacts" link target needs scrutiny against `ImportContactsPopup` label collision

Sanity check that the rename doesn't make "Manage contacts" redundant with sub-items like "Manage tokens" already present in `TokensView.vue:210-215`.

### 9. Empty-state copy proposal is fine, but is it consistent with global RecentActivityView empty state?

The plan only edits the token-detail empty state at `:349`. There's no equivalent empty state for general/non-token-mode.

### 10. EditContactPopup regression risk

`EditContactPopup.vue:141-152` reads sender state via `accountStateService.getSenders(appStore.network.id)`. After this branch lands, importing a contact with `isSender: true` triggers `addSender(activeNetwork.id, addr)`, which fires `onSenderAdded`. If `EditContactPopup` is open at the time, its local state may not refresh. Add a manual QA step.

### 11. Risk register additions

- Cross-profile imports
- Color randomization on legacy imports
- PXE registration latency × N contacts

---

## VERIFIED

- Surface inventory at lines 22-49 is correct: only 2 link sites (`TokensView.vue:217`, `pages/tokens/[id].vue:163`).
- The empty-state at `RecentActivityView.vue:349` is gated by `v-else-if="token"` (`:341`) — only renders in token-detail mode.
- `accountStateService.getSenders(networkId)` exists and is per-network (`account-state/spec.ts:32`).
- `networkService.getNetworks()` returns all networks for the active profile (`network/spec.ts:166`); `getActiveNetwork()` is nullable (`spec.ts:192`).
- ContactService does not currently inject AccountStateService or NetworkService — would be net-new dependencies.
- The full-wallet backup/restore (`pages/import.vue` + `account-state/service.ts:103-205`) already round-trips per-network sender state through a separate path; this plan is additive to the JSON contact-only export.
- `ContactService` test scaffolding at `service.test.ts:25-64` uses a hand-rolled `FakeProfileService`. New tests will need `FakeAccountStateService` and `FakeNetworkService` shells.
- Storage version policy at `wallet/storage/migrate.ts:1-14` confirms wipe-and-reseed is the project rule.
- `NewContactPopup.vue:78-118` is the canonical pattern for "save contact + non-fatal sender registration with toast variants."

---

## Branch verdict

- Rename + empty-state: **looks-good**, ship as PR 1.
- Export/import: **needs rework** — finding #1 is structural; pick a layering strategy and re-plan the file-touched list.

---

## Suggested execution order

1. Land rename + empty-state as a tiny PR (3 files, no tests).
2. Re-plan export/import after deciding Option A (route through service) vs Option B (popup-direct).
3. Once decided, write the test fakes once, then the 11 tests + the additions in finding #5.
