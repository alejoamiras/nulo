# Recon — dedup-p5-vue-components

Base: `worktree-dedup-p4-vue-shells` @ e06337b7 (PR #569). Per the ledger README's pre-answer, the ledger
(`implementations-plan/dedup-ledger/ledger.md`) and its `reports/{N-popups,L-modules,K-windows-onboarding,
M-components-design,I-utils}.md` are the recon; every row below was re-checked by hand on this tree (no sweep agent).

## Reuse map

| Id | Claim on this tree | Existing code | Verdict |
|---|---|---|---|
| N1 | nine hand-rolled add/update/delete syncs: contacts ×4 (`New/Edit/ImportContactsPopup`, `send.vue`: push / upsert-on-missing / filter), FPCs ×3 (`New/Edit/SelectFpcPopup`; Select decorates with `prepareFpc` and ignores an unknown update), balances ×2 (`SelectBalanceTypePopup`, `BalanceView`: add filtered by account, unknown update ignored, delete by splice) | `composables/useEntityCrud.ts` owns the fetch too and upserts on an unknown update; the popups fetch on their own schedule and two families ignore unknown updates | build new `useEntityCollectionSync` (C1, sync only) with `identity`, `accept`, `decorate`, `upsertMissing` options |
| N2 | 14 warning rows (`Flex align=center gap=6 > Icon warning 12 red + Text 12/600/primary`) across nine popups; 12 sit inside `<Transition name="fade">`, `v-if` and copy vary, two interpolate | none | build new `FieldWarning` (row only; callers keep `v-if` and their `Transition`, so the fade still sees the toggled child) |
| N3 | `modules/settings/contacts/ProcessingErrorNote.vue` (icon `color="primary"`) vs inline copies: `NewFpcPopup` (dead `type` ternary, always red), `EditFpcPopup` (red), `NewSenderPopup` (red, `gap=6`, no `wide`/`:disabled`/`paddingLeft`) | the component + its test | adapt: move to `components/composite/`, add `color` prop (default `primary`); adopt at the two FPC popups with `color="red"`; NewSender skipped (different box) |
| N4 | `Edit/NewEndpointPopup` classifier ≡ except the duplicate-URL copy and `network.value?.chainId`; the two `Input`s ≡ except `label`/`placeholder` ("Label"/"Primary" vs "Label (optional)"/"Backup") | none; `NewEndpointPopup.test.ts` exists, Edit has none | build new `classifyEndpointError(err, network, duplicateCopy)` (pure) + `EndpointFormFields` (label + placeholder props) |
| N5 | registry-status scaffold shared by `ChangeAuthwitsRegistryPopup` (190 lines) / `RevokeAuthwitsPopup` (382) | none | **skip** — ≈ −5 net; the ledger ties it to X5 (Tier-4) |
| N7 | `handleAllow`/`handleReject` identical modulo the action, toast label and icon; heavy audit comments (latch, generation, payload key) | none | adapt in place: `decide(action, label, icon)` keeping every guard and comment |
| N8 | six identical capability rows (`label`, `mono key`, check/close icon by `token.<key>`); the address renders `slice(0,6) + •••-Text + slice(-4)` | `trimAddress` renders one string, not the three-node markup | data-driven `v-for`; the address markup stays |
| L2 | the two `RecentActivityView` blocks (792-857 / 858-~915) differ only in the outer condition, two comments and the fallback awaiting card (`isTokenAwaitingTx` vs `awaitingAccountTxs.length`) | `isTokenAwaitingTx`, `awaitingAccountTxs` computeds (:120,:125) | merge under one block with `showFallbackAwaiting` |
| L5 | `.fee_row_toggle` ≡ `.debug_toggle` (18 lines); the chevrons differ (size 10 with `v-if` vs 12) | the `composes:` partial pattern (P4) | build new `tx-shared.module.css` `disclosure_toggle`; chevrons untouched |
| K3 | `aztec_simulateTx` (390-409) ≡ `aztec_profileTx` (422-441) modulo the discriminant; the `add_public_authwit` under-render is a rendering change | none | merge the two branches only; the action-row extraction (b) is skipped as user-visible |
| K8 | `verify/index.vue` inlines `DappIdentityBlock`'s template and all seven CSS classes byte-identically (md5), plus a `sanitizedDappName` computed the composite already owns; no testids on the inline block | `components/composite/DappIdentityBlock.vue` (`dapp hostname hostnameSuspicious actionLabel …TestId`) | reuse as-is; verify keeps its `dappHostname`/`hostnameHasNonAscii` computeds |
| M1 | three scope-pattern lists in `CapabilityDetailPanel` (`transactions.scope`, `utilities.scope`, `scope`) identical modulo the bound scope and label; `formatScope`/`fnLabel` are module-level functions; `getMethodLabel` to be located in-phase | `ScopeAddress` | build new `ScopePatternList` (props `scope`, and a `methodLabel` function prop if `getMethodLabel` closes over the panel) |
| M5 | `.section`(2)/`.section_last`(2)/`.section_label`(3) across the import forms; four identical visibility buttons (`type=button tabindex=-1 :class=visibility_btn :aria-label` + `MaterialIcon visibility/visibility_off 18 secondary`) differing in the toggled ref and the noun; `passwordHint` already uses P2's `newPasswordHint` | `@nulo/design` `SectionLabel` is 12px/0.1em, the local label 11px/0.18em — not a drop-in | build new `import-shared.module.css` + `PasswordVisibilityToggle` (`hidden`, `noun`; emits `toggle`) |
| M6 | extension `EmojiGrid` (48px cells, 8px padding, 4px gap, 24px glyphs, `nulo-border`) vs design's (56px, 16px, 8px, 28px, `nulo-outline`) | design `EmojiGrid` | **skip** — no visual parity |
| I5 | four `design/*.stories.ts` share the 8-line meta | none | build new `tokenStoryMeta(title)` in `design/story-meta.ts` |

## Mechanics carried from P4

`composes:` partials (verified in the built stylesheet), auto-registered components regenerate `components.d.ts`
(build in the gate, commit it), tests register real extracted children (vitest auto-registers nothing), L3 composites
may import `components/ui` + `@nulo/design` only, popups are L5.

## Later-phase / deferred overlap

None: P5 is the last phase; A2 A4 B6 C7 D6 D7 D8 E5 X5 stay untouched (N5's only justification was X5).
