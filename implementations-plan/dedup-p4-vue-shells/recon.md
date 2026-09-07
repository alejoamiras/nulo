# Recon — dedup-p4-vue-shells

Base: `worktree-dedup-p3-service-wrappers` @ 13bbae62 (PR #568). The ledger (`implementations-plan/dedup-ledger/ledger.md`,
`reports/{J-pages,K-windows-onboarding,L-modules,M-components-design,N-popups}.md`) is the primary recon; one Sonnet
reuse sweep re-verified every claim on this tree and answered the mechanics questions below. Evidence re-checked by
hand where a verdict depends on it.

## Reuse map

| Id | Claim on this tree | Existing code | Verdict |
|---|---|---|---|
| J1 | 10 of 12 shared classes byte-identical across `tx/[id].vue`, `received/[id].vue`, `journal/[id].vue` (`amount_fiat amount_symbol amount_value detail_key details_box detail_value_mono empty_headline empty_sub hero_meta tx_time`); `.wrapper`/`.content` differ in journal (padding-bottom) | no `*.module.css` partial anywhere under `apps/extension/src`; `composes:` unused in the repo | build new partial (mechanism verified below) |
| J2 | 19 settings pages render `Flex.wrapper > SubPageHeader(title, backTo) > Flex.content(gap)`; `.wrapper`/`.content` CSS identical in all 19 (checked senders vs security); gap varies (none/12/16/20/24/32/40); three pass children to `SubPageHeader` | `components/ui/SubPageHeader.vue` (host wrapper over `@nulo/design`'s base; props `title backTo showBack leadingIcon leadingIconColor`); no shell component (`find -iname "*Shell*"` → none) | build new `SettingsPageShell` |
| J3 | the three detail pages render `Flex(gap=12).content > span.empty_headline + span.empty_sub` — borderless | `components/composite/ListStatusMessage.vue` `.empty` is a dashed-border 32px-padded 8px-gap card | fold the two classes into J1's partial; LSM adoption skipped (box model differs) |
| J4 | five pages hand-roll `LoadingState v-if / Tooltip+Banner("Try again") v-else-if` (`contracts notes senders authwits fpcs`); contracts/notes own `isFetching*`/`error`/try-catch with a refetch toast, no error reset, an `appStore.account` watch | `composables/useEntityCrud.ts` — hooks optional, so `useEntityCrud({ fetch })` is already fetch-only; returns `{ entities, isLoading, error, refresh, dispose }` | build new `AsyncListStatus` (template); the useEntityCrud move for contracts/notes is skipped (visible state machine differs, see plan) |
| K1 | `learn.vue`/`fees.vue` differ only in route title, cards copy, lede, step, handlers and testids; style blocks differ by one comment character | `onboarding/components/{OnboardingPage,StepIndicator}.vue` (+ tests) | build new `OnboardingExplainer` |
| K7 | `.skipLink` (+hover/focus) byte-identical in `learn fees accelerator` | none | build new `OnboardingSkipLink` (explainer + accelerator) |
| K4 | seven heroes share the shape but not the CSS or the markup: padding 8/16/24, bar width 40/56, `Flex` vs `header`, centered variants with a `.subhead`, `done.vue`'s commented block | none | **skip** — a shared piece needs ~4 props + 2 slots for ~30 net lines |
| K5 | profile-name field byte-identical in `create.vue`/`import.vue` (`Input ref=nameInputRef v-model :error sanitize data-testid="onboarding-name-input" @input`, `.shake` wrapper, error `Text role=alert`); `.shake`/`@keyframes shake`/`.section_label` identical | `@nulo/design` `Input` (used inside) | build new `OnboardingProfileNameField` |
| K6 | back button markup + `.back` CSS identical in the two pages; testids differ (`onboarding-create-back`/`onboarding-import-back`) | none | build new `OnboardingBackLink` |
| K9 | `.wrapper`/`.scroll_area` identical (md5) in `execute capabilities discover verify` | `DappIdentityBlock`, `DappStatusStrip`, `DappApprovalFooter` composites already shared by these windows | build new partial |
| K10 | `json/index.vue` and `logger/index.vue` style blocks identical (24 lines); scripts differ (payload fetch vs log subscription) | none | fold the classes into K9's partial; templates untouched |
| K11 | `popup/index.ts:1-22` ≡ `onboarding/index.ts:8-28` except the client tag and two comment words; `offscreen/index.ts` carries a divergent third copy (not in scope) | `wallet/logger/index.ts` barrel (`consoleMethods`, `LogLevel`) | build new `installConsoleForwarding` |
| L1 | `.detail_row` identical in 4 send cards, `.fee_label` in 3, `.skeleton`+`@keyframes shimmer` in `FeeCostReadout`/`FeeMethodRow`; `GasBalanceCard`'s skeleton differs | none | build new partial (GasBalanceCard's skeleton adopted only if it matches modulo formatting) |
| L3 | `TokensView`/`RecentActivityView` `.empty_state` ≡ LSM `.empty`; TokensView's sub line carries a button (`tokens-empty-import-link`) | `ListStatusMessage` (`sub` is a string prop; default slot is the no-results line) | adapt LSM: add a `#sub` slot |
| N6 | `.header`/`.pre_title` identical (12 lines) in `ConfirmPopup`/`IncomingTrustPopup` | none | build new partial (shared with N9) |
| N9 | the clickable row (`border-radius:0; cursor:pointer; border; padding; transition; &:hover`) in `SelectFpcPopup .fpc`, `SelectNetworksPopup .network`, `SelectBalanceTypePopup .card`, `ImportContactsPopup .contact`; padding/min-height deltas per popup | none | build new partial; local classes keep their deltas |
| M2 | overlay shell (`.wrapper .card .title .sub .detail`, 40 lines) identical between `MigrationBarrier`/`AccountIntegrityBarrier`; Migration adds `.banner*` and `.retryBtn` | none (`DappCancelledOverlay` is a different shape) | build new `BarrierOverlay` |
| M3 | `<template #title-trailing><span.title_sep>·</span><span.chip|transfer_chip>label</span></template>` in all four cards; `.title_sep` identical; chip CSS to be diffed in-phase | `TransactionCardLayout.vue` slot contract (`badge`, `title-trailing`, `secondary`, `actions`); 21 tests | adapt the layout (`chip` prop) if the chip CSS is identical, else skip |

## Mechanics

- **CSS Modules `composes:` from a partial** — no precedent in the repo, but Vite 8.2.1's default CSS pipeline handles it
  inside an SFC `<style module>`. Spike on this tree: `FeeCostReadout.vue`'s `.detail_row { composes: detail_row from
  "./fee-shared.module.css" }` → `FeeCostReadout.test.ts` 6/6, `build:chrome` exit 0, the built JS maps
  `$style.detail_row` to `"_detail_row_j0pjd_2 _detail_row_oa61m_1"` and the partial's rule is emitted once. Cascade: the
  partial's rule precedes the importing module's, so a consumer's own declarations win on ties (N9's deltas).
- **Auto-registration**: `vite.config.ts` registers `src/components` and `src/onboarding/components`; a new component
  regenerates `src/types/components.d.ts`, which CI asserts unchanged after `bun run build` → the local gate builds and
  commits it. Partials are plain files, no generated-type impact.
- **Layers**: `SettingsPageShell`, `AsyncListStatus`, `BarrierOverlay` → `src/components/composite/` (L3: may import
  `components/ui` and `@nulo/design`, never services). Onboarding pieces → `src/onboarding/components/` (onboarding
  cannot import `@/popup/**`, biome-enforced).
- **Tests**: colocated `<Name>.test.ts`, `mount` from `@vue/test-utils`, auto-registered children stubbed via
  `global.stubs` (`TransactionAwaitingCard.test.ts`), bare composables via `vi.stubGlobal` (`Header.test.ts`).
- **Complexity budgets** apply to `.vue` script blocks; none of the new components has branching to speak of.
- **Testids** in the touched files: onboarding `onboarding-{welcome-create,welcome-import,create-back,import-back,
  name-input,method-password,method-passkey,password-input,password-confirm,submit-create,submit-import,learn-continue,
  learn-skip,fees-continue,fees-skip,accelerator-*,done-open,pin-tip}` + `import-full-backup-*`; settings testids sit on
  rows/buttons, never on `.wrapper`/`.content`; `contracts`, `notes`, `connected-apps/[id]` carry none; barriers
  `migration-{blocked,blocked-detail,retry-btn,updating,degraded,degraded-dismiss}`, `account-integrity-blocked(-copy)`;
  cards `tx-incoming-kind-chip`; tokens `tokens-empty-import-link`.

## Later-phase overlap (P5 ids, not touched here)

`verify/index.vue` (K8), `IncomingTrustPopup.vue` (N7), `SelectFpcPopup`/`SelectBalanceTypePopup`/`ImportContactsPopup`
(N1), `RecentActivityView.vue` (L2). This phase edits only `<style module>` blocks (and, for L3, the empty-state
markup) in those files, leaving their script regions for P5.

## Absence trails

`find apps/extension/src -name "*.module.css" -o -name "*.module.scss"` → none · `grep -rn "composes:" apps packages`
→ none · `grep -rln 'lang="scss"' apps/extension/src` → none · `find apps/extension/src -iname "*Shell*.vue" -o -iname
"*Overlay*.vue"` → `TransactionCardLayout`, `CollapsingHeroLayout`, `DappCancelledOverlay` only · `grep -rn
installConsoleForwarding` → none.
