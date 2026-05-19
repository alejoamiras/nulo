# Contacts: rename "Manage senders" → "Manage contacts" + persist isSender across export/import

Date: 2026-04-29
Status: DRAFT — awaiting dual-audit (codex xhigh + Plan agent) before execution

## Context

Two related follow-ups to the pre-A11 contacts-sender-optin arc that shipped earlier:

1. **Rename**: the "Manage senders" three-dot link from Assets view + token detail page repoints to the Senders settings surface directly. The user wants to discourage adding raw senders that aren't contacts — niche use case, high foot-gun potential. Senders should be a derivative of contacts: register-as-sender lives inside the contact-edit popup, where the user is already reasoning about a known person.

2. **Export persistence**: contact export currently captures `{name, address, color}`. Sender registration state is lost on export → import roundtrip. The user wants `isSender` persisted so a backup → restore preserves which contacts are also senders.

## Decisions confirmed by user

- **Rename**: relabel and repoint the Assets/Tokens "Manage senders" links to point at the Contacts settings page. The Senders settings surface stays where it is (Advanced → Account State → Senders) for power users, just without the Assets-side entry points.
- **Empty-state copy on token detail RecentActivityView**: rephrase to drop the "register them as senders" wording; talk about contacts instead.
- **Per-network export semantics**: **OR across all networks**. A contact gets `isSender: true` if registered on at least one network the user has. Import resolves against the active network at import time.

## Surface inventory (verified)

### "Manage senders" link sites

Two consumer sites, both targeting `/popup/settings/advanced/account-state/senders`:

- `packages/extension/src/popup/components/modules/general/TokensView.vue:217-222` — Assets-page tokens dropdown menu item.
- `packages/extension/src/popup/pages/tokens/[id].vue:163-168` — token detail page three-dot menu item.

The Senders settings entry inside Advanced → Account State (`pages/settings/advanced/account-state/index.vue:45`) is unchanged — still reachable from Settings → Advanced → Account State → Senders.

### Empty-state copy

- `packages/extension/src/popup/components/modules/general/RecentActivityView.vue:349`:
  > "Send or receive {symbol} from contacts — register them as senders so private transfers reach you."

  Rephrase target: drop the "register them as senders" phrase; keep the contacts framing.

### Contact export/import

- `packages/extension/src/wallet/services/contact/spec.ts:64,70` — `exportContacts(): string`, `importContacts(data: string): Contact[]`.
- `packages/extension/src/wallet/services/contact/service.ts:179-188` — current export shape `{name, address, color}`.
- `packages/extension/src/wallet/services/contact/service.ts:190+` — current import sanitizes name + address, ignores extra keys.
- `packages/extension/src/popup/pages/settings/contacts/index.vue:115,152` — `handleExportContacts`, `handleImportContacts` consumer sites.

### AccountStateService API

- `accountStateService.getSenders(networkId)` → `string[]` of addresses (per network).
- `accountStateService.addSender(networkId, address)` → registers sender on PXE.
- `networkService.getNetworks()` → all networks for the active profile (no chainId filter).

## Implementation plan

### Branch

`pre-a11/contacts-manage-rename-and-export-senders` from master.

### Commit 1 — Rename + empty-state copy

**Files**:
- `TokensView.vue:217-222` — change label `Manage senders` → `Manage contacts`; change route push from `/popup/settings/advanced/account-state/senders` → `/popup/settings/contacts`. Same icon, same testid pattern, same dropdown-item shape.
- `pages/tokens/[id].vue:163-168` — same change as above.
- `RecentActivityView.vue:349` — rephrase the empty-state line. Proposed: "Add the people you transact with to your contacts so you can find them quickly." (Drops the "senders" terminology entirely; keeps the contact-discovery framing.)

**No tests added** — these are presentational. The router push targets are validated by the existing route entry in `pages/settings/contacts/index.vue` (route file exists; tested manually).

**Bump**: 0.13.34 → 0.13.35.

### Commit 2 — Export `isSender` + import re-registration + tests

#### Service-side changes

`packages/extension/src/wallet/services/contact/service.ts`:

1. **Inject AccountStateService + NetworkService** dependencies into ContactService (verify they aren't already injected; if not, add to the service-collection wiring).

2. **`exportContacts()`** rewrite:
   - Fetch the network list once: `await networkService.getNetworks()`.
   - For each network, fetch the sender set once: `await accountStateService.getSenders(networkId)`. Result: `Map<networkId, Set<address>>`.
   - For each contact, compute `isSender = networks.some(n => senderSets.get(n.id).has(contact.address))`.
   - Emit `{name, address, color, isSender}` in the JSON.

3. **`importContacts(data)`** addition:
   - After `addContact` succeeds for a given imported entry, if `imported.isSender === true`:
     - Resolve active network: `await networkService.getActiveNetwork()` (or use the existing active-profile pattern).
     - `try { await accountStateService.addSender(activeNetwork.id, contact.address) } catch { logError, swallow }`
     - Failure is non-fatal: contact remains saved. Surface partial-failure state in the return value? **Decision needed during review**: extend the return type to `{contact, senderRegistered: boolean, senderError?: string}[]`, or keep silent and rely on `onSenderAdded` events? Initial preference: silent, mirror NewContactPopup's toast pattern at the popup level rather than service level.

#### Schema versioning

Add a top-level wrapper to the export so future migrations have a hook:

```json
{
  "version": 2,
  "contacts": [
    {"name": "...", "address": "...", "color": "...", "isSender": true}
  ]
}
```

**Backwards compat**: import auto-detects the schema:
- If parsed JSON is an array → version 1 (legacy): treat as `{contacts: parsed, version: 1}`. Per-contact `isSender` is missing → false.
- If parsed JSON is an object with `version: 2` → use as-is.

This avoids breaking users with existing exports on disk and lets us evolve the schema in future without another silent shape change.

#### Popup-side change

`packages/extension/src/popup/pages/settings/contacts/index.vue:152` (`handleImportContacts`):
- Existing flow stays — call `importContacts` and toast count.
- No popup changes needed if service-side handles sender registration silently. If we go the explicit-return-type route, popup surfaces a partial-failure toast.

### Test plan

All in `packages/extension/src/wallet/services/contact/service.test.ts` (existing file).

#### Export tests (5)

1. **Export with no senders on any network** → all contacts emit `isSender: false`.
2. **Export with sender on the active network** → that contact emits `isSender: true`.
3. **Export with sender on a non-active network** (OR-across-networks proof) → that contact emits `isSender: true`.
4. **Export with mixed sender state across networks** → each contact's flag reflects the OR correctly.
5. **Export shape**: top-level wrapper has `version: 2`, `contacts: [...]`.

#### Import tests (6)

6. **Import legacy array shape (no version)** → contacts saved, no `addSender` calls.
7. **Import v2 with `isSender: true`** → `addSender` called once on active network with the contact's address.
8. **Import v2 with `isSender: false`** → `addSender` NOT called.
9. **Import v2 with missing `isSender` field** → treat as false; `addSender` NOT called.
10. **Import addSender failure** → contact still saved; error logged; no throw bubbles up; remaining imports continue.
11. **Round-trip** (export → import on fresh state) → sender state preserved on the active network.

#### Mocking strategy

Existing service.test.ts likely uses fake AccountStateService + NetworkService. Verify the mocks expose `getSenders`, `addSender`, `getNetworks`, `getActiveNetwork`. If not, extend the fakes.

### Verification

- `bun run typecheck`
- `bun run test packages/extension/src/wallet/services/contact/service.test.ts`
- `bun run test` (full suite — ensure no regression elsewhere)
- `bun run build`
- Manual QA: export → import on the same profile, observe sender state preserved.

### Bump

0.13.35 → 0.13.36.

## Risk register

1. **Per-network export performance** — `getSenders` is a PXE roundtrip per network. With 5 networks × N contacts: 5 calls (we batch per network, not per contact). Acceptable.

2. **Active-network mismatch on import** — user exports from network A, imports on network B; `isSender: true` triggers `addSender` on B regardless of original origin. By design (per the OR-across-networks decision); document in the commit message so future readers don't think it's a bug.

3. **PXE locked / unavailable on import** — `addSender` requires PXE. If unavailable, swallow error per the non-fatal contract. Risk: user imports while PXE is down, contacts saved but no senders registered, no clear surfacing. Mitigation: the existing `EditContactPopup` toggle re-reads sender state on next view, so the user can re-trigger registration there. Acceptable.

4. **Schema version creep** — introducing `version: 2` opens the door to future migrations. Make sure the version field is documented as the only forward-compat hook (so we don't grow ad-hoc fields without bumping it).

5. **Import ordering** — current import iterates contacts and addSender after addContact for each. If the loop is unbatched, a single PXE flake fails one sender registration but doesn't abort the loop. Verify the existing per-iteration try/catch handles this; if not, add it.

## Out of scope (explicitly)

- ImportContactsPopup is a separate UI surface (the import that opens via the popup-router rather than the contacts page export menu). The user has indicated the planning pass for that popup is a separate concern. This branch only touches the export/import service contract and the contacts-page export/import flow; the popup remains as-is.
- Token-page parity for dApp activity (separate deferred item, unrelated).
- Hold-execute-window-open (unrelated, separate deferred item).

## Open questions for review

1. Schema versioning — `{version: 2, contacts: [...]}` envelope vs. extending the array entries with an opt-in `isSender` field directly (no envelope, just array of contact objects). Trade-off: envelope is forward-compatible at low cost; flat array keeps existing legacy import path simpler.

2. Service-level vs popup-level partial-failure surfacing for failed `addSender` during import. Initial preference: silent at service, popup toasts on completion if any sender registrations failed (requires extending `importContacts` return type).

3. Active-network resolution at import time — does ContactService currently have a clean handle to the active network, or do we need to thread it through? If threading, the popup gets an explicit `activeNetworkId` parameter.

4. Should the EditContactPopup's existing toggle-update flow be re-verified after this change? It already reads/writes per-network sender state; export/import shouldn't affect it but a regression check is worth flagging.
