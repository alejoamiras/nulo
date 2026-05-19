# Contacts: rename + persist isSender across export/import — plan v2

Date: 2026-04-29
Supersedes: `plan-v1.md`
Audits: `audit-codex.md` (gpt-5.4 xhigh), `audit-plan-agent.md` (Plan agent — written to file by agent)

## Changes from v1

| Topic | v1 | v2 |
|---|---|---|
| Where edits land | Service-side (`ContactService.exportContacts/importContacts`) | **Popup-direct** (`pages/settings/contacts/index.vue` for both export + import). Service methods untouched. |
| OR-query location | Inline in ContactService | New `AccountStateService.getSendersAcrossNetworks()` returning `Set<address>`. Single helper, single concern. |
| Export failure semantics | Unspecified | **Active-network gating** (mirror `AccountStateService.backup()` precedent at `account-state/service.ts:103-145`): skip networks whose `getNodeStatus !== Active`. |
| Import sender-restore trigger | Only after `addContact` (create branch) | After **either** `addContact` (create) **or** `updateContact` (merge) — keyed off the contact returned. |
| Active-network resolution at import | Per-iteration | **Snapshot once** before the loop. Null → record per-row sender failure for the isSender=true rows. |
| Schema envelope | `{version: 2, contacts: [...]}` | **Kept**, with strict parser (rejects unknown versions, malformed shapes). |
| Failure surfacing | Silent at service / event-driven | Aggregate per-row outcomes in the popup, show one summary toast (mirrors `NewContactPopup` pattern at `:83-106`). |
| Branch structure | One branch, two commits | **Two PRs**: rename + empty-state (atomic) → export/import (with tests). |
| Brutalist cleanup | Implied | **Explicit** — `pages/settings/contacts/index.vue` and `ImportContactsPopup.vue` get red/orange/green stripped while we're in them. |
| ImportContactsPopup carve-out | Deferred entirely | Carve-out holds for UX redesign. Two **minimal additive changes** in scope: an active-network banner at the top + brutalist color sweep. No flow / structural changes. |
| Test count | 11 | 16 (added: existing-contact + isSender, sanitized-out + isSender, unknown-version, no-active-network, PXE-down-export, all-fail-import, multi-network round-trip) |

## Confirmed decisions

- **OR-across-networks at export** with **active-only gating** (skip down networks).
- **Empty-state copy** rephrased + tightened.
- **Schema envelope kept** — distinct from persisted-storage migration policy.
- **Two PRs**.

---

## PR 1 — Rename + empty-state copy

### Files

| File | Change |
|---|---|
| `packages/extension/src/popup/components/modules/general/TokensView.vue:216-223` | Label `Manage senders` → `Manage contacts`. Route `/popup/settings/advanced/account-state/senders` → `/popup/settings/contacts`. testid `tokens-menu-senders` → `tokens-menu-contacts`. |
| `packages/extension/src/popup/pages/tokens/[id].vue:162-169` | Same rename + repoint. testid `token-manage-senders` → `token-manage-contacts`. |
| `packages/extension/src/popup/components/modules/general/RecentActivityView.vue:349` | Empty-state copy → **"Add contacts to send and receive {token.symbol}."** (shorter, brand-neutral; drops "senders" wording). |

### No tests

Presentational. Manual smoke covers it. The renamed routes already exist (verified `pages/settings/contacts/index.vue` is wired).

### Bump

0.13.34 → 0.13.35.

### Commit

```
fix(contacts): rename "Manage senders" → "Manage contacts" + tighten empty-state copy

The Assets and Tokens three-dot menus pointed users at the raw senders
settings surface. Senders are an Aztec-PXE concept layered underneath
contacts; users should reason about contacts and let sender state ride
along inside the contact-edit popup. Repoints both menu links to the
contacts settings page; the senders settings entry under Advanced →
Account State stays for power users.

Empty-state copy on the token detail RecentActivityView shortened to
"Add contacts to send and receive {symbol}." — drops the "register
them as senders" wording per the same direction.

testid contracts updated to match labels.
```

---

## PR 2 — Persist isSender across export / import

### Decisions in code

#### Schema (kept, strictly parsed)

```jsonc
// v2 export — emitted by handleExportContacts
{
  "version": 2,
  "contacts": [
    { "name": "...", "address": "0x...", "color": "...", "isSender": true }
  ]
}

// v1 export — what older builds emit, accepted by handleImportContacts
[ { "name": "...", "address": "0x...", "color": "..." } ]
```

**Strict parser** (new helper in `pages/settings/contacts/index.vue` script — small enough to inline, no separate util module):

```ts
function parseContactsExport(data: string): { version: 1 | 2; contacts: ImportedContact[] } {
  const parsed = JSON.parse(data)  // throws SyntaxError on bad JSON; caller handles
  if (Array.isArray(parsed)) {
    return { version: 1, contacts: parsed }
  }
  if (parsed && typeof parsed === "object" && parsed.version === 2 && Array.isArray(parsed.contacts)) {
    return { version: 2, contacts: parsed.contacts }
  }
  throw new Error("Unrecognized contacts export format")
}
```

Rejected shapes: `{version: 99}`, `{version: "abc"}`, `{contacts: null}`, `{}`, `null`, primitives. Caller surfaces a "Failed to import contacts" toast on throw — same pattern as the existing JSON-parse failure path.

#### Export — active-network gating

`pages/settings/contacts/index.vue` `handleExportContacts`:

1. Resolve network list from active profile: `await networkService.getNetworks()` (no chainId filter — returns all).
2. For each network, gate on health: `await networkService.getNodeStatus(network.id)` — skip if !== `Active`. Mirrors `AccountStateService.backup()` precedent at `account-state/service.ts:103-145`.
3. For each healthy network, fetch the sender set: `await accountStateService.getSenders(network.id)`. Build `Map<networkId, Set<address>>` once.
4. For each contact, OR across **healthy** networks: `isSender = healthyNetworks.some(n => senderSets.get(n.id).has(contact.address))`.
5. Emit `{version: 2, contacts: [...]}` JSON.

Down-network handling: silently skipped — the contact's `isSender` reflects health-known networks only. Documented in commit message; surfaced in the export-success toast as `"Contacts exported · sender state from N of M networks"` if any network was skipped.

#### Export — encapsulate the OR query

New method on `AccountStateService` (Plan agent's recommendation — keeps ContactService dependency surface unchanged; the OR-query lives where the sender concept lives):

```ts
// AccountStateService
public async getSendersAcrossActiveNetworks(): Promise<Set<string>>
```

Returns the union of sender addresses on all networks in the active profile that report `Active` status. Skips down networks. Single round-trip per network; no contact-level fan-out.

`handleExportContacts` calls this once and reads `Set.has(contact.address)` per contact.

#### Import — snapshot + run sender-restore on every successful merge

`pages/settings/contacts/index.vue` `handleImportContacts`:

1. Pick file, parse via `parseContactsExport`.
2. Sanitize the legacy/v2 contacts list as today (`name`, `address` length-limited; filter empty).
3. Open `ImportContactsPopup` for user selection (existing flow).
4. On resolution: snapshot active network: `const activeNetwork = appStore.network` (single ref read; null guarded).
5. Iterate selected contacts:
   - Existing-by-address: `await contactService.updateContact(...)` → `contactRow = existing`
   - Existing-by-name: `await contactService.updateContact(...)` → `contactRow = existing`
   - Else: `await contactService.addContact(...)` → `contactRow = newly-created`
   - **If the imported entry has `isSender === true`** AND `activeNetwork` is non-null:
     - `try { await accountStateService.addSender(activeNetwork.id, contactRow.address); senderOk++ } catch (e) { senderFail++; senderErrors.push({contact, error}) }`
   - If `isSender === true` AND `activeNetwork` is null: `senderFail++`, error: `"No active network"`.
6. On loop completion, surface aggregate toast:
   - All ok: `"N contacts imported · M senders registered"`
   - Partial: `"N contacts imported · M of K senders registered (rest failed)"`
   - All sender failed: `"N contacts imported · sender registration failed (PXE / network)"`

Mirrors `NewContactPopup`'s outcome-toast pattern at `:83-106`.

#### Brutalist cleanup (in-scope)

While in:
- `pages/settings/contacts/index.vue:141-143,214-230` — strip red/orange/green state signaling.
- `ImportContactsPopup.vue:143-190` — strip red/orange/green; add the active-network banner.

#### ImportContactsPopup banner (additive)

`ImportContactsPopup.vue` — single-line banner at the top:

> "Senders will be registered on **{activeNetwork.name}**."

Renders only when at least one staged contact has `isSender === true`. No flow change; the user can still proceed or cancel as today.

### Files touched (PR 2)

| File | Change |
|---|---|
| `packages/extension/src/wallet/services/account-state/spec.ts` | Add `getSendersAcrossActiveNetworks(): Promise<Set<string>>` to the service spec. |
| `packages/extension/src/wallet/services/account-state/service.ts` | Implement the helper. |
| `packages/extension/src/wallet/services/account-state/client.ts` | RPC wiring for the popup-side client. |
| `packages/extension/src/popup/pages/settings/contacts/index.vue` | `handleExportContacts` rewrite (network gating + OR + envelope), `handleImportContacts` rewrite (parser + per-row sender restore + aggregate toast). Brutalist sweep. |
| `packages/extension/src/popup/components/popups/ImportContactsPopup.vue` | Network banner (additive). Brutalist sweep. |
| `packages/extension/src/wallet/services/account-state/service.test.ts` | Tests for the new helper. |

### Tests (16)

#### Export tests (5) — `account-state/service.test.ts` + `pages/settings/contacts/index.test.ts` (new colocated test if absent)

1. `getSendersAcrossActiveNetworks` returns union of addresses across networks where status === Active.
2. `getSendersAcrossActiveNetworks` skips networks with status !== Active.
3. `getSendersAcrossActiveNetworks` returns empty Set when no networks are active.
4. Export end-to-end: contact registered on net A but not net B → `isSender: true` (proves OR semantics).
5. Export: down-network during export → that network's senders are skipped; toast notes the partial coverage.

#### Import tests (8)

6. Parser: legacy array → `{version: 1, contacts: [...]}`.
7. Parser: valid v2 envelope → `{version: 2, contacts: [...]}`.
8. Parser: unknown version → throws.
9. Parser: malformed shape (`{contacts: null}`, `{version: 2}`, `null`) → throws.
10. Import v2 with `isSender: true` on new contact → `addContact` then `addSender(activeNetwork.id, addr)`.
11. Import v2 with `isSender: true` on existing-by-address → `updateContact` then `addSender` (proves merge-path coverage).
12. Import legacy array → `addSender` NEVER called (backwards compat).
13. Import with no active network → contact saved; `addSender` skipped; failure recorded in summary.

#### Multi-failure tests (3)

14. Import: addSender fails on one row → other rows continue; aggregate toast mentions partial failure.
15. Import: PXE entirely down → all isSender=true rows fail; aggregate toast distinguishes "all-fail" from partial.
16. Import: sanitized-out row (empty name/address) with `isSender: true` → row dropped before addContact; addSender NEVER called.

#### Multi-network round-trip integration test

(Single combined test rather than separate cases.)

17. Round-trip: contact registered as sender on Network A. Export while active is Network B. Import on a fresh profile while active is Network C. Result: contact saved; sender registered on Network C only. Asserts the documented precision-loss UX.

### Mocking

`account-state/service.test.ts` already has mock infrastructure for `pxeService`, `networkService`. New helper test extends that with multiple network fixtures + variable `getNodeStatus` returns.

For popup-side tests, `pages/settings/contacts/index.test.ts` does not exist today — would be a new test scaffold using the project's Vue testing pattern. **Decision needed at execution time**: whether to write popup-component tests (more setup) or rely on service-level tests + manual QA for the popup-direct flow. Initial preference: skip popup component tests in this PR, document the manual QA plan in the commit message, add component tests in a follow-up if the test surface stabilizes.

### Verification

- `bun run typecheck`
- `bun run test packages/extension/src/wallet/services/account-state/service.test.ts`
- `bun run test` (full suite)
- `bun run build`
- Manual QA:
  - Export with multi-network sender → reopen file → check schema + isSender flags
  - Import legacy array → no addSender
  - Import v2 → addSender on active network only
  - Import while no network selected → graceful skip + toast
  - Import while one network is down → export still completes, toast notes partial coverage

### Bump

0.13.35 → 0.13.36.

---

## Risk register (consolidated)

1. **Active-network mismatch on cross-profile import** — user exports from network A, imports while active = B. `addSender` runs on B regardless of original origin. By design (per the OR-across-networks decision); commit message + ImportContactsPopup banner make it visible.

2. **PXE locked / unavailable on import** — `addSender` requires PXE. Failure is non-fatal; contact stays saved. Aggregate toast surfaces the partial state.

3. **PXE locked / unavailable on export** — `getSendersAcrossActiveNetworks` skips down networks. Export still completes; toast notes partial coverage.

4. **Schema version creep** — envelope is the forward-compat hook. Document `version: 2` as the only field that gets bumped on schema breaks.

5. **SW restart mid-import** — already a known limitation; this PR doesn't make it worse but does extend per-row latency by one PXE call when isSender=true. Documented; not addressed.

6. **Concurrent imports** — popup-level lock not added; existing behavior preserved. Documented.

7. **EditContactPopup live-update** — onSenderAdded fires after import-side addSender. EditContactPopup already subscribes to onSenderAdded for live state; no regression expected. Manual QA covers.

8. **Test fakes for popup-side** — popup-component testing is more setup than service-level. Initial PR ships service-level tests + manual QA; component tests follow if the surface stabilizes.

---

## Open question (one)

The strict parser lives inline in the popup (`parseContactsExport` ~10 lines). If anyone else needs to consume contact-export files in the future, it should move to `wallet-core/utils` or similar. For now, inline is fine — single consumer.

If you want a shared helper from day one, say so and I'll plan a `wallet-core/contacts-export-format.ts` module instead. Otherwise it's inline.
