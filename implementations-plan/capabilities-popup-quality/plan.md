# Capabilities popup — quality + brutalist + honest-copy pass

**Status:** plan v1 — pre-audit. Awaiting codex + opus dual review.
**Tier:** B (UI-only, contained surface, dual audit).
**Branch target:** new branch `feat/capabilities-popup-quality` cut from `dev`.
**Severity:** UX + trust. The popup is the moment a user agrees to a dApp's permission set — the misleading "submit transactions on your behalf" copy is a phishing-adjacent risk, and the saturated colors break the brutalist visual contract that the rest of the popup family (`execute/`, `verify/`, `discover/`) holds.

## TL;DR

Three problems to fix in one pass:

1. **Honesty.** `capability-meta.ts` says `transaction → "Submit transactions to the network on your behalf"` (label) and the detail panel below says "Each transaction still requires your approval". The label is wrong: capabilities are **gates on what a dApp may REQUEST**, not blanket authority. The `isConfirmationNeeded` path in `dapp-interaction/service.ts:345` and the `assertSilentExecutable` branch in `materialize.ts:139` are what *actually* decide whether a per-op popup is shown — the capability merely sets the scope inside which requests are allowed at all.
2. **Visual coherence.** The popup paints red/yellow/green risk chips, green check-circle checkboxes, and a saturated orange "previously denied" badge. The sibling popups (`execute/index.vue`, `OperationCard.vue`, `verify/index.vue`) are mono — borders, surfaces, mono typography, single tiny green check-circle as a callout. Capabilities is the loudest popup in the family.
3. **Decode depth.** The detail panel renders contract addresses as raw clickable text and function selectors as bare strings (`{{ String(p.function) }}`). The execute popup uses `<AddressDisplay>` (which resolves to contact-book names) and `humanizeMethodName()` (which maps Aztec method names to friendly labels). Bringing the capabilities detail panel to parity is a meaningful information upgrade for the user *and* costs almost no new code — both helpers are already auto-imported.

User's chosen direction (clarifying-question answers):
- **Scope** — popup + shared `CapabilityDetailPanel` + `GrantedCapabilitiesList` settings row. All three surfaces aligned.
- **Copy** — permission-to-REQUEST framing across the board. Every label re-cast as "Allow this app to request X" with a follow-up sentence clarifying whether each request triggers a per-op approval popup (`transaction`, `accounts.canCreateAuthWit`) or runs silently (`simulation`, `data.addressBook`, contract reads).
- **Risk visual** — mono glyph + uppercase token (`▲ HIGH` / `● MED` / `— LOW`) in `--font-mono` at `--txt-secondary`. No semantic color.
- **Decode** — match execute-popup parity. `<AddressDisplay>` for all contract addresses, `humanizeMethodName()` for all function selectors.

## What capabilities actually are (research summary)

This section exists so future readers (and the audit agents) can pressure-test the copy without re-deriving the protocol.

A `Capability` (`packages/wallet-bridge/src/capabilities.ts:53`) is a tagged-union record stored on the `DappSession` (`packages/extension/src/wallet/services/dapp-session/spec.ts:50`) after the user approves it in the capabilities popup. The dispatcher (`packages/wallet-bridge/src/dispatcher.ts:431`) computes:

- `delta` — capabilities the dApp asked for that the session does not yet carry (or that were previously rejected, surfaced via `reRequested`).
- `existingGrants` — capabilities already on the session.
- `availableAccounts` — pre-fetched per the active profile + chain, only when `accounts` is in the delta.

The popup shows the delta as approve-or-reject cards, the existing grants as read-only context, and (when needed) an account picker for the `accounts` capability. On approve, the popup returns `granted: Capability[] + selectedAccounts? + accountAliases?`.

**Critical to honest copy:** once a capability is granted, the dApp is *allowed to ask* for the operations it gates. Whether each subsequent operation triggers a per-op popup is decided by:

1. `isConfirmationNeeded` (`packages/extension/src/wallet/services/dapp-interaction/service.ts:345`) — gates by `AccessLevel` vs `session.confirmationLevel` plus the special-case for `send_transaction`/`aztec_sendTx` lacking an embedded `feePayer`.
2. `scope-enforcement.ts` — rejects operations that fall outside the granted capability's `scope` patterns before they can reach a popup.

So:

| Capability | Operation kinds it gates | Per-op approval? |
|---|---|---|
| `accounts.canGet` | `aztec_getCompleteAddress` etc. | Silent (`AccessLevel.PublicData`). |
| `accounts.canCreateAuthWit` | `aztec_createAuthWit` | **Per-op popup.** `AccessLevel.PrivateData` ≥ default `confirmationLevel`. |
| `contracts.canRegister` | `aztec_registerContract`, `register_contract` | Silent in default session (PxeState). |
| `contracts.canGetMetadata` | `aztec_getContractMetadata` | Silent. |
| `contractClasses.canGetMetadata` | `aztec_getContractClassMetadata` | Silent. |
| `simulation.transactions.scope` | `aztec_simulateTx`, `aztec_profileTx`, `simulate_transaction` | Silent (PrivateData but no fee path). |
| `simulation.utilities.scope` | `aztec_executeUtility`, `simulate_utility`, `simulate_views` | Silent. |
| `transaction.scope` | `aztec_sendTx`, `send_transaction` | **Per-op popup.** Always — both the AccessLevel check and the `feePayer === undefined` short-circuit at `service.ts:357` force confirmation. |
| `data.addressBook` | `aztec_getAddressBook` | Silent (`AccessLevel.AppState` ≤ default). |
| `data.privateEvents` | `aztec_getPrivateEvents` | Silent. |

The "Per-op approval?" column is what the popup copy needs to faithfully reflect. The current "Submit transactions to the network on your behalf" copy is wrong in two ways — it implies blanket authority (no per-op approval) and it omits the scope constraint.

## Final copy table (proposed)

`capability-meta.ts` becomes the single source of truth for both the popup AND the settings list. Today `connected-app-helpers.ts:5-12` duplicates the labels. Phase 1 collapses both to one map.

| Type | Head label | Head description |
|---|---|---|
| `accounts` | Account access | Read your account addresses and request signatures. Each signature still requires your approval. |
| `contracts` | Contract registration | Register and read contract metadata on this network. |
| `contractClasses` | Contract class lookup | Read contract class metadata on this network. |
| `simulation` | Transaction simulation | Run simulations locally. Nothing is sent to the network. |
| `transaction` | Send transactions | Request transactions within the scope below. Each transaction still requires your approval. |
| `data` | Private data | Read your address book and private notes/events. |

Notes:

- The "Each X still requires your approval" line is appended ONLY to `transaction` and (conditionally) `accounts` — namely, the two gates that actually trigger per-op popups. The other types are silent post-grant and the copy reflects that.
- The `accounts` head folds two sub-permissions (canGet, canCreateAuthWit). The detail panel (Phase 3) decodes which of the two are present; the head is generic. Trying to encode "view-only" vs "view + sign" in the head was rejected (combinatorial copy + no real win when the detail panel already covers it).
- "Send transactions" is kept as the head verb because it's the literal wire name (`transaction` capability). The description (`Request transactions within the scope below`) carries the truth.

### Detail-panel sub-copy (per-permission rows)

| Capability + flag | Current row text | New row text |
|---|---|---|
| `accounts.canGet` | "View accounts" | "Read your account addresses" |
| `accounts.canCreateAuthWit` | "Create auth witnesses" | "Request signatures (you approve each one)" |
| `contracts.canRegister` | "Register contracts" | "Register contracts" (unchanged — silent action; verb is correct) |
| `contracts.canGetMetadata` | "Read contract metadata" | "Read contract metadata" (unchanged) |
| `contractClasses.canGetMetadata` | "Read class metadata" | "Read class metadata" (unchanged) |
| `simulation.transactions` | "Transaction simulation: …" | "Simulate transactions in scope:" |
| `simulation.utilities` | "Utility simulation: …" | "Simulate utilities in scope:" |
| `transaction.scope` | "Scope: …" + "Each transaction still requires your approval" | "Allowed transactions:" + "Each transaction still requires your approval" (line preserved verbatim — it's load-bearing) |
| `data.addressBook` | "Address book access" | "Read address book" |
| `data.privateEvents.contracts` | "Private events: …" + scope rows | "Read private events from:" + scope rows |

### Unknown capability fallback

Today: `getCapabilityInfo(unknown)` returns `{ label: type, description: "Capability: type", risk: "medium" }` and the detail panel says "No details available".

Proposed: head displays the raw `cap.type` in mono + an "UNRECOGNIZED" badge (same brutalist treatment as the re-requested badge). Detail panel renders a single line: `This wallet doesn't recognize this permission. Reject if you're unsure.` No JSON viewer (user picked "match execute parity" not "parity + JSON fallback" — but we DO surface the unknown-ness loudly because hiding it is a trust risk).

## Phases

### Phase 1 — capability metadata + copy unification

**Goal:** the copy table above lands; capability-meta.ts becomes the single source of truth.

**Files touched:**
- `packages/extension/src/popup/windows/capabilities/capability-meta.ts` — rewrite the `CAPABILITY_LABELS` map per the table above.
- `packages/extension/src/popup/components/modules/settings/connected-apps/connected-app-helpers.ts` — delete the duplicated `CAPABILITY_LABELS` map; reroute `getCapabilityLabel(type)` to call `getCapabilityInfo(type).label` from `capability-meta.ts`. (The settings file uses a shorter "Share accounts" label today; the unification step moves it to the same source. Phase 5 will validate the settings page still reads cleanly.)
- `packages/extension/src/popup/windows/capabilities/capability-meta.test.ts` — update the assertions in `test("known types return their canonical label + risk")` to the new strings. Add a test that `getCapabilityInfo("transaction").description` mentions "still requires your approval" — that line is load-bearing and we don't want it lost in a future copy edit.

**Behavior change:** label/description text only. No structural changes; `risk` values stay the same.

**Validation:** `bun run --cwd packages/extension test:unit capability-meta.test.ts`.

### Phase 2 — risk visual + brutalist normalization

**Goal:** drop the semantic colors; bring the popup in line with the rest of the family.

**Files touched:**
- `packages/extension/src/popup/windows/capabilities/CapabilityCard.vue`
  - **Risk chip** (lines 72–78): replace the `<Text :color="risk === 'high' ? 'red' : ...">` with a mono span pattern. Concrete:
    ```vue
    <span :class="$style.risk_tag" :data-cap-risk="risk">
      <span :class="$style.risk_glyph">{{ risk === 'high' ? '▲' : risk === 'medium' ? '●' : '—' }}</span>
      {{ risk === 'medium' ? 'MED' : risk.toUpperCase() }}
    </span>
    ```
    The new CSS (added to the `<style module>` block):
    ```css
    .risk_tag {
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: var(--nulo-secondary);
      white-space: nowrap;
    }
    .risk_glyph { padding-right: 4px; }
    ```
    A `data-cap-risk` attribute is added so e2e/snapshot tests can still assert on risk level without grepping color tokens. Preserves accessibility (text is still text).
  - **Checkbox icon** (lines 59–60): change `color="green"` → `color="primary"` for the checked state. The unchecked `color="secondary"` stays. This brings the checkbox in line with `AccountSelectRow.vue:39-42`.
  - **Granted variant head** (lines 95): the static `<Icon name="check-circle" size="16" color="tertiary" />` already uses `tertiary` — no change.
  - **`denied_badge`** (lines 167–177): rewrite as a mono uppercase tag with a thin border, no saturated fill:
    ```css
    .denied_badge {
      padding: 2px 6px;
      border: 1px solid var(--nulo-border);
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--nulo-secondary);
      white-space: nowrap;
    }
    ```
    Note: the badge stays prominent — it's a critical security signal that the user previously rejected this exact capability and the dApp is asking again. The visual change just removes the saturated orange in favor of a brutalist mono tag.
- `packages/extension/src/popup/windows/capabilities/CapabilityCard.test.ts`
  - The current assertion `expect(w.text()).toContain("low")` (line 53) needs to become `expect(w.text()).toContain("LOW")` — the new uppercase render. Confirm via the `data-cap-risk` attribute as the authoritative selector: add a test `expect(w.find('[data-cap-risk]').attributes('data-cap-risk')).toBe('low')`.
  - All other testids (`cap-item`, `cap-toggle`, `cap-detail-toggle`, `cap-rerequested-badge`) preserved verbatim — they are load-bearing for e2e fixtures (`packages/extension/tests/e2e/fixtures/popups.ts:157-200`).

**Behavior change:** visual only. No prop API change. The risk signal is still rendered, just in mono.

**Validation:** `bun run --cwd packages/extension test:unit CapabilityCard.test.ts` + visual smoke via Storybook (a story exists at `CapabilityDetailPanel.stories.ts`; we'll spot-check the card in the popup at runtime).

### Phase 3 — detail panel decode parity with execute popup

**Goal:** `<AddressDisplay>` + `humanizeMethodName` everywhere the execute popup uses them. Brutalist visual polish to match `OperationCard.vue`.

**Files touched:**
- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue`
  - **Contract addresses**: every `<Text @click="copyAddress(...)" :class="$style.copyable">{{ String(addr) }}</Text>` row (8 occurrences) is replaced with `<AddressDisplay :address="String(addr)" />`. The hand-rolled `copyAddress` helper (lines 12–15) is removed — `AddressDisplay` already handles clipboard copy via its own UI (and resolves to a contact-book name when one exists).
  - **Function selectors**: every `{{ String(p.function) === "*" ? "any function" : p.function }}` row becomes `{{ p.function === "*" ? "any function" : humanizeMethodName(String(p.function)) }}`. `humanizeMethodName` is auto-imported globally (see `types/auto-imports.d.ts:59`); no explicit import.
  - **Sub-row copy**: apply the table from the "Detail-panel sub-copy" section above. The "Each transaction still requires your approval" footer on the transaction branch (lines 222–224) is preserved verbatim — it's the security-relevant invariant string and we want to keep the existing reference intact.
  - **Permission grouping**: the `accounts` branch currently renders the two flag rows without a header (lines 27–39). Add a `<Text size="12" weight="600" color="secondary">Permissions:</Text>` header above them, matching the other branches' "Scope:" / "Permissions:" headers for visual rhythm.
  - **Unknown branch** (lines 270–272): replace "No details available" with `This wallet doesn't recognize this permission. Reject if you're unsure.` (+ render the raw `cap.type` in mono just above for trust transparency).
  - **Visual styling**: tighten `padding` on `.panel` from `10px 12px` to `12px` to match `OperationCard.vue`'s `op_body` rhythm. The `--nulo-surface-low` background stays.
- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.test.ts`
  - Update assertions for the new sub-row copy. `expect(w.text()).toContain("View accounts")` → `expect(w.text()).toContain("Read your account addresses")`. Add coverage for the new `accounts` "Permissions:" header.
  - Replace the clipboard test (lines 62–68) — the new `AddressDisplay` component handles clipboard internally, so the test asserts that `<AddressDisplay>` was mounted with the correct `address` prop instead.
  - Add a test for the unknown-capability branch: asserts the new copy + the raw `cap.type` is rendered.
  - Add a test for `humanizeMethodName` integration on a `transaction` capability with a non-wildcard scope.
- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.stories.ts` — add a story for the unknown-capability branch + a transaction branch with a real method name like `transfer_in_private` so reviewers can eyeball the humanize behavior.

**Behavior change:** visual, plus the contact-book name resolution surfaces for the first time in the capability detail panel. The dApp scope is unchanged — the resolution is a display-only lookup against the user's local address book.

**Validation:** `bun run --cwd packages/extension test:unit CapabilityDetailPanel.test.ts` + Storybook build.

### Phase 4 — popup-level orchestration polish

**Goal:** section headers + popup chrome aligned to the new framing.

**Files touched:**
- `packages/extension/src/popup/windows/capabilities/index.vue`
  - Section labels (lines 296, 319): "New capabilities requested" → "New permissions requested"; "Already granted" stays.
  - The account-selector section label (line 279) stays "Select accounts to share" — it's already correct.
  - `actionLabel` on `<DappIdentityBlock>` (line 274): "is requesting access to Nulo" → "is requesting permissions". Tighter + matches the new framing.
  - The wrapper / scroll_area / sections / footer styles (lines 379–408) are already brutalist (single border-top accent, no rounded corners, mono surfaces). No change.
  - **No** structural reorganization — the existing flow (status strip → identity block → account picker → new caps → existing grants → footer) reads well; only copy lands here.
- `packages/extension/src/popup/windows/capabilities/AccountSelectRow.vue`
  - **No semantic-color cleanup needed** — already uses `color="primary"` for the selected check (line 39). The component is already brutalist. Re-confirmed during audit.
- `packages/extension/src/popup/windows/capabilities/AccountSelectRow.test.ts` — unchanged.

**Behavior change:** copy only.

**Validation:** unit tests covered by capability-meta tests; the popup's own tests stay (it has none — orchestration is covered by e2e `cap-request-basic.test.ts`).

### Phase 5 — settings (`connected-apps`) grants list parity

**Goal:** the settings view that re-uses the shared detail panel inherits the new look automatically; the wrapping list row gets the same brutalist normalization.

**Files touched:**
- `packages/extension/src/popup/components/modules/settings/connected-apps/GrantedCapabilitiesList.vue`
  - **Check icon** (line 38): `color="green"` → `color="primary"`. Matches the new CapabilityCard checkbox.
  - **Label source**: `getCapabilityLabel` now reads from `capability-meta.ts` (via Phase 1's redirect), so the row text inherits the new "Account access" / "Send transactions" / etc.
  - **Visual**: the `grant_header` already uses `--nulo-surface-high` hover + `--nulo-border` outline — no change.
- `packages/extension/src/popup/pages/settings/connected-apps/[id].vue` — no change. It just renders `<GrantedCapabilitiesList>`.

**Behavior change:** visual only.

**Validation:** manual smoke through the connected-apps page (open the popup, navigate to a connected dApp's detail page, expand a grant card, verify the new copy + decode renders).

### Phase 6 — test sweep + smoke

**Goal:** the audit:vue gate stays green; capability e2e doesn't regress.

**Files touched:** (none — this is a validation phase)

**Steps:**
1. `bun run --cwd packages/extension audit:vue` — typecheck + unit/component tests + lint + build.
2. `bun run --cwd packages/extension test:components` — focused component-test run, exercises Phase 2/3/5 changes.
3. `bun run --cwd packages/extension test:e2e` — smoke (no Aztec sandbox needed for the unit pieces).
4. `bun run --cwd packages/extension e2e:agent -- cap-request-basic.test.ts` — the one capability network e2e test. Confirms `getCapItems` still resolves and `approveCapabilities` still clicks `cap-approve-btn`. Both selectors are unchanged.
5. Manual smoke (per repo convention for UI changes): build the unpacked extension, load it in Chrome, run the playground site's `requestCapabilities` flow with the `basic` and `everything` bundles, eyeball the popup at each of the six capability types. Test the re-request flow by rejecting once then re-requesting (the "PREVIOUSLY DENIED" badge should be visible).

**Validation gate:** all four runs pass; the audit:vue gate is also the pre-PR gate per CLAUDE.md.

## Files that are NOT touched (and why)

- `packages/extension/src/popup/windows/capabilities/AccountSelectRow.vue` — already brutalist + uses `color="primary"` for the selected check. Inspected; no work needed.
- `packages/extension/src/wallet/services/dapp-interaction/*` — service layer is correct; the popup misrepresents what it does, not vice versa. We do NOT change `isConfirmationNeeded`, `assertSilentExecutable`, or the dispatcher's delta computation.
- `packages/wallet-bridge/src/capabilities.ts` — the wire types are correct. Adding fields would be a protocol change, out of scope.
- `packages/extension/src/popup/windows/capabilities/index.vue` structural flow — the orchestration (DappStatusStrip → identity → account picker → new cards → existing grants → footer) is the right shape. Only copy moves.
- The `<DappCancelledOverlay>` integration — already shared with the execute popup, no work.
- `humanize.ts` in `execute/` — not moved. The execute popup uses `humanizeOperationKind` (operation-kind-level, e.g., `aztec_sendTx` → `Send tx`) and we use `humanizeMethodName` (method-name-level, from `tx-enrichment.ts`). They're different concerns; the capabilities work imports `humanizeMethodName` only.

## Security & Adversarial Considerations

The capabilities popup is the highest-trust moment in the dApp → wallet handshake. The user is committing to a permission set that the dispatcher will then enforce via `scope-enforcement.ts` for the lifetime of the session. Every UI choice here has a trust dimension.

### What we're trusting (and the threat model)

- **The dApp's manifest content is arbitrary.** Name, URL, logo — all attacker-controlled. The popup already mitigates this via `useDappHostname`'s suspicious-chars detection (renders the hostname as suspicious when non-ASCII appears). We don't change that path.
- **Capability `type` field is wire-controlled.** A dApp could send an unrecognized type (typo / version mismatch / deliberate camouflage). Today the popup silently falls back to `{ label: type, description: "Capability: type" }`. Phase 3 hardens this: the unknown branch now displays the raw `cap.type` + an `UNRECOGNIZED` badge so the user cannot mistake an unknown permission for a known-safe one.
- **`Scope` content is wire-controlled.** `transaction.scope` and `simulation.{transactions,utilities}.scope` can be `ScopePattern[]` where each pattern has `contract: string` and `function: string`. We pass these through `humanizeMethodName` (display-only — see below) and `<AddressDisplay>` (display-only — see below).

### What an attacker would try

1. **Capability-type spoofing.** Send a capability with `type: "transactions"` (note the 's') hoping the popup renders a generic-looking card while the dispatcher rejects later. → **Mitigation:** the new unknown-branch UI is loud and dissuades approval. The dispatcher already rejects unrecognized types at `scope-enforcement.ts`, so the popup's worst case is a user clicking Approve on an unknown type → the session gets a no-op grant that never authorizes anything.
2. **Function-name social engineering.** A dApp puts `function: "safe_transfer"` (looks innocuous) in the scope while the underlying selector resolves to a token-draining function. `humanizeMethodName` already collapses unknown method names to title-cased text and truncates hex selectors. It cannot be tricked into displaying a known-friendly name for an arbitrary input (the `METHOD_LABELS` map at `tx-enrichment.ts:46` is closed — it only knows ABI-published Aztec methods; everything else flows through deterministic title-casing). → **Decision:** no extra mitigation needed. The display string is a 1:1 transform of the wire value plus a closed allowlist of friendly aliases.
3. **Address-name social engineering.** A dApp sends `contract: "0x<attacker-address>"` and the user has previously added that address to their contact book under a misleading name like "Aztec Bridge". `<AddressDisplay>` would then show "Aztec Bridge" instead of the raw address. → **This is pre-existing behavior** — the same risk applies in the execute popup. The user owns the address book; we trust their own labels. **No change to address-book behavior.** We do, however, ensure the underlying address is still clickable / copyable so users can verify (existing AddressDisplay behavior).
4. **Risk-label downgrade attack.** The `risk` field on `CapabilityInfo` is wallet-side (declared in `capability-meta.ts`), not dApp-side. A dApp cannot influence the risk text — it's hard-coded per capability type. → **Mitigation:** already inherent to the design. We preserve this property (the new mono `▲ HIGH` etc. is still wallet-controlled).
5. **Hidden re-request.** A dApp keeps re-requesting a denied capability hoping the user will mis-click Approve. The "PREVIOUSLY DENIED" badge is the user's signal that this is a re-attempt. → **Mitigation:** Phase 2 preserves the badge prominently — we change only the color treatment, not the rendering condition (`reRequested` prop, line 67 of the existing `CapabilityCard.vue`). The new mono treatment is *more* readable on the popup background than the saturated orange (which competes with the dark `--nulo-bg`).

### Crypto / supply-chain / least-privilege checks

- **No crypto changes.** Nothing in this plan touches signing, key derivation, KDF, or any randomness path.
- **No new dependencies.** `humanizeMethodName` + `AddressDisplay` are existing in-repo helpers. No package adds.
- **No new IPC surfaces.** The popup talks to `DappInteractionServiceClient` and `ProfileServiceClient` exactly as it does today. We don't introduce new methods, events, or storage keys.
- **No permission escalation in the popup.** The popup never grants a capability the dApp didn't request; the `granted` array on resolve is filtered from `delta` + `existingGrants` only. Phase 4's copy changes don't touch the `approve` handler.

### Audit asks (must be in the codex + opus audit prompts)

> What could go wrong here? What would an attacker target?
> 1. Can any of the copy changes mask a security-relevant signal?
> 2. Can the unknown-branch UI be used to disguise a high-impact capability?
> 3. Does the `<AddressDisplay>` integration introduce any new trust surface vs. the hand-rolled clickable text it replaces?
> 4. Are there any e2e selectors or testids that the brutalist visual rewrite breaks?
> 5. Is the "previously denied" badge still readable at a glance after the color change?

## Open questions (flag for user before approval)

1. **"Permissions" vs "Capabilities" in user-facing copy.** The protocol uses "capability"; we propose "permission" in the section header and identity block (Phase 4). Cleaner / friendlier. The internal `Capability` type / docs / testids stay "capability". **Recommendation:** rename only the user-facing strings, keep the type names. Confirm.
2. **Risk glyph picks.** The user chose `▲ ● —`. The `—` for LOW reads as a dash; a `·` (middle dot) might be quieter / more visually consistent with the `●` (which is also a dot family). Trivial swap if desired.
3. **Unknown-branch JSON viewer.** The user explicitly picked "match execute parity, no JSON". Confirming the new design (UNRECOGNIZED tag + "reject if unsure" copy + raw `cap.type`) is enough — we do NOT add a JSON viewer.
4. **The `accounts.canCreateAuthWit` framing.** Today the detail panel says "Create auth witnesses" — wallet terminology. We propose "Request signatures (you approve each one)". User-friendlier, but loses the "auth witness" wallet-domain term. Alternatives: keep the wallet term + an explainer line, or just go with the simpler copy. **Recommendation:** "Request signatures (you approve each one)" — the wallet term is decorative for end users.

## Validation gates (final)

| Gate | Command | Required? |
|---|---|---|
| Unit + component | `bun run --cwd packages/extension test` | ✓ |
| Lint | `bun run --cwd packages/extension lint` | ✓ |
| Typecheck | `bun run --cwd packages/extension typecheck:all` | ✓ |
| Build | `bun run --cwd packages/extension build` | ✓ (subsumed by audit:vue) |
| Pre-PR meta-gate | `bun run --cwd packages/extension audit:vue` | ✓ |
| Smoke e2e | `bun run --cwd packages/extension test:e2e` | ✓ — popup touched |
| Network e2e (cap-request-basic) | `bun run --cwd packages/extension e2e:agent -- cap-request-basic.test.ts` | ✓ |
| Manual smoke | playground bundle approval flow | ✓ |
| Storybook | `bun run --cwd packages/extension build-storybook` | ✓ — stories edited |

## Rollback plan

The work is contained in one feature branch + one squash-merge PR into `dev`. If a regression is found post-merge:

1. **Visual regression only** — revert the squash commit on `dev` via a follow-up PR; the underlying capability data flow is unchanged.
2. **e2e regression** — `cap-request-basic.test.ts` would fail at PR time, blocking merge. If it slips through (e.g., changes to the playground fixture), revert the squash commit; testids are preserved so the test should pass on the revert.
3. **Copy mistake** — incremental follow-up PR with the corrected string. No data migration needed.

No storage version bump, no protocol change, no key derivation change → no migration concern.

## Lesson tracking

Per CLAUDE.md, log meaningful attempts in `implementations-plan/capabilities-popup-quality/lessons/phase-N.md`. After 3 failures on the same step → stop and reassess.

Likely lesson categories during implementation:

- Phase 2 — the mono glyph rendering might need font-feature-settings tweaks if `▲` / `●` come out at different optical sizes in `var(--font-mono)`. Stretch goal: verify on the actual font (`packages/extension/src/assets/fonts/`).
- Phase 3 — the `<AddressDisplay>` integration assumes the address string is a hex Aztec address; the existing detail panel renders capability addresses as `String(addr)` which may or may not match. Worth confirming the wire-side string format before swap.
- Phase 4 — section-label string changes might break unit tests we don't anticipate; the dispatcher tests grep on capability type names, not section labels, so we expect them to be unaffected — but verify.

## Out of scope

- Renaming the wire-type `Capability` to `Permission`. Cross-cutting wire change, separate plan.
- Per-capability granular toggle UI (e.g., let the user accept `accounts.canGet` but reject `accounts.canCreateAuthWit` within the same capability). The wire protocol's `delta` is per-capability not per-flag; field-diffing is filed separately as `wallet-sdk-capability-field-diff` (see `dispatcher.ts:430`).
- Adding a JSON viewer for the unknown-capability branch. User explicitly rejected.
- Changing the colored "high" / "medium" / "low" `risk` enum values in `capability-meta.ts`. The enum stays — the visual treatment changes. A future plan could remove the enum entirely once we're confident the copy alone carries the signal.
- Touching `verify/index.vue`'s `color="orange"` for the suspicious-hostname warning (line 202). That's a different popup, scoped to its own brutalist + signal trade-off, and a saturated color there is load-bearing for a single high-stakes warning.
