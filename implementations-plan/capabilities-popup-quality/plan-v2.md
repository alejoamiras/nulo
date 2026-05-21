# Capabilities popup — quality + brutalist + honest-copy pass (plan v2)

**Status:** plan v2.1 — APPROVED by user (see "User decisions" section at the bottom). Implementation in flight on branch `feat/capabilities-popup-quality`.
**Tier:** B (UI-only, contained surface, dual audit).
**Branch target:** new branch `feat/capabilities-popup-quality` cut from `dev`.
**Severity:** UX + trust. v1 had material protocol errors (acknowledged in audit-codex.md). v2 grounds every copy claim against the dispatcher / scope-enforcement / dapp-interaction source files.

## Audit reconciliation summary

| Finding | Source | Reconciliation |
|---|---|---|
| Default `confirmationLevel = Transactions(5)`, not `AppState(1)` | codex | **Codex correct.** Verified at `background.ts:400`. Opus had the wrong default. |
| `accounts.canCreateAuthWit` is **silent** under default policy | codex | **Codex correct.** `PrivateData(4) >= Transactions(5)` is false → no popup. Opus's per-op claim wrong. |
| `transaction` always opens execute popup, even with embedded `feePayer` | codex | **Codex correct.** Two-pronged force: access-level `5 >= 5` always true + `feePayer === undefined` short-circuit. Opus's "embedded fee = silent" claim wrong. |
| `simulateViews` is gated by `simulation.transactions.scope`, not `.utilities.scope` | codex | **Codex correct.** v1 had it bucketed wrong. |
| `humanizeMethodName` is lossy (collapses `transfer`, `transfer_in_private`, etc. → `Transfer (private)`) | codex | **Confirmed.** v2 keeps raw method id + friendly label as annotation. |
| `<AddressDisplay>` doesn't write clipboard | both | **Confirmed at `AddressDisplay.vue`.** v1 was wrong. v2 ditches AD for the capability panel and keeps explicit `copyAddress`. |
| `<AddressDisplay>` prefers contact-book names over raw address | codex | **Confirmed.** Trust-relevant in the capability popup. v2 renders raw address + name annotation when present. |
| `contractClasses.classes` are class IDs, not addresses | codex | **Confirmed at `capabilities.ts:30-34`.** v2 never routes class IDs through AddressDisplay. |
| Layer-rule violation: L4 settings → L6 window helper | codex | **Confirmed.** v2 introduces Phase 0 extracting capability metadata to a lower layer (`src/wallet/services/dapp-session/capability-meta.ts`). |
| Unknown-capability persistence | codex | **Confirmed.** Approved unknown grants live in storage (`dapp-session/service.ts`). v2 default-OFF unknown cards in the popup so a click is required. |
| `data` cap omits `registerSender`, `accounts` omits `registerToken` | codex | **Confirmed at `capability-map.ts:21, 42`.** v2 copy reflects both. |
| `accounts` head card rarely seen in popup (cap is rendered as picker) | codex | **Confirmed at `index.vue:115-116`.** v2 acknowledges; head copy still matters in existing-grants + settings contexts. |
| "Permissions:" header already exists on accounts detail panel | codex | **Confirmed.** v1 proposed re-adding it; v2 drops that change. |
| Type-only diff hole for non-`accounts` capability widening | codex | **Confirmed at `dispatcher.ts:431-440`.** Out of scope for this plan (it's the existing `wallet-sdk-capability-field-diff` issue), but acknowledged so v2 does not falsely claim the PREVIOUSLY DENIED badge covers upgrades. |
| `GRANT_SHORT_LABELS` is a third duplicate label map | both | **Confirmed at `connected-apps/index.vue:24-31`.** v2 folds it into the single-source CapabilityInfo extension. |
| Settings page header still says "Granted capabilities" | both | **Confirmed at `[id].vue:287`.** v2 brings it into the rename scope. |
| Mono PREVIOUSLY DENIED badge too quiet | both | **Confirmed.** v2 keeps brutalist form but adds an `--orange` border accent (consistent with the family's other warning states). |
| `cap-request-basic` not the right e2e floor | codex | **Confirmed.** v2 expands the e2e set to cover authwit + sendTx variants + rerequest/partial/repeat. |
| Dispatcher does NOT reject unknown capability types | codex | **Confirmed at `dispatcher.ts:402-498, 627-640`.** v1 claimed it did; v2 drops that claim from the security section. |

The verdict in `audit-codex.md` was **REWORK**; v2 is the rework. Everything material is now grounded against verified code, not against the v1 plan's misreadings.

## TL;DR (v2)

Three problems, same as v1, but with corrected protocol facts:

1. **Honesty.** The popup says `transaction → "Submit transactions to the network on your behalf"` — wrong; the right framing is "the dApp may *request* sends within the scope below; each send opens an execute popup". For `accounts.canCreateAuthWit` v1 said "you approve each one"; that's also wrong — under default `confirmationLevel = Transactions(5)`, authwit creation is silent (verified by `authwit-variants.test.ts`). The honest framing is "create scoped authorizations within the transaction scope" (authwits are call-scoped, validated by `scope-enforcement.ts:241-287`).
2. **Visual coherence.** Same as v1 — risk text painted red/yellow/green, green check-circles, saturated orange "previously denied" badge. Goal unchanged: mono glyphs + uppercase tokens + targeted (not saturated) semantic accents in line with the rest of the popup family (which is "mono surfaces + targeted semantic dots", *not* "no semantic color" — refined per both audits).
3. **Decode depth.** Same as v1 in spirit, with two corrections from codex: (a) keep raw method ids visible since `humanizeMethodName` is many-to-one lossy; (b) do NOT use `<AddressDisplay>` for contract addresses inside the capabilities panel — it auto-resolves contact-book names by default (trust-leaking in the capability context) and does not write clipboard. Use explicit raw-address + optional name-annotation rendering and keep the existing `copyAddress` UX.

## Capability protocol summary — v2 (corrected)

Default session policy is `confirmationLevel = AccessLevel.Transactions(5)` (set at `background.ts:400`). The per-op popup decision is `accessLevel >= confirmationLevel` OR the `send_transaction`/`aztec_sendTx` short-circuit at `service.ts:357`. Scope enforcement at `scope-enforcement.ts` runs *before* the popup decision; out-of-scope requests are rejected.

| Capability | Gated wallet-sdk methods | Per-op popup under default policy? |
|---|---|---|
| `accounts.canGet` | `getCompleteAddress` | **Silent** (`AccessLevel.PublicData(2)`). |
| `accounts.canCreateAuthWit` | `createAuthWit` | **Silent under default**. `PrivateData(4) < Transactions(5)`. A user-tightened policy below 4 would force popups. Authwits are call-scoped: `scope-enforcement.ts:241-287` validates each authwit against the granted transaction/simulation scope before signing. |
| `accounts` (always, with `registerToken`) | `registerToken` | Silent (`AccessLevel.AppState(1)`). Per `capability-map.ts:21`. |
| `contracts.canRegister` | `registerContract`, lower-case `register_contract` | Silent (`PxeState(3)`). |
| `contracts.canGetMetadata` | `getContractMetadata` | Silent (`PxeState(3)`). |
| `contractClasses.canGetMetadata` | `getContractClassMetadata` | Silent (`PxeState(3)`). |
| `simulation.transactions.scope` | `simulateTx`, `profileTx`, lower-case `simulate_transaction`, AND `simulateViews` (per `scope-enforcement.ts:165`) | Silent (`PrivateData(4)`). |
| `simulation.utilities.scope` | `executeUtility`, lower-case `simulate_utility` | Silent (`PrivateData(4)`). |
| `transaction.scope` | `sendTx`, lower-case `send_transaction` | **Popup ALWAYS** (`Transactions(5) >= 5` always true; the embedded-`feePayer` short-circuit is a force-true, not a bypass — see `tx-sendTx-feePayer.test.ts:55-57` for live proof). |
| `data.addressBook` | `getAddressBook` | Silent (`AppState(1)`). |
| `data.privateEvents` | `getPrivateEvents` | Silent (`PrivateData(4)`). |
| `data` (always, with `registerSender`) | `registerSender`, `aztec_registerSender` | Silent (`PxeState(3)` for the aztec form; `AppState` for the lower-case form per `service.ts:374-419`). |

**Key corrections from v1's table:**
- `accounts.canCreateAuthWit` is **Silent**, not per-op popup.
- `simulateViews` belongs in the `simulation.transactions.scope` row.
- `accounts` cap also covers `registerToken` (write path, missed in v1).
- `data` cap also covers `registerSender` (write path, missed in v1).
- The `transaction` row is the ONLY one that triggers a popup under default policy — but a user-tightened policy can force more.

## Type-only diff hole (acknowledged, out of scope)

Verified at `dispatcher.ts:431-440`. The current dispatcher field-diffs `accounts` capabilities but only type-diffs every other capability. Consequence: a dApp already granted `contracts.contracts = ["A"]` can later request `contracts.contracts = ["A","B"]` and the diff returns empty → no delta → no popup → no PREVIOUSLY DENIED badge. The new permission is silently appended (or worse, treated as already-granted).

The plan does NOT fix this. It is filed separately as `wallet-sdk-capability-field-diff` (the inline comment at `dispatcher.ts:430` already names this). v2 acknowledges in the popup-side copy:
- The PREVIOUSLY DENIED badge fires on **previously-rejected types**, NOT on **scope upgrades to already-granted types**. The current "Already granted" section header in the popup doesn't claim otherwise; v2 doesn't add any claim that would be invalidated by the field-diff hole.

Out of scope. Documented here so the audit + future readers know v2 isn't claiming security it doesn't deliver.

## Final copy table (v2, post-audit)

`getCapabilityInfo` becomes the **single source** for all three label maps (popup card head, settings detail panel header, settings list short summary). The extracted module lives at `packages/extension/src/wallet/services/dapp-session/capability-meta.ts` (lower-layer location, accessible to both L4 and L6 — see Phase 0).

The interface gains a `shortLabel` field:

```ts
export interface CapabilityInfo {
  label: string
  shortLabel: string  // ← new, used by GRANT_SHORT_LABELS consumer
  description: string
  risk: CapabilityRisk
}
```

| Type | `label` (card head, settings detail header) | `shortLabel` (settings list summary) | `description` (one-line under head) |
|---|---|---|---|
| `accounts` | Account access | Accounts | Read your account addresses and register tokens. May also request auth witnesses for shared accounts. |
| `contracts` | Contract registration | Contracts | Register and read contract metadata on this network. |
| `contractClasses` | Contract class lookup | Classes | Read contract class metadata on this network. |
| `simulation` | Transaction simulation | Simulation | Run simulations locally. Nothing is sent to the network. |
| `transaction` | Send transactions | Transactions | Request transactions within the scope below. Each transaction still requires your approval. |
| `data` | Private data | Private data | Read your address book and private events. May also register senders for event decryption. |
| _unknown_ | **Unknown permission** | **Unknown** | This wallet doesn't recognize this permission. Reject if you don't know what it does. |

Notes:

- `accounts.description` is conditional on the flags actually present on the cap. The detail panel decodes the specific flag set; the head description summarizes the union. The "May also create scoped signatures..." clause is hedged with "May" because `canCreateAuthWit` is optional on the wire.
- `transaction`'s "Each transaction still requires your approval" survives v1 verbatim — codex verified it holds under default policy AND user-tightened policies (because lowering `confirmationLevel` only adds popups, never removes the send-tx one).
- The unknown row is special — Phase 4 enforces a fixed, sanitized rendering and a default-OFF UX.
- The `accounts` head card is rarely shown in the **delta** UI (the popup renders an account picker for `accounts` instead — `index.vue:115-116`); the head copy is for the **existing grants** section and the settings detail page.

### Detail-panel sub-copy (per-permission rows)

`CapabilityDetailPanel.vue`'s per-branch rows get the following per-flag strings:

| Capability + flag | Current row text | v2 row text |
|---|---|---|
| `accounts.canGet` | "View accounts" | "Read your account addresses" |
| `accounts.canCreateAuthWit` | "Create auth witnesses" | "Sign auth witnesses for actions on your accounts (scope-checked against your other granted permissions before signing)" |
| _accounts always_ | _(not shown)_ | "Register tokens (adds an entry to your wallet's local registry)" |
| `contracts.canRegister` | "Register contracts" | _unchanged_ |
| `contracts.canGetMetadata` | "Read contract metadata" | _unchanged_ |
| `contractClasses.canGetMetadata` | "Read class metadata" | _unchanged_ |
| `simulation.transactions` | "Transaction simulation: …" | "Simulate transactions (and view-calls) in scope:" |
| `simulation.utilities` | "Utility simulation: …" | "Simulate utilities in scope:" |
| `transaction.scope` | "Scope: …" + "Each transaction still requires your approval" | "Allowed transactions:" + "Each transaction still requires your approval" |
| `data.addressBook` | "Address book access" | "Read address book" |
| `data.privateEvents.contracts` | "Private events: …" + scope rows | "Read private events from:" + scope rows |
| _data always_ | _(not shown)_ | "Register senders (adds an entry to your wallet's local registry for event decryption)" |

### Per-row scope rendering — humanize but never lose the raw

Codex's lossy-humanize finding lands here. The scope rows render as:

```
  <contract address — raw, trimmed, sanitized, with optional contact annotation>
    <function: raw method id, sanitized>  ·  <getMethodLabel(method) if recognized>
```

The `<ScopeAddress>` component (Phase 3) owns the address row; the function row stays inline in `CapabilityDetailPanel.vue`. Concretely (Vue template-ish for the function row):

```vue
<Flex align="center" gap="6">
  <Text size="11" color="tertiary">fn:</Text>
  <Text size="11" weight="600" color="secondary" :class="$style.mono">
    {{ p.function === "*" ? "*" : sanitizeWireString(String(p.function), 64) }}
  </Text>
  <Text v-if="p.function !== '*' && getMethodLabel(String(p.function))" size="11" color="tertiary">
    · {{ getMethodLabel(String(p.function)) }}
  </Text>
</Flex>
```

Where:
- **`sanitizeWireString(s, maxLen)`** is a single shared helper exported from the lower-layer `capability-meta.ts` module. Clamps to `maxLen` chars + ellipsis, strips Unicode bidi-control codepoints (`U+202A`–`U+202E`, `U+2066`–`U+2069`), strips non-printable codepoints. Used for **all** wire-controlled strings: function selectors (`maxLen=64`), contract addresses (`maxLen=128`), class IDs (`maxLen=128`), the unknown-cap `type` (`maxLen=32`), AND the parenthetical contact annotation (`maxLen=32` — defensive: the user typed it, but they could have pasted a unicode bidi attack).
- **`getMethodLabel(method): string | null`** is a NEW exported helper added to `packages/extension/src/utils/tx-enrichment.ts` (Phase 3 touches that file — see below). Returns the entry from `METHOD_LABELS` if present, else `null`. **Not** a wrapper around `humanizeMethodName` (that function is lossy because it title-cases unknowns — we don't want that here; the unknown case shows just the raw).
- **`<ScopeAddress :address="..." />`** is a NEW component at `packages/extension/src/components/ScopeAddress.vue` (flat under `src/components/`, NOT in `components/composite/` — see Phase 3 location note). Renders the trimmed raw address as primary, the user's local contact name parenthetically with an `@` prefix if it exists, sanitizes both via `sanitizeWireString`. Click writes to clipboard with the existing toast.
- **`<ScopeClassId :id="..." />`** is a NEW component at `packages/extension/src/components/ScopeClassId.vue` (same flat location). Renders class IDs as trimmed sanitized strings. NO contact lookup, NO name annotation.
- **`.mono` style** in CapabilityDetailPanel.vue: `font-family: var(--font-mono); letter-spacing: 0.04em;`.

This preserves the cosmetic upgrade (friendly labels for known methods) WHILE keeping the raw method id authoritative — which is what a careful user needs to verify what they're approving. Every wire string goes through `sanitizeWireString` before display.

### contractClasses.classes — never use AddressDisplay, never look up contacts

Class IDs (`contractClasses.classes: "*" | string[]`) are NOT addresses. v2 renders them through a dedicated `<ScopeClassId>` component (`src/components/ScopeClassId.vue` — flat tier, not composite). Each class ID passes through `sanitizeWireString(id, 128)`, gets trimmed to `0xabcd…ef01`, and supports clipboard copy on click. **No contact-book lookup, no contact annotation.** This was v1's bug, called out by codex.

### Unknown capability — UX

Phase 4 enforces these properties on the unknown card:

1. **Head label** is the constant `"Unknown permission"` (never the dApp-controlled `cap.type`).
2. **The raw `cap.type`** is displayed in a small mono row beneath the head, prefixed `type:` and passed through:
   - Length clamp at 32 chars + ellipsis
   - Strip non-printable + bidi control chars
   - HTML-escape (Vue template interpolation already does this — never `v-html`)
3. **Risk indicator** shows `▲ HIGH` regardless of the `risk` field. We bias toward caution for unknown types.
4. **Default-OFF**: the cap card's `selected` state initializes to `false`. The user must check the box to approve. Recognized cap types default to `selected = true` as today.
5. **Detail panel** says: "This wallet doesn't recognize this permission. Reject if you don't know what it does. (raw type below for context)" + the sanitized raw type rendered again for forensics.

This addresses codex's persistence concern: a hostile dApp can send an unknown type, but without an active user click the cap is unselected, the user's approve press grants nothing for it, and there's no persisted grant for a future wallet to retroactively honor.

## Phases (v2)

### Phase 0 — extract capability metadata to a shared layer (NEW)

**Goal:** unblock the multi-surface label rewrite without breaking the L4-no-import-from-L6 biome rule.

**Files touched:**
- New file: `packages/extension/src/wallet/services/dapp-session/capability-meta.ts`
  - Owns: `CAPABILITY_LABELS` map (with the v2 `shortLabel` field), `getCapabilityInfo()`, `isKnownCapability()`, `sanitizeWireString(s, maxLen)`.
  - Pure-data + pure-function module — **NO Vue, NO `chrome.*`, NO service-client deps, NO `managers.*` imports.** This purity is a code-review responsibility; the biome `noRestrictedGlobals` ban on `chrome.*` is scoped to the `wallet-core` package only, NOT to this path (codex audit-codex.md "Final pass" §3), so the maintainer enforces it on review rather than CI.
  - **Does NOT own** `contactAnnotation` / `getMethodLabel` — those need cross-module concerns (contact-book lookup, method label lookup). Live in `<ScopeAddress>` and `tx-enrichment.ts` respectively.
- Delete: the existing `packages/extension/src/popup/windows/capabilities/capability-meta.ts` (its content moves to the new location).
  - Re-export shim NOT added — there's no public API stability concern; we update all (3) call sites in the same phase.
- Update call sites:
  - `packages/extension/src/popup/windows/capabilities/index.vue` (imports `getCapabilityInfo` at line 15) — repoint to new path.
  - `packages/extension/src/popup/windows/capabilities/CapabilityCard.vue` — currently imports `CapabilityRisk` type from `./capability-meta`; repoint.
  - `packages/extension/src/popup/components/modules/settings/connected-apps/connected-app-helpers.ts` — delete its local `CAPABILITY_LABELS` map (lines 5-12), reroute `getCapabilityLabel(type)` to call `getCapabilityInfo(type).label`. This is the call site that motivated the new layer location.
  - `packages/extension/src/popup/pages/settings/connected-apps/index.vue` — delete its local `GRANT_SHORT_LABELS` map (lines 24-31), reroute `formatGrantSummary` to use `getCapabilityInfo(g.capability.type).shortLabel`.

**Move (not just copy) the test:** `packages/extension/src/popup/windows/capabilities/capability-meta.test.ts` moves to the new location.

**Behavior change:** none. The v1 strings (and the still-unfixed risk colors) keep working post-Phase-0. The phase is plumbing.

**Validation:** `bun run --cwd packages/extension lint` (biome enforces the layer rule — will fail if we miss something), `bun run --cwd packages/extension test:unit capability-meta.test.ts`, `bun run --cwd packages/extension typecheck:all`.

**Why first:** every later phase touches both L4 and L6 surfaces; without this, Phase 1's "single source of truth" claim either lies or violates the layer rule.

### Phase 1 — capability metadata + copy unification

**Goal:** the v2 copy table lands; all three label maps now read from one source.

**Files touched:**
- `packages/extension/src/wallet/services/dapp-session/capability-meta.ts` (the new home from Phase 0) — rewrite `CAPABILITY_LABELS` per the v2 table. Add `shortLabel`. Risk values **unchanged** (the visual changes Phase 2; the data stays).
- Test file (now at the new location) — assertions updated to the v2 strings. New assertion: `getCapabilityInfo("transaction").description` mentions `"approval"`; `getCapabilityInfo("accounts").description` mentions `"register tokens"`; `getCapabilityInfo("data").description` mentions `"register senders"`. (Locking in the load-bearing tokens.)

**Behavior change:** copy text only.

**Validation:** `bun run --cwd packages/extension test:unit capability-meta.test.ts`.

### Phase 2 — visual normalization on CapabilityCard

**Goal:** brutalist visual, retain targeted semantic accent on warning state.

**Files touched:**
- `packages/extension/src/popup/windows/capabilities/CapabilityCard.vue`
  - **Risk chip** (lines 72–78): mono uppercase + glyph rendering — as in v1. The glyph picks (▲ ● —) survive both audits. Render uses `--font-mono`, `--nulo-secondary` color, no fill.
    ```vue
    <span :class="$style.risk_tag" :data-cap-risk="risk">
      <span :class="$style.risk_glyph">{{ riskGlyph(risk) }}</span>
      {{ riskWord(risk) }}
    </span>
    ```
    With `riskGlyph(r)` returning `▲ / ● / —` and `riskWord(r)` returning `HIGH / MED / LOW`.
  - **Checkbox icon** (lines 59–60): `color="green"` → `color="primary"` for the checked state.
  - **Granted variant** (line 95): static `color="tertiary"` — unchanged.
  - **`denied_badge`** (lines 167–177): keep the warning semantic. v1's all-mono treatment is too quiet per both audits. v2:
    ```css
    .denied_badge {
      padding: 2px 6px;
      border: 1px solid var(--orange);
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--orange);
      white-space: nowrap;
      background: transparent;
    }
    ```
    Orange-bordered mono uppercase on transparent fill. Consistent with `verify/index.vue:202` (`color="orange"` for IDN warning) and `SignerIdentityStrip.vue` (orange `MIXED` tag).
  - **Unknown-cap rendering hint**: when the parent passes `risk: "high"` (always the case for unknown-type cards in Phase 4), the card head shows the `▲ HIGH` glyph. No new branching here — the constant-risk treatment is a parent-side choice.

- `packages/extension/src/popup/windows/capabilities/CapabilityCard.test.ts`
  - Update `expect(w.text()).toContain("low")` → `expect(w.text()).toContain("LOW")`. Same for medium/high.
  - Add `expect(w.find('[data-cap-risk]').attributes('data-cap-risk')).toBe('low')` as the authoritative selector for risk level.
  - Re-confirm all preserved testids: `cap-item`, `cap-toggle`, `cap-detail-toggle`, `cap-rerequested-badge`, `data-cap-id`, `data-cap-name`, `data-cap-granted`.
  - New test: `data-cap-risk` attribute present and matches the prop.

**Behavior change:** visual only. The same risk signal is rendered, just in mono with a glyph; the warning badge keeps a (now-orange-outline) accent.

### Phase 3 — detail panel decode parity, with honesty preservation

**Goal:** raw method ids + humanized annotations; raw addresses + optional contact annotations; **no** AddressDisplay, **no** clipboard regression, contractClasses kept as IDs. Every wire string sanitized.

**Files touched:**
- **New file: `packages/extension/src/components/ScopeAddress.vue`** (flat tier — same level as `AddressDisplay.vue`, `Header.vue`, `JsonViewer.vue`, etc.).
  - **Why this location, not `components/composite/`**: per CLAUDE.md `L3` rules, the composite tier is banned from importing `@/utils/core` (and thus `managers.*`). `<ScopeAddress>` needs `managers.contact.getContactByAddress()` for the contact annotation, so it must live in the flat service-bound tier (same as `AddressDisplay.vue`). Codex final-pass §3 confirmed.
  - **Behavior**:
    - Props: `address: string`. (No `formatter`, no `static`, no `full` toggle. Single behavior.)
    - On mount, looks up the address against `managers.contact.getContactByAddress(address)` (same pattern as `AddressDisplay.vue:67-79`). Result is stored in a local `contactName` ref.
    - Renders the raw trimmed address (via `trimAddress`) ALWAYS as the primary text. The contact name renders as a separate parenthetical sibling element ONLY if `contactName` is populated. Never replaces the address; never toggles.
    - Both the raw address string and the contact name pass through `sanitizeWireString(s, 128)` and `sanitizeWireString(name, 32)` respectively before rendering. The contact name is **user-controlled** (the user typed it in their address book), not wallet-controlled — but defensive sanitization protects against pasted bidi-attack strings.
    - Click anywhere on the row writes `props.address` (raw, unmodified) to the clipboard and emits `useToast().openToast({ label: "Address is copied", icon: "copy" })`.
    - `data-testid="scope-address"` on the wrapper; `data-cap-scope-addr={{address}}` for e2e introspection.
  - Storybook story + unit test required (codex final-pass §7).
- **New file: `packages/extension/src/components/ScopeClassId.vue`** (flat tier, same location). Props: `id: string`. Renders `trimAddress(sanitizeWireString(id, 128))` with clipboard-copy on click. **No contact lookup**, **no name annotation**. Storybook + unit test.
- **Modify: `packages/extension/src/utils/tx-enrichment.ts`** (added to Phase 3 scope per codex final-pass §4).
  - Export a new `getMethodLabel(method: string): string | null` helper:
    ```ts
    export function getMethodLabel(method: string): string | null {
      return METHOD_LABELS[method] ?? null
    }
    ```
  - `METHOD_LABELS` stays a const. No new entries. The export gives `CapabilityDetailPanel` a typed, explicit allowlist lookup that returns `null` for unknown methods (NOT a tautological title-cased version).
  - Unit test: a couple of new assertions on `getMethodLabel` (recognized → label, unknown → null).
- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue`
  - **Address rendering (every contracts row, every scope-pattern contract, data.privateEvents contracts)**: replace bare `<Text @click="copyAddress">` with `<ScopeAddress :address="String(addr)" />`. Drop the inline `copyAddress` helper (lines 12–15) — `ScopeAddress` owns clipboard.
  - **contractClasses.classes**: each class ID renders via `<ScopeClassId :id="String(cls)" />`. No contact-lookup path.
  - **Function selectors** (4 occurrences — simulation.transactions, simulation.utilities, transaction, plus shared by existing-grants reuse): rendered as raw method id with friendly annotation:
    ```vue
    <Flex align="center" gap="6">
      <Text size="11" color="tertiary">fn:</Text>
      <Text size="11" weight="600" color="secondary" :class="$style.mono">
        {{ String(p.function) === "*" ? "*" : sanitizeWireString(String(p.function), 64) }}
      </Text>
      <Text v-if="String(p.function) !== '*' && getMethodLabel(String(p.function))" size="11" color="tertiary">
        · {{ getMethodLabel(String(p.function)) }}
      </Text>
    </Flex>
    ```
    `sanitizeWireString` and `getMethodLabel` are imported from `capability-meta.ts` and `tx-enrichment.ts` respectively. Function names that don't match `METHOD_LABELS` show ONLY the sanitized raw — no auto-title-casing.
  - **Sub-row copy**: per the v2 sub-copy table above. Specifically:
    - `accounts` branch: drop the "Permissions:" header **proposal** (codex confirmed it already exists at line 27-29). Add the new "Register tokens (adds an entry to your wallet's local registry)" row as an always-present row beneath the conditional canGet/canCreateAuthWit rows.
    - `transaction` branch: footer line "Each transaction still requires your approval" preserved verbatim (codex confirms this is honest).
    - `data` branch: add the always-present "Register senders (adds an entry to your wallet's local registry for event decryption)" row beneath the conditional addressBook/privateEvents rows.
    - `simulation` branch: header text changes per the table.
  - **Unknown branch** (currently `<template v-else>` at line 270-272): becomes:
    ```vue
    <template v-else>
      <Flex direction="column" gap="6">
        <Text size="12" color="secondary">
          This wallet doesn't recognize this permission. Reject if you don't know what it does.
        </Text>
        <Flex align="center" gap="6">
          <Text size="11" color="tertiary">type:</Text>
          <Text size="11" weight="600" :class="$style.mono">
            {{ sanitizeWireString(String(capability.type), 32) }}
          </Text>
        </Flex>
      </Flex>
    </template>
    ```
    The same `sanitizeWireString` helper from `capability-meta.ts` runs here (with `maxLen=32` for the unknown type discriminator — recognized types max out at 15 chars for `contractClasses`, so 32 is generous).
  - **Visual styling**: tighten `padding` on `.panel` from `10px 12px` to `12px` (matches OperationCard's op_body). The `--nulo-surface-low` background stays.
- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.test.ts`
  - Update for the new copy strings.
  - **Delete** the existing clipboard test (lines 62-69) — moves to `ScopeAddress.test.ts`.
  - Add a test for **`getMethodLabel` lossiness preservation**: render a transaction cap with `function: "transfer_in_private"` and assert BOTH the raw method id AND the friendly annotation render in the DOM (verifying we never show only the friendly label).
  - Add a test for **`contractClasses` class-id rendering**: assert that class IDs are rendered via `<ScopeClassId>`, NOT `<ScopeAddress>`. Use the contact-stub spy from setup to assert it's never called for class IDs.
  - Add a test for **the unknown-capability branch**: provide `{ type: "Weird-cap_NAME — recommended (FAKE)" }`, assert the head copy is the constant "This wallet doesn't recognize this permission. …", assert the raw type is rendered through `sanitizeWireString` (length-clamped, no bidi control chars).
  - Add a test for **sanitizer length-clamp**: 100-char method name → rendered at 64 chars + ellipsis.
- **New: `packages/extension/src/components/ScopeAddress.test.ts`** — covers clipboard wiring, raw-primary rendering, contact-annotation rendering (with stubbed `managers.contact`), `sanitizeWireString` integration on both address + name.
- **New: `packages/extension/src/components/ScopeClassId.test.ts`** — covers clipboard, sanitizer, and explicit absence-of-contact-lookup (the stubbed `managers.contact` spy must not be called).

- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.stories.ts`
  - Add stories for: unknown capability, transaction with humanizable + lossy methods (`transfer_in_private`, `transfer_private_to_private`), contractClasses with multiple IDs, accounts with all 3 flags lit including the new always-on registerToken row.
- **New: `packages/extension/src/components/ScopeAddress.stories.ts`** — stories for: known contact, no contact, sanitizer edge case (bidi-control input).
- **New: `packages/extension/src/components/ScopeClassId.stories.ts`** — stories for: class ID, sanitizer edge case.

**Behavior change:** richer scope decode + sanitization. Trust-relevant invariants:
- Raw method ids always visible.
- Raw addresses always visible (name annotation never replaces).
- Class IDs never auto-resolved.
- Unknown types always rendered through sanitizer.

### Phase 4 — popup-level orchestration, unknown-card default-OFF, headers

**Goal:** popup chrome + unknown-card UX behavior + terminology consistency.

**Files touched:**
- `packages/extension/src/popup/windows/capabilities/index.vue`
  - Section labels (lines 296, 319): "New capabilities requested" → "New permissions requested"; "Already granted" stays.
  - `actionLabel` on `<DappIdentityBlock>` (line 274): "is requesting access to Nulo" → "is requesting permissions".
  - **Unknown-type defaulting in `init()`** (lines 115-127): when building `items` from `delta`, set `selected: false` if `getCapabilityInfo(cap.type)` resolved through the fallback (i.e., the type is not in `CAPABILITY_LABELS`). Recognized types continue to default `selected: true`. The detection signal: `CAPABILITY_LABELS` becomes a const `Set`-able check `isKnownCapability(type)` exported from `capability-meta.ts`.
  - **Unknown-type risk override**: when calling `getCapabilityInfo(cap.type)` for unknown types, the returned `risk: "high"` is the v2 default in the fallback (currently the fallback returns `"medium"`). Already covered by Phase 1's capability-meta change.

- `packages/extension/src/popup/windows/capabilities/CapabilityCard.vue` (revisited from Phase 2)
  - **Head label rendering**: when `getCapabilityInfo(type).label === "Unknown permission"` (we can plumb this via a prop `isUnknown: boolean` from the parent, or by checking the label string — prefer a typed prop), render the head label in `var(--font-mono)` and add a small "UNRECOGNIZED" badge using the same orange-outline mono treatment as the denied badge but with text "UNRECOGNIZED". The current rendering at line 66 just passes `label` through `<Text>`; this branch adds a tag chip next to it.
  - **Selected-state visual when `selected=false` AND `isUnknown=true`**: parent default-OFFs the card; the UI naturally shows the unchecked circle icon (already exists). No additional treatment needed beyond ensuring the checkbox doesn't auto-flip on click-anywhere.

- `packages/extension/src/popup/windows/capabilities/AccountSelectRow.vue` — unchanged (already brutalist with `color="primary"` check).

**New Phase 4 test (required by codex final-pass §7):** add a unit test on the popup's `init()` flow that asserts an unknown-type cap in the delta produces an `items` entry with `selected: false`, while recognized-type caps produce `selected: true`. This is the security-critical default-OFF invariant; covering only the render path (Phase 3) misses the popup-init side of the security property. Test lives at `packages/extension/src/popup/windows/capabilities/index.init.test.ts` (or inline in a new test file if the popup doesn't already have one — currently it doesn't; it's covered by e2e, but a unit test on the default-selection logic is cheap and explicit). Mock `useDappInteractionPayload` to feed a synthetic payload with one known + one unknown capability type in the delta.

**Behavior change:** copy + a new selection default for unknown caps + a head-side UNRECOGNIZED chip. The chip is the head equivalent of the "PREVIOUSLY DENIED" badge — orange border + mono uppercase.

### Phase 5 — settings (connected-apps) terminology + grants list parity

**Goal:** the settings surface inherits the same terminology, same visual treatment, same single label source.

**Files touched:**
- `packages/extension/src/popup/components/modules/settings/connected-apps/GrantedCapabilitiesList.vue`
  - **Check icon** (line 38): `color="green"` → `color="primary"`. Matches the new CapabilityCard checkbox state. Codex confirmed family-wide that "MIXED" or warning states keep orange — this is a *granted* state, mono primary is correct.
  - **Label source**: `getCapabilityLabel` now reads from the lower-layer `capability-meta.ts` (via Phase 0's redirect).
- `packages/extension/src/popup/pages/settings/connected-apps/[id].vue`
  - Line 287 section label: "Granted capabilities" → "Granted permissions".
- `packages/extension/src/popup/pages/settings/connected-apps/index.vue`
  - `GRANT_SHORT_LABELS` map (lines 24-31): deleted (Phase 0 already removed the local map and rerouted `formatGrantSummary` to `getCapabilityInfo(...).shortLabel`).
  - Line text in the per-session row (lines 158-159) — uses `formatGrantSummary` which now reads from one source. No change to the call site itself.

**Behavior change:** visual + copy only.

### Phase 6 — test sweep + smoke + targeted network e2e

**Goal:** the audit:vue gate stays green; the capability + authwit + send-tx e2e tests pass.

**Steps:**
1. `bun run --cwd packages/extension audit:vue` — typecheck + unit + component + lint + build.
2. `bun run --cwd packages/extension test:components`.
3. `bun run --cwd packages/extension test:e2e` — smoke.
4. Network e2e, the codex-expanded set (in this order to fail fast on protocol-touching tests first):
   - `bun run --cwd packages/extension e2e:agent -- cap-request-basic.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- cap-request-accounts.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- cap-request-rerequest.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- cap-request-partial.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- cap-request-repeat-noPopup.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- meta-getAccounts.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- authwit-variants.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- tx-sendTx-feePayer.test.ts`
   - `bun run --cwd packages/extension e2e:agent -- tx-sendTx-noFrom.test.ts`
5. Manual smoke: build unpacked extension, load in Chrome, exercise:
   - Standard `basic` bundle approval — capability popup renders with new copy + glyphs.
   - `transaction` bundle approval — sends still open execute popup, both embedded-fee and non-embedded.
   - `authwit` bundle approval — followed by an authwit call from the playground — confirms it's silent (no popup) per the corrected v2 protocol claim.
   - Reject-then-rerequest — the orange-outlined PREVIOUSLY DENIED badge is visible.
   - Inject an unknown-type cap (via the playground's debug surface OR a manual override) — the UNRECOGNIZED chip + raw-type display + default-OFF state are visible.
6. Storybook: `bun run --cwd packages/extension build-storybook` — confirm new stories render.

## Files NOT touched and why

- `packages/extension/src/components/AddressDisplay.vue` — left alone. The capabilities panel intentionally does NOT use it (per codex's name-preference + clipboard concerns). Other consumers (execute popup, send page, tx detail) continue to use it; that's pre-existing trust surface unchanged here.
- `packages/wallet-bridge/src/dispatcher.ts` — the type-only diff hole is documented but not fixed. Out of scope.
- `packages/wallet-bridge/src/capabilities.ts` — wire types unchanged.
- `packages/wallet-bridge/src/scope-enforcement.ts` — already correct; the popup misrepresents it, not the inverse.
- `packages/extension/src/wallet/services/dapp-interaction/service.ts` — `isConfirmationNeeded` logic unchanged.
- `packages/extension/src/popup/windows/capabilities/AccountSelectRow.vue` — already brutalist.
- `packages/extension/src/utils/tx-enrichment.ts` — TOUCHED by Phase 3 to export `getMethodLabel(method)`. `METHOD_LABELS` const NOT expanded; no new entries.

## Security & Adversarial Considerations (v2)

### Threat model

The capabilities popup is the highest-trust moment in the dApp → wallet handshake. It is a UI surface that the user reads to decide whether to grant a permission set. Every byte the dApp can influence on this surface is part of the threat model:

- **dApp-controlled, displayed in the popup**: `dapp.name`, `dapp.url`, `dapp.logo`, `capability.type` (when unknown), `capability.contracts[]` / `capability.classes[]` / `capability.scope[*]{.contract,.function}` strings, the contract addresses inside `privateEvents.contracts`. ALL OF THESE are wire-controlled.
- **Wallet-controlled**: capability labels and descriptions (Phase 1's table), risk values, the "Each transaction still requires your approval" line, the UNRECOGNIZED chip, the "PREVIOUSLY DENIED" badge.
- **User-controlled, displayed**: contact-book names that annotate addresses (when the user has explicitly named a contact).

### What we're trusting

- The biome layer rules + the `noRestrictedGlobals` ban on `chrome.*` in `wallet-core`.
- `scope-enforcement.ts` rejects out-of-scope calls before they reach the user. The popup does not need to re-enforce — but it does need to honestly *display* what scope is being granted.
- The user's address book is the user's; contact names are theirs.

### What an attacker would try (revised)

1. **Capability-type spoofing (HIGH, mitigated)**. A dApp sends `type: "Read public data only — recommended"` hoping the popup renders the string as a friendly label. v1's UNRECOGNIZED badge alone left this open. v2 mitigations: head label is the constant "Unknown permission"; the dApp string is displayed only inside a sanitizer (length-clamped, bidi/non-printable stripped, mono); the cap card defaults to `selected = false` so the user must explicitly opt in. Codex #1(b) addressed.

2. **Confusables / RTL / bidi attacks on `cap.type`, `function`, `contract` (mitigated)**. `sanitizeMethodId` / `sanitizeUnknownType` strip `‪-‮` and `⁦-⁩` and clamp to 64 / 32 chars. Vue template interpolation HTML-escapes. The class of attack where the dApp displays one string but the wallet enforces another is closed — both go through the same sanitizer at render time.

3. **Function-name confusion (mitigated)**. The lossy `humanizeMethodName` could collapse distinct functions to one friendly label. v2 always renders raw + (optional) annotation; the user verifies against the raw. The `recognizedLabel` returns null for unknown methods, so an attacker can't socially engineer a friendly label by choosing a function name not in `METHOD_LABELS`.

4. **Address-name social-engineering (pre-existing in other popups; mitigated more strictly here)**. The user can name a malicious contract "Aztec Bridge" in their address book, then a dApp can ask for a scope on that contract and the popup would annotate it `(@Aztec Bridge)`. v2 mitigation: raw address is always primary; the annotation is parenthetical and clearly user-controlled (the `@` prefix signals "your local label"). Same as the execute popup's pattern, but stricter — the address is never replaced. Codex #1(c) addressed.

5. **Risk-downgrade attack (impossible)**. `risk` lives in `capability-meta.ts` (wallet-controlled); the wire `Capability` type carries no risk field. Unknown types default to `risk: "high"` in the v2 fallback.

6. **Hidden re-request (mitigated, with caveat)**. The PREVIOUSLY DENIED badge fires for previously-rejected *types*. The badge uses an orange-bordered mono uppercase treatment — louder than v1's pure-mono proposal, consistent with the family's other warning states. Caveat: the badge does **not** fire for scope upgrades to already-granted non-`accounts` types (the dispatcher's type-only diff hole at `dispatcher.ts:431-438`). Documented as out of scope; v2 does not claim coverage we don't deliver.

7. **Unknown-cap persistence escalation (mitigated)**. Codex's concern: if a user mis-approves an unknown cap today, it persists in `DappSession.capabilityGrants`, and a later wallet version that adds support for that type could honor the grant silently. v2 mitigation: default-OFF in the popup means a mis-click is far less likely. A truly determined approval still persists, but the popup makes it hard to grant by accident — which is the achievable property here. Fixing the underlying persistence is out of scope (would need a session-restore guard in `dapp-session/service.ts`, a separate plan).

8. **Layer-rule bypass via the new shared module**. The `dapp-session/capability-meta.ts` location is in the `wallet/services` tier — wallet-services-bound but pure data + functions. Both L4 settings and L6 popup can import from there. The new module MUST stay pure (no `chrome.*`, no service-client construction, no `managers.*` imports) — enforced **by code-review discipline**. Note: biome's `noRestrictedGlobals` ban on `chrome.*` is scoped to the `wallet-core` package only (per `biome.json:60`), NOT to this extension path. So purity is a maintainer-review responsibility, not automated. The contact lookup that `<ScopeAddress>` performs lives in the flat `src/components/ScopeAddress.vue` (per CLAUDE.md `L3` ban on `@/utils/core` in composite — see codex final-pass §3), not in the shared capability-meta module.

### Crypto / supply-chain / least-privilege

- **No crypto changes.**
- **No new dependencies.** All decode helpers are existing in-repo (`trimAddress`, `managers.contact`, etc.). The new helpers (`sanitizeMethodId`, `recognizedLabel`, `contactAnnotation`, `ScopeAddress`, `ScopeClassId`, `riskGlyph`, `riskWord`) are pure local code.
- **No new IPC.** Popup talks to `DappInteractionServiceClient` + `ProfileServiceClient` exactly as today.
- **No new persisted state.** Default-OFF on unknown caps means *fewer* persisted grants, not more.

### Final audit checklist

The audit-codex.md verdict was REWORK on (a) protocol-table errors, (b) layer-rule violation, (c) unsafe AddressDisplay, (d) unsafe unknown-capability path, (e) thin tests. All five are addressed:

| Codex finding | v2 resolution |
|---|---|
| `accounts.canCreateAuthWit` per-op claim wrong | Protocol table corrected; copy reframed as scoped signatures within transaction scope. |
| `simulateViews` bucketed wrong | Protocol table corrected; sub-row copy mentions "and view-calls" under simulation.transactions. |
| Layer violation | Phase 0 extracts metadata to `dapp-session/capability-meta.ts`. |
| AddressDisplay unsafe | Replaced with `ScopeAddress` sub-component — raw primary, name annotation parenthetical, explicit clipboard wiring. contractClasses never routed through it. |
| Unknown-cap unsafe | Fixed "Unknown permission" head label; dApp string sanitized; default-OFF; risk forced HIGH. |
| Tests thin | Phase 6 lists 9 e2e tests including all the codex-suggested ones; unit tests cover sanitizer, lossy-humanize preservation, contractClasses-not-as-address, unknown-branch render. |

## Open questions to surface before final approval

These are NEW or MODIFIED relative to v1's open questions, after both audits:

1. **"Capabilities" → "Permissions" rename scope.** v1 left this ambiguous; v2 commits to renaming popup section headers + settings detail page header (`[id].vue:287`) + DappIdentityBlock `actionLabel`. The wire type `Capability` and the testid string `cap-*` stay (no test churn, no protocol changes). Confirm — or scope back to popup-only?

2. **Unknown-capability default-OFF.** v2 proposes that unrecognized capability types default `selected: false` in the popup (requires deliberate user click). Codex's persistence concern + opus's trust-display concern both supported. Confirm direction?

3. **PREVIOUSLY DENIED badge — orange border + mono.** Both audits agreed pure-mono was too quiet. v2 lands on orange border / mono text / transparent fill. Same treatment for the new UNRECOGNIZED chip. Confirm?

4. **`accounts` head copy when canCreateAuthWit is absent.** v2's description hedges with "May also create scoped signatures..." — the "May" is awkward but the alternative (two descriptions, one per flag combination) is combinatorial. Acceptable, or do we drop the May-clause and rely on the detail panel? (My read: keep the May. The detail panel might not get expanded; the head copy is the only signal the user gets at a glance.)

5. **Risk glyph choices (▲ ● —).** Trivial. The em-dash for LOW might render thin at 10px in mono; codex was fine with it, opus suggested `·`. Confirm `—` (the original pick) or swap for `·`.

6. **`AccessLevel.Transactions(5)` is the max; user can only tighten by lowering.** Documented in the protocol table. The plan's copy assumes default policy; should we add a footnote anywhere about "if you've changed your confirmation policy, more steps may require approval"? My read: no — the policy slider is a power-user setting, the popup's job is the common case.

7. **Code-comment policy for the new sanitizers**. The sanitizers (length-clamp + bidi-strip) are security-critical. CLAUDE.md "code-comment style" says comments explain WHY/invariants. The sanitizer comments will read like:
   > Strip Unicode bidi-control codepoints because dApp-controlled `cap.type` is rendered in the popup head and can be used to spoof labels (e.g. RTL-flip "high" into "low"). 32-char clamp aligns with the longest legitimate capability type ("contractClasses", 15 chars) + headroom.
   
   Confirm the comment style is the right level of detail?

## Validation gates — final

| Gate | Command | Required? |
|---|---|---|
| Unit + component | `bun run --cwd packages/extension test` | ✓ |
| Lint (layer rules + biome) | `bun run --cwd packages/extension lint` | ✓ (catches Phase 0 misimports) |
| Typecheck | `bun run --cwd packages/extension typecheck:all` | ✓ |
| Pre-PR meta-gate | `bun run --cwd packages/extension audit:vue` | ✓ |
| Smoke e2e | `bun run --cwd packages/extension test:e2e` | ✓ |
| Network e2e set (9 tests) | per Phase 6 list | ✓ |
| Manual smoke | per Phase 6 step 5 | ✓ |
| Storybook | `bun run --cwd packages/extension build-storybook` | ✓ |

## Rollback plan

Same as v1:

- **Visual regression only** — revert the squash commit; underlying data flow unchanged.
- **e2e regression** — fails at PR time; CI blocks.
- **Copy regression** — incremental follow-up PR.
- No protocol / storage / KDF changes — no migration risk.

## Lesson tracking

Per CLAUDE.md, log meaningful attempts in `implementations-plan/capabilities-popup-quality/lessons/phase-N.md` and pause after 3 failures on the same step. Likely lesson categories:

- **Phase 0**: the biome layer-import override may need a config tweak for the new path. Catch via `bun run lint` early.
- **Phase 3**: `contactAnnotation` is `async` (the contact lookup is via `managers.contact`); rendering inside a Vue template needs a computed/ref pattern (see `AddressDisplay.vue:67-79` for the existing onMounted-driven pattern).
- **Phase 4**: the `isUnknown` plumbing from index.vue → CapabilityCard adds a new prop; need to update tests + storybook to cover both states.
- **Phase 6**: `tx-sendTx-noFrom` is the slowest of the new e2e set; allocate budget.

## Out of scope (v2-finalized)

- Renaming the wire-type `Capability` → `Permission`. Cross-cutting protocol change.
- The type-only diff hole for non-`accounts` capability widening. Filed as `wallet-sdk-capability-field-diff`.
- Fixing the unknown-capability persistence at the session-restore layer (would need a `dapp-session/service.ts` guard to reject inert grants on session restore).
- Per-flag granular toggle in the popup (let the user accept canGet but reject canCreateAuthWit within the same `accounts` capability). Protocol-level change.
- Adding `<JsonViewer>` to the unknown branch. User rejected explicitly in v1.
- Touching `verify/index.vue`'s `color="orange"` for the suspicious-hostname warning — different popup, scoped to its own decision.

---

## User decisions (recorded at approval gate)

Locked in by the user before implementation began:

1. **"Capabilities" → "Permissions" rename scope**: **confirm everywhere** — full rename across popup section headers, DappIdentityBlock action label, settings detail page header, settings list summary. Internal type names (`Capability`) and testids (`cap-*`) stay.
2. **Default-OFF on unrecognized capability cards**: **confirmed**.
3. **Orange-border PREVIOUSLY DENIED / UNRECOGNIZED**: **confirmed** (mono uppercase, transparent fill, 1px `--orange` border).
4. **"May" hedge in the accounts head description**: **keep**. Phrase stays "May also request auth witnesses for shared accounts."
5. **Risk glyph for LOW**: **em-dash `—`** (user's original pick — `·` rejected).
6. **No confirmation-policy footnote in the popup**: **confirmed**. Settings is the right surface for that explanation.
