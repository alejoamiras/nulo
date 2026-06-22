# C4 — Round 1 cross-rebuttal (Claude side)

All claims re-verified against source on `feat/security-audit-remediation`. Paths repo-relative under `packages/extension/src/`.

## (a) Missed by codex

1. **Dead-code families** (Claude F6/F5): `displaceIdx` computeds ×8 — verified: defined at e.g. `popup/components/popups/NewContactPopup.vue:19`, `NewAccountPopup.vue:17`, `NewNetworkPopup.vue:15`, `EditEndpointPopup.vue:17`, while templates bind `popupStore.popups.X?.order` directly (`NewContactPopup.vue:199`, `NewAccountPopup.vue:96`). Plus the byte-identical dead 57-line style block ×5, BalanceView dead-symbol cluster, dead emits, SelectNetworksPopup commented-out block. Neither codex agent found any of it.
2. **Layer gap 2**: `sanitizeWireString`/`stripWireControl` in `wallet/services/dapp-session/capability-meta.ts` imported by L3 composites (`components/composite/capabilities/CapabilityDetailPanel.vue:14`, `DappIdentityBlock.vue:15`) through a biome glob blind spot. Codex-2 F3 caught only the onboarding half.
3. **Awaiting-card resolver triplication**: `RecentActivityView.vue:345-400` re-implements `utils/journal-state.ts:324-352` (`buildJournalTerminalCardProps`) with shipped drift (`amountRaw === undefined` vs truthy gate). Codex-1 F4 cites adjacent lines but misses this — the strongest drift evidence in the cluster.
4. **`FEE_JUICE_DECIMALS` ×3 + formatter twins** (Claude-2 F8).
5. **OperationCard payload-block duplication** (`popup/windows/execute/OperationCard.vue` — in scope; codex-1 only considered `execute/index.vue`).
6. **Enter-guard divergence**: `NewEndpointPopup.vue:77-79` lacks the input/textarea guard 13 siblings carry — codex-1 F1 covers the keydown family but not the rot evidence.
7. **`useFormState`'s zero-consumer API surface** (`isValid`/`isDirty`/`touchAll` — Claude-2 F7; complements codex-2 F1).

## (b) Overconfident / wrong

1. **Codex-1 non-finding on fee-estimation twins is factually wrong.** "Keyed timer/counter/state model is materially different" does not survive a diff: `composables/useFeeEstimation.ts:45-92` vs `useFeeEstimationMap.ts:46-101` are the same algorithm (clearTimer → cancel-with-counter-bump → debounced schedule with identical try/catch/finally stale-guards → dispose), generalized only by key. Codex-2's demotion repeats the error more softly.
2. **Codex-1 F4 overreach**: claims RAV "redefines" journal card-prop mapping at `RecentActivityView.vue:407-410` — that wrapper *calls* the shared `buildJournalTerminalCardProps` (the comment even explains the `id` delta). The real local forks are the incoming mapper (:243-251) and the awaiting resolvers (:345-400).
3. **Codex-1 F1 overbroad attribution**: lists endpoint/account/network popups among dialogs hand-rolling "event-splice handlers" — grep for splice/findIndex/on*Added across those six popups returns nothing; the trio exists only in contact/fpc/select popups.
4. **Codex-2 F1 change-frequency claim wrong**: "only the initial-import commit since 2026-03-11" — `EditProfilePopup.vue` has `8b5ecfd` (profile-name parity, #37) since March.

No DO-NOT-FLAG violations found on the codex side.

## (c) Confirmed

- Import/create popup-vs-onboarding twins (codex-1 F2/F3, codex-2 F4) — converges with Claude F1; architectural, top priority.
- RecentActivityView god component + twin template branches (codex-1 F4, codex-2 F2).
- Account-state ×4 scaffold (both F5s); codex-2's "0 touches since March" verified for those pages.
- Popup CRUD lifecycle glue (codex-1 F1), modulo (b)3.
- **Codex-2 F1 (async-baseline gap in `useFormState`) is a genuine root-cause finding Claude under-weighted**: verified `EditProfilePopup.vue:26,34,40` + the "Reset changes" button existing only to compensate; the `rebase()`/`setInitialValues()` remedy is right.
- **Codex-2 F3 corrects Claude-1's remedy**: `PasskeyCeremonyDialog.vue:31` imports `@/popup/utils/passkey-ceremony`, so Claude-1's "the component is fine, just move the file" undersells the move — the popup util comes along. Codex-2's shell-adapter framing is more accurate.
- Codex-1's out-of-scope observations are both real and Claude-missed: `EditContactPopup.vue:62` reads `contactToEdit.id` on a ref (declared `ref(null)` at :76; every other site uses `.value` — the branch is dead at runtime); `SelectBalanceTypePopup.vue:97` reads `appStore.displayOption?.ref` though :68 stores the scalar `option.ref`.

## (d) Contradictions

1. **Fee-estimation twins**: both codex reject/demote; both Claude flag. Source sides with Claude (see b1) — the API split is deliberate, the body duplication is not.
2. **Select\*Popup family**: both codex reject wholesale; Claude-1 F8 extracts the narrower real duplication (row-card CSS recipe ×6, selected-icon ternary ×5). Complementary granularity — the rejection of a generic picker is fair, the CSS/icon micro-family still stands.
