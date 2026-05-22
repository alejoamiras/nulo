# Codex audit — capabilities-popup-quality plan

Codex CLI at `xhigh` reasoning effort, read-only sandbox. Session id `019e4c65-efec-7763-8798-7d97857b9456` (transcript at the conversation's CODEX_DIR). Verdict: **REWORK**.

Codex was asked the same 7-question battery as the opus subagent + an adversarial pass. Where the two audits disagree, codex was verified against the code and proved correct on every contested point (see "Reviewer's verification" at the bottom).

## Codex response (verbatim)

### 1. Adversarial / security pass

`(a)` Yes. The plan can hide security-relevant detail if it replaces exact scope method ids with `humanizeMethodName()` only: that function is lossy and attacker-controlled, and it collapses distinct methods to the same label (`transfer`, `transfer_in_private`, `transfer_private_to_private` all normalize aggressively). Keep the raw method id visible next to any friendly label.
- `implementations-plan/capabilities-popup-quality/plan.md:168-170`
- `packages/extension/src/utils/tx-enrichment.ts:11-27, 46-59`

`(b)` The unknown-capability branch is not safe enough as written: raw `cap.type` is still vulnerable to confusables/bidi spoofing, and approved unknown grants are persisted, so a later wallet version could start honoring them without a fresh consent step. Safer: fixed `Unknown permission` label, escaped/raw machine string, and reject/default-off instead of persisting it.
- `implementations-plan/capabilities-popup-quality/plan.md:90-95, 251-257`
- `packages/extension/src/popup/windows/capabilities/capability-meta.ts:47-48`
- `packages/wallet-bridge/src/dispatcher.ts:536-542, 627-640`
- `packages/extension/src/wallet/services/dapp-session/service.ts:234-240`

`(c)` `<AddressDisplay>` is not a safe drop-in: it prefers local contact/account names over the raw address by default, and it does not copy to clipboard unless you wire `@onAddressClick` yourself. It is also wrong for `contractClasses.classes`, which are class IDs, not addresses.
- `implementations-plan/capabilities-popup-quality/plan.md:168-170`
- `packages/extension/src/components/AddressDisplay.vue:52-65, 67-79, 95-104`
- `packages/wallet-bridge/src/capabilities.ts:30-34`
- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:84-108`

`(d)` The mono `PREVIOUSLY DENIED` badge is too quiet. Other high-stakes warning states keep a targeted orange accent.
- `implementations-plan/capabilities-popup-quality/plan.md:140-154`
- `packages/extension/src/popup/windows/execute/SignerIdentityStrip.vue:28-32, 92-95`
- `packages/extension/src/popup/windows/verify/index.vue:199-206`

`(e)` The missed least-privilege issue is the existing type-only diff hole: non-`accounts` capability widening can skip the popup and re-request badge entirely. The plan can leave that out of scope, but it should not imply the badge covers those upgrades.
- `packages/wallet-bridge/src/dispatcher.ts:423-438, 440`

### 2. Correctness of the protocol summary

The core model is right: capabilities gate what a dApp may request; popup-vs-silent is owned by `isConfirmationNeeded()` plus scope enforcement.
- `packages/extension/src/wallet/services/dapp-interaction/service.ts:345-363`
- `packages/wallet-bridge/src/scope-enforcement.ts:316-320`

The table is still materially wrong in two places.

- `accounts.canCreateAuthWit` is **silent** on the default session policy, **not** per-op popup: new sessions start at `AccessLevel.Transactions`, while `aztec_createAuthWit` is `PrivateData`, and the e2e already pins that.
  - `implementations-plan/capabilities-popup-quality/plan.md:43-45`
  - `packages/extension/src/wallet/services/wallet-sdk/background.ts:396-406`
  - `packages/wallet-bridge/src/session-types.ts:21-28`
  - `packages/extension/src/wallet/services/dapp-interaction/service.ts:412-415`
  - `packages/extension/tests/e2e/network/authwit-variants.test.ts:10-18`

- `simulateViews` is enforced by `simulation.transactions.scope`, **not** `simulation.utilities.scope`.
  - `implementations-plan/capabilities-popup-quality/plan.md:48-49`
  - `packages/wallet-bridge/src/scope-enforcement.ts:153-172, 291-299`

The transaction line is correct, including `scope="*"` plus embedded `feePayer`/`NO_FROM`: those still open the execute popup.
- `packages/extension/tests/e2e/network/tx-sendTx-feePayer.test.ts:10-18, 54-63`
- `packages/extension/tests/e2e/network/tx-sendTx-noFrom.test.ts:10-18, 54-63`

### 3. Copy critique

The weakest copy is `accounts`. The proposed head copy is wrong even before the authwit bug: it always mentions signatures, but `canCreateAuthWit` is optional, and new `accounts` requests do not render a capability card at all, so this text mostly never appears on the approval popup anyway.
- `implementations-plan/capabilities-popup-quality/plan.md:62-63, 71-72`
- `packages/extension/src/popup/windows/capabilities/index.vue:99-108, 115-116, 277-293`

`accounts.canCreateAuthWit -> "Request signatures (you approve each one)"` is false under the default policy and too vague: authwits are scoped authorizations for specific calls, not generic signing authority.
- `implementations-plan/capabilities-popup-quality/plan.md:80, 283`
- `packages/wallet-bridge/src/scope-enforcement.ts:252-287`

`data` is also misleading: it silently omits `registerSender`, and "private notes/events" is not the wire type. `accounts` similarly omits the `registerToken` write path.
- `packages/wallet-bridge/src/capability-map.ts:17-21, 39-43`
- `packages/wallet-bridge/src/capabilities.ts:47-50`
- `packages/extension/src/wallet/services/execution/service.ts:1033-1058`

`transaction` is the one line I would keep: "Each transaction still requires your approval" is honest even in the embedded-fee case.

### 4. Phase ordering / dependencies

Phase ordering has a real dependency bug. Phase 1 is not safe as written because it imports a window-level helper into an L4 settings module, which violates the repo's layer rule. Extract shared capability metadata to a lower layer first.
- `implementations-plan/capabilities-popup-quality/plan.md:102-105`
- `CLAUDE.md:74-79`

Phase 3 already changes settings behavior because `GrantedCapabilitiesList` reuses the shared detail panel; Phase 5 is mostly icon/header cleanup, not the moment settings "inherits" the new detail UI.
- `packages/extension/src/popup/components/modules/settings/connected-apps/GrantedCapabilitiesList.vue:1-3, 48-52`

Also, the plan describes an unknown-capability head badge, but no phase explicitly owns the `CapabilityCard`/metadata change required to render it.
- `implementations-plan/capabilities-popup-quality/plan.md:90-95, 115-180`

Phase 1 alone will not visually break settings, but it will leave mixed terminology; the bigger issue is the illegal import and the missing accounts explainer.

### 5. Test coverage gaps

Test coverage is too thin. `cap-request-basic` is not the relevant floor; add `cap-request-accounts`, `cap-request-rerequest`, `cap-request-partial`, `cap-request-repeat-noPopup`, and `meta-getAccounts`.
- `packages/extension/tests/e2e/network/cap-request-accounts.test.ts:10-17`
- `packages/extension/tests/e2e/network/cap-request-rerequest.test.ts:10-17`
- `packages/extension/tests/e2e/network/cap-request-partial.test.ts:10-17`
- `packages/extension/tests/e2e/network/cap-request-repeat-noPopup.test.ts:10-16`
- `packages/extension/tests/e2e/network/meta-getAccounts.test.ts:10-17`

Because the plan makes claims about authwit and embedded-fee sends, run `authwit-variants`, `tx-sendTx-feePayer`, and `tx-sendTx-noFrom` too.

For unit coverage, add tests for unknown-type escaping/approval policy, `humanizeMethodName` retaining raw ids/hex, `AddressDisplay` name-first behavior, and the fact that `contractClasses` must not switch to `AddressDisplay`.
- `implementations-plan/capabilities-popup-quality/plan.md:175-180`
- `packages/extension/src/components/AddressDisplay.vue:67-79`
- `packages/extension/src/utils/tx-enrichment.ts:46-59`

### 6. Brutalist-look honesty

The risk glyphs are fine. `▲/●/—` fits the mono typography better than the current RGB words.
- `implementations-plan/capabilities-popup-quality/plan.md:117-136`
- `packages/extension/src/popup/windows/capabilities/CapabilityCard.vue:68-78`

The denied badge does not: the family is not actually "pure mono" in warning states. Execute still uses green for the fee-set badge, verify keeps orange for suspicious hostnames, and the signer strip marks `MIXED` in orange.
- `packages/extension/src/popup/windows/execute/OperationCard.vue:132-145`
- `packages/extension/src/popup/windows/verify/index.vue:199-206`
- `packages/extension/src/popup/windows/execute/SignerIdentityStrip.vue:28-32, 92-95`

Keep the brutalist form, but retain at least an orange accent or warning glyph for `PREVIOUSLY DENIED`.

### 7. Missing / overreach

- Third duplicate label map the plan missed: `GRANT_SHORT_LABELS` in the connected-apps index summary. If you want one source of truth, decide whether that stays intentionally short or also moves.
  - `packages/extension/src/popup/pages/settings/connected-apps/index.vue:24-35`
- The settings detail page still says "Granted capabilities", so the permission/capability terminology decision is not actually contained to the popup.
  - `packages/extension/src/popup/pages/settings/connected-apps/[id].vue:285-288`
- The plan also claims the accounts detail branch needs a new `Permissions:` header, but that header already exists.
  - `implementations-plan/capabilities-popup-quality/plan.md:171-173`
  - `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:27-29`

The simpler/better unknown-capability approach is not "raw type as the headline"; it is fixed `Unknown permission`, escaped machine string, and no persistence.

### Verdict

**REWORK** — the plan is materially wrong on `accounts.canCreateAuthWit` and `simulateViews`, Phase 1 violates the layer rules, the proposed unknown-capability and `AddressDisplay` paths are unsafe as written, and the popup still has no honest surface for new `accounts` requests.

- `implementations-plan/capabilities-popup-quality/plan.md:41-52, 62-67, 102-105, 168-174`
- `packages/extension/src/popup/windows/capabilities/index.vue:99-116, 277-293`
- `packages/extension/src/wallet/services/dapp-interaction/service.ts:345-363`
- `packages/wallet-bridge/src/scope-enforcement.ts:153-172`
- `CLAUDE.md:74-79`

---

## Reviewer's verification (every contested claim ground-truthed against code)

| Codex claim | Verified | Evidence |
|---|---|---|
| Default `confirmationLevel = AccessLevel.Transactions(5)` (opus said AppState) | ✓ codex correct | `background.ts:400`: `AccessLevel.Transactions` is the literal arg to `addDappSession` on fresh `accept_session` |
| `accounts.canCreateAuthWit` silent under default policy | ✓ codex correct | `PrivateData(4) >= Transactions(5)` = false → no popup |
| `simulateViews` gated by `simulation.transactions.scope` (plan said utilities) | ✓ codex correct | `scope-enforcement.ts:165`: `c.transactions?.scope` |
| `transaction` always popup, embedded-fee or not | ✓ codex correct | Two paths force it: (1) access-level `5 >= 5` always true for `send_transaction`/`aztec_sendTx` at `service.ts:351`, and (2) the `feePayer === undefined` short-circuit at `service.ts:357`. Both routes preserved by `tx-sendTx-feePayer.test.ts:55-57` (popup opens). Opus's "embedded feePayer skips popup" claim is incorrect. |
| `humanizeMethodName` is lossy | ✓ codex correct | `tx-enrichment.ts:13-20`: `transfer`, `transfer_in_private`, `transfer_private_to_private` all → `"Transfer (private)"` |
| `accounts` cap includes `registerToken` write | ✓ codex correct | `capability-map.ts:21` |
| `data` cap includes `registerSender` write | ✓ codex correct | `capability-map.ts:42` |
| `contractClasses.classes` are class IDs, not addresses | ✓ codex correct | `capabilities.ts:30-34`; AddressDisplay would resolve them as if they were addresses |
| "Permissions:" header already exists in accounts detail branch | ✓ codex correct | `CapabilityDetailPanel.vue:27-29` |
| Layer-rule violation: importing `capability-meta.ts` (L6) from `connected-app-helpers.ts` (L4) | ✓ codex correct | Per CLAUDE.md `L0 → L6` strict, biome enforces |
| Type-only diff hole for non-`accounts` widening | ✓ codex correct | `dispatcher.ts:431-438` only does field-diff for accounts; other types only compare by `type`, so a dApp granted `contracts.contracts=["A"]` can later request `contracts.contracts=["A","B"]` and bypass the popup |
| `GRANT_SHORT_LABELS` is the third duplicate label map | ✓ both audits correct | `index.vue:24-31` |

Where opus and codex disagreed, codex was correct in every case. The codex audit also surfaced **new findings** opus missed: layer-rule violation, `humanizeMethodName` lossiness, `contractClasses.classes` ≠ addresses, `simulateViews` bucketing, type-only diff hole.

---

## Final pass on plan-v2 (resume of same codex session, response-1.md)

Verdict: **APPROVE-WITH-CHANGES**.

### Codex's 5 required changes

1. **Move `ScopeAddress` / `ScopeClassId` and any contact lookup out of `components/composite/`** into flat service-bound components under `src/components/` (same tier as `AddressDisplay`). CLAUDE.md "Extension component model" §L3 explicitly bans `components/composite` from importing `@/utils/core` (where `managers` lives) — so a composite that does a contact lookup would violate L3's import rule. Service-bound visuals live flat (`src/components/<Name>.vue`), not in `core/` / `ui/` / `composite/`.
   - Cites: `CLAUDE.md:85`, `plan-v2.md:197, 275, 437`, `biome.json:220`.

2. **Soften the authwit copy.** The "scoped signature within transaction scope" framing is wrong in two cases:
   - When there are no tx/simulation caps, authwit falls back to the accounts-level check only (`scope-enforcement.ts:211`).
   - Raw `Fr` authwits carry no call semantics at all (`scope-enforcement.ts:285`).
   Codex's suggested copy: `"Read your account addresses and register tokens. May also request auth witnesses for shared accounts."`

3. **Sanitize parenthetical contact annotations AND raw contract/class strings, not just method ids and unknown types.** Currently v2 only routes `function` and `cap.type` through the sanitizer; addresses go through `trimAddress` (no sanitization) and contact names go through the local-storage lookup (no sanitization). Expand the sanitizer family.

4. **Resolve `recognizedLabel()` concretely.** v2 references it as if it exists, but `METHOD_LABELS` is a private const in `tx-enrichment.ts`. Either add `tx-enrichment.ts` to the touched files and export a `getMethodLabel(method): string | null` helper, or duplicate the allowlist (rejected — drift risk). Codex prefers the helper export.

5. **Fix new honesty bugs.** `"Register tokens (read-only registry update)"` and `"Register senders (read-only registry update for decryption)"` are wrong — both mutate wallet/PXE state. Reword honestly. Add one explicit unit test for unknown-cap `selected: false` defaulting in the popup's `init()`.

### Codex's smaller observations

- The orange-border PREVIOUSLY DENIED treatment slots cleanly into the family. Keep exactly.
- Default-OFF on unknown caps is correct for new top-level type discriminators. It does NOT protect against protocol evolution that adds new fields under an existing known type — but that is an additive-shape concern, not a discriminator concern. Out of scope (acknowledged).
- Contact annotation framing inconsistency in plan-v2.md: one place says "wallet-controlled," another says "user-controlled." The correct framing is **user-controlled** (user creates contacts; wallet just looks them up).
- The "enforced by `noRestrictedGlobals`" claim in v2's security section is wrong — that biome rule is scoped to the `wallet-core` package, not the extension path. The new shared module's purity is a maintainer-review responsibility, not automated.
