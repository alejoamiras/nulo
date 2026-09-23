# Cluster J — popup pages (`apps/extension/src/popup/pages/`)

## Cluster verdict

The script logic in this cluster is generally solid — `send.vue`, `seed.vue`/`account.vue` (export flow) and the entity-list settings pages already extract shared logic into composables (`useEntityCrud`, `usePrices`, `useSecretClipboardCopy`) and composites (`CollapsingHeroLayout`, `SecretUnlockSection`). The real waste is in `<style module>` blocks and page-shell template scaffolding: the same `.wrapper`/`.content` CSS rule is copy-pasted verbatim into ~20+ page files, and the three activity-detail pages (`tx/[id].vue`, `received/[id].vue`, `journal/[id].vue`) — whose own comments say "mirrors tx/[id].vue" and "reuses tx/[id].vue's style vocabulary verbatim" — duplicate ~100-150 lines of CSS between each pair instead of sharing it. The single biggest lever is consolidating that page-shell CSS/markup into 1-2 shared composites; a secondary lever is the identical loading/error/retry list scaffold hand-rolled in 5 `settings/advanced/account-state/*` and `settings/fpcs` pages. Total realistically removable: **~400-450 LOC**, essentially zero product-behavior risk since it's shell chrome, not business logic.

## Findings

### F1 [duplication] Detail-page `<style module>` blocks are 60-70% identical across three files

**Where:**
- `apps/extension/src/popup/pages/tx/[id].vue:373-597` (`<style module>` block, 225 lines)
- `apps/extension/src/popup/pages/received/[id].vue:342-554` (213 lines)
- `apps/extension/src/popup/pages/journal/[id].vue:344-493` (150 lines, whose own comments read `/* Hero — mirrors tx/[id].vue */`, `/* Amount block — verbatim from tx/[id].vue tokens */`, `/* Details box — mirrors tx/[id].vue details_box */`, `/* Empty state — mirrors tx/[id].vue */`)

**Evidence** (byte-identical rules, present in all three files):
```css
/* tx/[id].vue:374-379, received/[id].vue:343-348, journal/[id].vue:345-350 */
.wrapper {
	flex: 1;
	overflow: auto;
	scrollbar-gutter: stable;
	background: var(--app-bg);
}
```
```css
/* tx/[id].vue:450-455 == received/[id].vue:399-404 == journal/[id].vue:370-375 */
.amount_value {
	font-family: var(--font-mono);
	font-size: 24px;
	font-weight: 500;
	color: var(--txt-primary);
}
```
Also identical (verified line-by-line) across all three: `.amount_symbol`, `.amount_fiat`, `.hero_meta`, `.tx_time`, `.details_box`, `.detail_key`, `.detail_value_mono`, `.empty_headline`, `.empty_sub`; and additionally between just tx/received: `.meta_sep`, `.hero_link`, `.address_card`, `.address_label`, `.detail_value_aux`, `.detail_link`, `.transfer_type_chip` (journal's `.category_chip` is the same rule, renamed). That's ~18 shared rules between tx/received (~130 lines) and ~12 shared rules with journal (~85 lines).

**Refactor:** Extract the shared rule set into one CSS-module partial, e.g. `apps/extension/src/components/composite/detail-page.module.css`, and have each SFC's `<style module>` pull the shared classes in via CSS Modules `composes: wrapper content hero_meta tx_time amount_value amount_symbol amount_fiat details_box detail_key detail_value_mono empty_headline empty_sub from "@/components/composite/detail-page.module.css";` (Vite's default CSS-modules pipeline supports cross-file `composes`). Page-specific rules (`fee_shimmer`, `calls_box`, `dev_box`, `card_static`, …) stay local. Each page's own class stays the same name in `$style.*`, so **zero template changes** and **zero `data-testid` risk**.

**LOC delta:** -140 (three ~150-225-line blocks shrink to ~35 lines each + one new ~90-line shared partial).

**Risk / tests:** Low — pure CSS, no behavior change. No dedicated CSS test exists; visual regression would be caught by Storybook/manual smoke of `/popup/tx/:id`, `/popup/received/:id`, `/popup/journal/:id`. `apps/extension/src/popup/pages/settings/networks/index.test.ts`-style component tests don't cover these pages, so a screenshot/manual check is the real gate.

**Confidence:** high.

---

### F2 [duplication] The same page-shell `.wrapper`/`.content` CSS + template scaffold is copy-pasted into ~19 settings pages

**Where (all with byte-identical `.wrapper { flex: 1; overflow: auto; background: var(--app-bg); scrollbar-gutter: stable; }` and `.content { padding: 16px 24px var(--nav-clearance) 24px; }`):**
`settings/appearance.vue`, `settings/about.vue`, `settings/profile/index.vue`, `settings/security/index.vue`, `settings/accounts/index.vue`, `settings/tokens/index.vue`, `settings/connected-apps/index.vue`, `settings/connected-apps/[id].vue`, `settings/advanced/index.vue`, `settings/fpcs/index.vue`, `settings/networks/index.vue`, `settings/networks/[id].vue`, `settings/contacts/index.vue`, `settings/security/export/index.vue`, `settings/advanced/account-state/index.vue`, `settings/advanced/account-state/authwits/index.vue`, `settings/advanced/account-state/contracts/index.vue`, `settings/advanced/account-state/notes/index.vue`, `settings/advanced/account-state/senders/index.vue`.

**Evidence** (e.g. `settings/advanced/account-state/senders/index.vue:176-185`, identical in all 19):
```css
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	scrollbar-gutter: stable;
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}
```
And the matching template shell, e.g. `settings/advanced/account-state/contracts/index.vue:62-65`:
```vue
<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
	<SubPageHeader title="Contracts" :backTo="'/popup/settings/advanced/account-state'" />
	<Flex direction="column" gap="16" :class="$style.content">
```
This exact `<Flex wrapper><SubPageHeader/><Flex content>` triple appears (with only `title`/`backTo`/`gap` varying) in all 19 files — confirmed via `grep -c 'SubPageHeader'` (34 hits across the cluster) and per-file `gap` values ranging 12-40.

**Refactor:** Add a small L3 composite, e.g. `src/components/composite/SettingsPageShell.vue`, taking `title`, `backTo`, `gap` (default `16`) props plus an optional `#trailing` slot (for the few pages, like `authwits/index.vue`, that put a `<Dropdown>` in the header), rendering the wrapper/`SubPageHeader`/content triple with the CSS baked in. The 19 call sites replace their outer `<Flex wrapper>…<SubPageHeader/>…<Flex content>…</Flex></Flex>` with `<SettingsPageShell title="…" backTo="…" gap="…">…</SettingsPageShell>` and delete their `.wrapper`/`.content` rules. Component boundary is respected — no store/service imports needed in the shell, it's pure presentation, so it can live in L3 (`composite/`) even though callers are L6 pages.

**LOC delta:** -140 (19 files lose ~8 lines each of CSS + ~3 lines of template nesting ≈ -180; new shared component + 19 updated call sites add back ≈ +40).

**Risk / tests:** Low. No `data-testid` sits on the wrapper/content divs themselves (verified — testids in these files are all on inner rows/buttons), so this is DOM-structure-neutral above the `SubPageHeader`. Existing coverage: `settings/networks/index.test.ts` (component test) would catch a broken render; e2e settings-navigation specs would catch a header/back-link regression.

**Confidence:** high.

---

### F3 [duplication] `tx/[id].vue`, `received/[id].vue`, `journal/[id].vue` hand-roll a "not found" empty state that duplicates the existing `ListStatusMessage` component

**Where:**
- `apps/extension/src/popup/pages/tx/[id].vue:366-369` + CSS `:581-596`
- `apps/extension/src/popup/pages/received/[id].vue:335-338` + CSS `:538-553`
- `apps/extension/src/popup/pages/journal/[id].vue:337-340` + CSS `:477-492`
- vs. the existing component: `apps/extension/src/components/composite/ListStatusMessage.vue:18-22` (already used for the *same concept* by `contracts/index.vue:101`, `senders/index.vue:161-165`, `authwits/index.vue:194-196`, `notes/index.vue:261-263`, `settings/contacts/index.vue`, etc.)

**Evidence:**
```vue
<!-- tx/[id].vue:366-369 -->
<Flex v-else wide direction="column" align="center" gap="12" :class="$style.content">
	<span :class="$style.empty_headline">TRANSACTION NOT FOUND</span>
	<span :class="$style.empty_sub">This hash isn't in your current account history.</span>
</Flex>
```
```vue
<!-- ListStatusMessage.vue:18-22 — the component these three pages should call instead -->
<div v-if="variant === 'empty'" :class="$style.empty" :data-testid="testid">
	<span :class="$style.empty_headline">{{ headline }}</span>
	<span v-if="sub" :class="$style.empty_sub">{{ sub }}</span>
</div>
```
Same headline/sub concept, same class names even, reimplemented with slightly different CSS (no dashed border, different margin) instead of reusing the shared component that 5+ sibling pages in this very cluster already call for exactly this purpose.

**Refactor:** Replace each page's empty-state `<Flex>` + `.empty_headline`/`.empty_sub` CSS with `<ListStatusMessage headline="TRANSACTION NOT FOUND" sub="This hash isn't in your current account history." />` (and the received/journal equivalents). If the current visual (no dashed border, `margin-top: 48px`) must be preserved pixel-for-pixel, add one prop to `ListStatusMessage` (e.g. `bordered: { default: true }`) rather than keeping three bespoke copies — still a net win since the CSS is written once.

**LOC delta:** -45 (3 files × ~15 lines of template+CSS removed; +10 for an optional `ListStatusMessage` prop).

**Risk / tests:** Low-med — only med if the owner cares about the exact visual delta (dashed border vs none); functionally identical. No existing test pins the empty-state markup in these three files.

**Confidence:** high.

---

### F4 [duplication] Identical loading/error/retry list scaffold hand-rolled 5 times, with 2 of those files also re-implementing what `useEntityCrud` already provides

**Where:**
- `settings/advanced/account-state/contracts/index.vue:23-43` (hand-rolled fetch state) + template `:66-76`
- `settings/advanced/account-state/notes/index.vue:51-56,111-131` (hand-rolled fetch state) + template `:214-224`
- `settings/advanced/account-state/senders/index.vue:37-50` (uses `useEntityCrud`) + template `:104-114`
- `settings/advanced/account-state/authwits/index.vue:40-56` (uses `useEntityCrud`) + template `:175-182`
- `settings/fpcs/index.vue:44-58` (uses `useEntityCrud`) + template `:155-162`

**Evidence** — the identical template block (all 5 files, only the label text differs):
```vue
<!-- contracts/index.vue:66-76, near-identical in notes/senders/authwits/fpcs -->
<LoadingState v-if="isFetchingContracts" label="FETCHING CONTRACTS" />
<Tooltip v-else-if="isErrorOccurred" wide>
	<Banner :action="{ name: 'Try again', callback: () => fetchContracts(true) }" variant="error" wide>
		Something went wrong
	</Banner>
	<template #content>
		{{ error }}
	</template>
</Tooltip>
```
And the script-level inconsistency — `contracts/index.vue:23-43` hand-rolls exactly what `useEntityCrud`'s `fetch`-only mode already does:
```js
const isFetchingContracts = ref(false)
const error = ref()
const isErrorOccurred = computed(() => !!error.value)
const fetchContracts = async (isRefetching) => {
	if (isRefetching) openToast({ label: "Fetching contracts again", icon: "zap" })
	isFetchingContracts.value = true
	try {
		contracts.value = await accountStateService.getContracts(appStore.network.id)
	} catch (err) { error.value = err } finally { isFetchingContracts.value = false }
}
```
`useEntityCrud` (`apps/extension/src/composables/useEntityCrud.ts`) already exposes `entities/isLoading/error/refresh` from just a `fetch` option (its `added`/`updated`/`deleted` hooks are documented as optional — "Omitting a hook means 'I don't care about this transition'"). `AccountStateServiceClient` (`apps/extension/src/wallet/services/account-state/client.ts`) has no contract add/delete events and `NoteServiceClient` has no events at all, so both pages could call `useEntityCrud({ fetch: () => … })` exactly like `senders`/`authwits`/`fpcs` already do — verified by grep, no such events exist on either client.

**Refactor:**
1. Switch `contracts/index.vue` and `notes/index.vue` to `useEntityCrud` (fetch-only), deleting their hand-rolled `isFetching*`/`error`/try-catch — matching the pattern the other 3 files in the same directory already use.
2. Extract the loading/error/retry template block into a small composite, e.g. `src/components/composite/AsyncListStatus.vue` (props: `loading`, `loadingLabel`, `error`, `onRetry`; default slot for the loaded-content branch), used by all 5 pages.

**LOC delta:** -70 (≈-20 each from the `useEntityCrud` swap on 2 files, ≈-8×5=-40 from the template extraction, +30 for the new composite).

**Risk / tests:** Low — `useEntityCrud` is already exercised by `useEntityCrud.test.ts` and used safely elsewhere; no dedicated test currently pins `contracts/index.vue` or `notes/index.vue`'s fetch state, so this is a mechanical, low-risk swap. Manual check: Settings → Advanced → Account State → Contracts/Notes still show loading/error/empty correctly.

**Confidence:** high.

---

### F5 [duplication] The "generation fence" async-staleness guard is hand-rolled identically 3 times

**Where:**
- `settings/security/export/account.vue:59,62-71,120,129,133,144,151,160,166,169,185,191,209-216` (`let generation = 0`, capture/compare/bump around `handleCreate`/`handleProtect`/`handleDownload`)
- `settings/security/export/full.vue:73,268,275,280,286,288,300,326-378,412` (same idiom; comment at `:67-71` explicitly says *"Re-entry latch + currency fence (the account.vue idiom)"* and `:318-321` says *"Same latch + fence discipline as creation … (account.vue idiom)"*)
- `settings/accounts/import.vue:39,44,56,61,66,82,84,87,90,102,107,144,168` (same idiom)

**Evidence** (the recurring 3-line core, present verbatim at every call site in all three files):
```js
// account.vue:119-120, full.vue:267-268, import.vue:83-84 (all identical shape)
const gen = generation
...
if (gen !== generation) return
```
```js
// account.vue:213, full.vue:412, import.vue:144/168
generation++
```

**Refactor:** Extract a tiny C0 composable `useGenerationFence()` in `src/composables/`:
```ts
export function useGenerationFence() {
	let generation = 0
	return { capture: () => generation, isStale: (gen: number) => gen !== generation, bump: () => { generation++ } }
}
```
Each of the 3 call sites replaces its local `let generation = 0` / `gen !== generation` / `generation++` with `fence.capture()` / `fence.isStale(gen)` / `fence.bump()`. The surrounding per-handler logic (what to fetch, which toast to show) stays untouched — this only removes the hand-rolled counter, not the business logic.

**LOC delta:** -15 (small: 3 files lose ~5 lines of counter bookkeeping each; +10 for the composable). Low absolute LOC but removes a footgun — a 4th copy-paste site (there will be more export/import flows) would otherwise inevitably drift.

**Risk / tests:** Low — mechanical extraction of a pure counter. `settings/security/export/full.test.ts` and `full-passkey.pins.test.ts` already exercise the fence behavior in `full.vue` and would catch a regression; `account.vue`/`import.vue` have no dedicated unit test for this logic today (covered only by e2e).

**Confidence:** med (the exact call-site line numbers shift slightly per file; the pattern itself is verified in all three).

## Not worth it

- `send.vue` (708 lines) — already decomposed into `send-amount.ts`, `send-balance-events.ts`, `send-fiat-gate.ts` colocated helpers; no further extraction meets the value bar.
- `settings/security/export/seed.vue` / `account.vue` — already share `CollapsingHeroLayout`, `SecretUnlockSection`, `SecretRevealCard`, `SecretCountdownClose`, and `useSecretCountdown`/`useSecretClipboardCopy`; the code even notes a prior duplication was already fixed ("previously duplicated word for word here").
- `settings/contacts/index.vue` — already uses `useEntityCrud` consistently like the other list pages; no duplication found.
- Per-page `new XServiceClient()` + `onBeforeUnmount(() => service.disconnect())` — this matches the documented C1 composable contract (parent owns connect/disconnect); not flagged as duplication since it's the sanctioned architecture, not accidental repetition.
- `settings/security/index.vue` / `settings/advanced/index.vue`'s bare `LoadingState v-if="isLoading"` (no retry banner) — structurally different from the 5-file pattern in F4 (these are single-value config loads, not lists), not worth forcing into the same abstraction.
- `debugMode || developerMode` flag resolution from `configService.getProps()`, duplicated in `tx/[id].vue:155-158` and `journal/[id].vue:230-233` — only 4 lines, 2 sites; below the value bar on its own (folded as context into F1's shared-scaffold observation, not a standalone finding).
