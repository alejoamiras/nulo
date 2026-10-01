# Cluster M — shared components + design package

## Cluster verdict

This cluster is noticeably cleaner than "LLM slop under time pressure" would predict — the L0–L2 migration to `@nulo/design` is genuinely complete (every export is consumed, no dead components), and several composites (`TransactionCardLayout`, `DappApprovalFooter`, `DappIdentityBlock`, `IdentityStrip`) already carry explicit "we deduplicated this" doc comments backed by real shared implementations. The remaining waste is concentrated in two shapes: (1) copy-pasted CSS/markup across sibling components that share a visual family (barrier overlays, activity-card chips, import-form sections) but were built as separate files instead of one shared shell, and (2) one genuinely dead component (`FeeJuiceCard`) that a test file itself flags as orphaned. The single biggest lever is `CapabilityDetailPanel.vue`, which triplicates the same ~32-line scope-pattern-list template inline. Total realistically removable: **~230–260 LOC**, all low-risk (presentation-only, each site has a colocated test).

## Findings

### F1 [duplication] `CapabilityDetailPanel.vue` triplicates the scope-pattern-list block

- **Where:** `apps/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:142-173` (simulation → transactions), `:177-208` (simulation → utilities), `:219-250` (transaction type root scope).
- **Evidence:** all three are the same structure with only the bound scope expression and section label changing:
  ```vue
  <!-- 142-150 -->
  <Flex v-if="formatScope(capability.transactions.scope).isWildcard" ...>
    <Text ...>&#x2022;</Text><Text ...>Any contract, any function</Text>
  </Flex>
  <Flex v-else direction="column" gap="10" :class="$style.detail_list">
    <Flex v-for="(p, pi) in formatScope(capability.transactions.scope).patterns" ...>
  ```
  ```vue
  <!-- 177-185, byte-identical except capability.utilities.scope -->
  <Flex v-if="formatScope(capability.utilities.scope).isWildcard" ...>
  ```
  ```vue
  <!-- 219-227, byte-identical except capability.scope -->
  <Flex v-if="formatScope(capability.scope).isWildcard" ...>
  ```
  Inside all three, the pattern row (contract address-or-wildcard + `fn:` label + `getMethodLabel` annotation) is repeated verbatim (lines 151-173 ≈ 177-208 ≈ 228-250).
- **Refactor:** extract a local component `apps/extension/src/components/composite/capabilities/ScopePatternList.vue` taking `{ scope: Scope, label: string }`, owning `formatScope`, the wildcard fallback, and the per-pattern row (contract + fn + method label). The three call sites become one-liners: `<ScopePatternList label="Simulate transactions (and view-calls) in scope:" :scope="capability.transactions.scope" />`, etc.
- **LOC delta:** −60 (≈96 lines of triplicated template collapse into one ~40-line component + 3 short call sites).
- **Risk / tests:** low. Presentation-only, no behavior change. Covered by `CapabilityDetailPanel.test.ts` and `CapabilityDetailPanel.stories.ts`.
- **Confidence:** high.

### F2 [duplication] `MigrationBarrier.vue` and `AccountIntegrityBarrier.vue` duplicate their entire visual shell

- **Where:** `apps/extension/src/components/AccountIntegrityBarrier.vue:91-129` vs `apps/extension/src/components/MigrationBarrier.vue:157-195`.
- **Evidence:** the `.wrapper` / `.card` / `.title` / `.sub` / `.detail` style-module rules are byte-identical across both files:
  ```css
  /* AccountIntegrityBarrier.vue:91-101 == MigrationBarrier.vue:157-167 */
  .wrapper {
  	position: fixed;
  	inset: 0;
  	display: flex;
  	justify-content: center;
  	align-items: center;
  	background-color: rgba(10, 9, 8, 0.92);
  	z-index: 10000;
  }
  ```
  ```css
  /* AccountIntegrityBarrier.vue:113-118 == MigrationBarrier.vue:179-184 */
  .title {
  	font-family: var(--font-headline);
  	font-weight: 700;
  	font-size: 14px;
  	color: var(--txt-primary);
  }
  ```
  Both components also share the exact same template skeleton: `<Teleport to="body"><div v-if="..." :class="$style.wrapper" data-testid="..."><div :class="$style.card"><Icon/Spinner/> <span title/> <span sub/> ... </div></div></Teleport>`.
- **Refactor:** extract a shared `composite/BarrierOverlay.vue` (Teleport + `.wrapper`/`.card` shell, slots for the icon and body content, a `testId` prop forwarded to the root). Both barriers become thin callers supplying their own icon/copy/actions via slots — the `data-testid` values (`migration-blocked`, `account-integrity-blocked`, etc.) pass straight through the `testId` prop, so e2e selectors are untouched.
- **LOC delta:** −45 (36 duplicated CSS lines + ~15 duplicated template lines collapse into one ~35-line shared shell; MigrationBarrier keeps its extra `.banner`/`.retryBtn` rules locally since AccountIntegrityBarrier doesn't use them).
- **Risk / tests:** low. Covered by `MigrationBarrier.test.ts` (166 lines) and `AccountIntegrityBarrier.test.ts` (144 lines), both of which assert on `data-testid` and visible copy, not internal structure.
- **Confidence:** high.

### F3 [duplication] The activity-card "title-trailing chip" CSS/markup is copy-pasted across 4 sibling cards

- **Where:** `apps/extension/src/components/composite/activity/TransactionAwaitingCard.vue:146-168` (`.title_sep`, `.transfer_chip`), `TransactionTerminalCard.vue:100-118` (`.title_sep`, `.chip`), `TransactionIncomingCard.vue:78-96` (`.title_sep`, `.chip`), and `apps/extension/src/popup/components/modules/activity/TransactionCard.vue:242-257` (`.title_sep`, `.chip` — outside this cluster, but the same fix touches it).
- **Evidence:** `.title_sep` is byte-identical in all four files:
  ```css
  .title_sep {
  	font-family: var(--font-headline);
  	font-size: 13px;
  	color: var(--nulo-outline);
  	user-select: none;
  }
  ```
  and the chip rule is identical (or near-identical — only the `color` line differs) in all four, e.g. Awaiting's `.transfer_chip` (154-166) vs Incoming's `.chip` (85-96):
  ```css
  .transfer_chip {                      /* Awaiting */
  	flex-shrink: 0; white-space: nowrap;
  	font-family: var(--font-mono); font-size: 8px; text-transform: uppercase;
  	color: var(--nulo-secondary);
  	background: var(--nulo-surface-low);
  	border: 1px solid rgba(74, 70, 63, 0.2);
  	padding: 1px 4px;
  }
  .chip {                                /* Incoming — only `color` differs */
  	...
  	color: var(--green, var(--nulo-accent));
  	...
  }
  ```
  All four templates also repeat the identical `<span :class="$style.title_sep">·</span><span :class="$style.chip">{{ ... }}</span>` pair inside the `#title-trailing` slot of `TransactionCardLayout`.
- **Refactor:** these are all consumers of `TransactionCardLayout`'s generic `title-trailing` slot with the exact same "separator + chip" shape. Add an optional `chipLabel` / `chipColor` prop pair directly to `TransactionCardLayout.vue` (which already owns the layout contract for this card family) so it renders the separator + chip itself when `chipLabel` is set, and delete the slot content + the four duplicated CSS blocks from the individual cards.
- **LOC delta:** −50 (≈13 lines × 4 sites of CSS, plus ≈3 lines × 4 of template, replace with one ~15-line addition to `TransactionCardLayout.vue` and 4 one-line prop bindings).
- **Risk / tests:** low-med (touches the shared layout component all 4 cards render through). Covered by `TransactionCardLayout.test.ts`, `TransactionAwaitingCard.test.ts`, `TransactionTerminalCard.test.ts`, `TransactionIncomingCard.test.ts`, and `TransactionCard.test.ts` (outside cluster).
- **Confidence:** high.

### F4 [dead-code] `FeeJuiceCard.vue` has zero production importers

- **Where:** `apps/extension/src/components/composite/send/FeeJuiceCard.vue` (66 lines).
- **Evidence:** `grep -rn "FeeJuiceCard" apps/ packages/` matches only the component's own `FeeJuiceCard.test.ts`, its own `FeeJuiceCard.stories.ts`, and the auto-generated `apps/extension/src/types/components.d.ts` (which enumerates every SFC in the tree regardless of use, not a real importer). The test file says so itself:
  ```ts
  /**
   * `FeeJuiceCard` is currently a static placeholder (hard-coded "0 FJC",
   * opacity 0.5, pointer-events: none) with no callers in the current
   * codebase. Tests assert the rendered shape only.
   */
  ```
  The component itself is a static stub: `opacity: 0.5; pointer-events: none;` wrapping a hardcoded `0 FJC` `<Text>` with no props, no logic, no service binding.
- **Refactor:** delete `FeeJuiceCard.vue`, `FeeJuiceCard.test.ts`, `FeeJuiceCard.stories.ts`. If the Fee-Juice-balance card is genuinely planned for a future send-flow step, its shell belongs back in version control history, not live as a permanently-disabled stub nothing renders.
- **LOC delta:** −130 (66 component + 47 test + 17 stories).
- **Risk / tests:** low — nothing imports it, so nothing else can regress. The only "test" is the one being deleted.
- **Confidence:** high.

### F5 [duplication] The three import-form composites duplicate section chrome, password-hint logic, and the visibility-toggle button

- **Where:** `apps/extension/src/components/composite/import/ImportMethodPicker.vue:36-50`, `ImportSecretForm.vue:26-32,57,91,129-160`, `ImportFullBackupForm.vue:26-31,97,125,161-185`.
- **Evidence:** `.section_label` is byte-identical in all three files:
  ```css
  .section_label {
  	font-family: var(--font-headline);
  	font-size: 11px;
  	font-weight: 700;
  	text-transform: uppercase;
  	letter-spacing: 0.18em;
  	color: var(--nulo-secondary);
  }
  ```
  `.section`/`.section_last` (same 5-line rule under two class names, and `ImportSecretForm.vue` even declares BOTH names for the identical rule body in the same file, lines 129-134 and 136-141) is repeated 4 times across the family. The password-strength hint is a byte-identical 5-line computed duplicated between `ImportSecretForm.vue:27-32` and `ImportFullBackupForm.vue:26-31`:
  ```js
  const passwordHint = computed(() => {
  	if (!password.value || password.value?.length < 8) return "At least 8 characters"
  	if (password.value !== repeatedPassword.value) return "Passwords don't match"
  	if (password.value?.length > 24) return "Long enough. Don't forget it."
  	return "Strong password"
  })
  ```
  And the password-visibility-toggle button (a `<button tabindex="-1">` wrapping a `MaterialIcon` that flips between `visibility`/`visibility_off`) is repeated 4 times across the two files (`ImportSecretForm.vue:54-65,87-99`, `ImportFullBackupForm.vue:93-106,121-134`) with matching `.visibility_btn` CSS declared separately in each file.
- **Refactor:** (a) move `.section`/`.section_label` into a tiny shared `FormSection` wrapper (or reuse `@nulo/design`'s `SectionLabel` for the label — see F6-adjacent note below) consumed by all three; (b) hoist `passwordHint` into a one-line shared helper (e.g. `@/utils/password-hint.ts`) imported by both forms; (c) extract the visibility-toggle button into a small `PasswordVisibilityToggle.vue` (props: `revealed`, `@toggle`) used via `Input`'s `#suffix` slot in all 4 call sites.
- **LOC delta:** −85 (≈35 lines of CSS duplication + ≈5 lines of duplicated computed + ≈45 lines of duplicated toggle-button markup/CSS, replaced by ~45 lines of shared code across the 3 new/extended pieces plus short call sites).
- **Risk / tests:** low. Covered by `ImportMethodPicker.test.ts`, `ImportSecretForm.test.ts`, `ImportFullBackupForm.test.ts` — all assert on `data-testid` and visible text, not raw CSS class names.
- **Confidence:** high.

### F6 [duplication] Extension's `EmojiGrid` reimplements a concept `@nulo/design` already ships

- **Where:** `apps/extension/src/components/composite/general/EmojiGrid.vue:1-44` vs `packages/design/src/composite/EmojiGrid.vue:1-46`.
- **Evidence:** extension's version takes a raw `emojis: string`, splits it into 3×3 rows itself, and renders via nested `<Flex>`s:
  ```vue
  const rows = computed(() => {
  	const chars = [...props.emojis]
  	return [chars.slice(0, 3), chars.slice(3, 6), chars.slice(6, 9)]
  })
  ```
  Design's version takes pre-split `cells: string[]` plus optional `testId`/`cellTestId`, and renders via CSS grid — built for exactly this "verification grid" use case per its own doc comment. Both consumers in the extension (`apps/extension/src/popup/windows/verify/index.vue:223` and `.../DappSessionVerification.vue:22`) wrap the extension's `EmojiGrid` in an *external* `data-testid` div rather than using per-cell testids, so nothing depends on the extension component's internal structure.
- **Refactor:** replace `apps/extension/src/components/composite/general/EmojiGrid.vue` with `@nulo/design`'s `EmojiGrid`, pre-splitting `[...emojis]` into a flat `cells` array at each of the 2 call sites (a 1-line computed). Requires a small visual pass since sizing/padding differ (48px cells/8px padding vs 56px cells/16px padding) — confirm with the owner whether to match the extension's existing look or adopt the design package's.
- **LOC delta:** −40 (delete the 44-line extension component and its `.test.ts`/`.stories.ts`; add ~2 lines at each of the 2 call sites).
- **Risk / tests:** med (visual size/padding change unless the design component's CSS is parameterized or the extension keeps its own token overrides). Covered by `EmojiGrid.test.ts` (extension) and would need a visual check against `verify/index.vue` and `DappSessionVerification.vue`.
- **Confidence:** med (functionally equivalent; visual parity needs manual confirmation).

### F7 [verbosity] `computeData()` in `logs-csv.ts` re-derives what `formatLogData()` already does

- **Where:** `apps/extension/src/components/JsonViewer/logs-csv.ts:50-58`.
- **Evidence:**
  ```ts
  function computeData(log: LogEntry): string {
  	if (Array.isArray(log.data) && log.data.length) {
  		return log.data
  			.map(formatArg)
  			.filter((x) => x !== undefined)
  			.join(" ")
  	}
  	return formatLogData(log.data)
  }
  ```
  compared to the imported `formatLogData` (`logs-format.ts:44-53`):
  ```ts
  export function formatLogData(data: unknown): string {
  	if (!data) return ""
  	if (Array.isArray(data) && data.length) {
  		return data
  			.map(formatArg)
  			.filter((x) => x !== undefined)
  			.join(" ")
  	}
  	return String(formatArg(data) ?? "")
  }
  ```
  `computeData`'s array branch is a verbatim copy of `formatLogData`'s array branch; the only case it doesn't already delegate to `formatLogData` is one `formatLogData` already handles identically.
- **Refactor:** delete `computeData` entirely; call `formatLogData(log.data)` directly at its one call site (`logs-csv.ts:18`).
- **LOC delta:** −8.
- **Risk / tests:** low. Covered by `logs-format.test.ts` (indirectly, since `formatLogData` is exercised there) — `logs-csv.ts` has no dedicated test in this tree, so add a one-line assertion if one doesn't already cover CSV array-cell formatting.
- **Confidence:** high.

## Not worth it

- **`packages/design/src/ui/Button.vue` (395 lines) and `ui/Input.vue` (415 lines)** — large but each line is a distinct CSS variant or a genuinely distinct input mode (int/number/paste-clamping); no repeated blocks found worth extracting.
- **`packages/design/src/index.ts` exports** — checked every export (`Card`, `Toast`, `BalanceRow`, `DisclaimerTag`, `DripButton`, `Badge`, `Checkbox`, `SubPageHeaderBase`, etc.) against `apps/extension`, `apps/tools`, `apps/landing`, `apps/playground`; all are consumed (several only by `apps/tools/src/components/TokenCard.vue`, which is legitimate — not dead).
- **`apps/extension/src/components/ui/*.stories.ts` files with no matching local `.vue`** (`Badge`, `Checkbox`, `Toggle`, `BrutalistTitle`, `SectionLabel`) — not duplication: `@nulo/design` has no Storybook setup of its own, so the extension app is the only home for these components' stories.
- **`ScopeAddress.vue` / `ScopeClassId.vue`** — share a ~17-line CSS shape (`.row`/`.addr` vs `.row`/`.id`) but each carries deliberate, documented, security-relevant JS differences (contact lookup vs no lookup); below the value bar to force into one component.
- **`AmountCard.vue` (461 lines)** — the largest composite in the cluster, but its complexity (dual fiat/token input modes with a frozen-quote guard) is genuinely load-bearing business logic with dense inline rationale, not copy-paste bloat.
- **`Popup/Popup.vue` vs `Popup/PopupCard.vue` vs `composite/FormPopup.vue`** — similar names, distinct responsibilities (modal shell + focus trap vs sliding drawer body vs a form-specific popup composition); no overlapping code found.
- **`JsonViewer/creator.js`'s CodeMirror theme objects** — verbose (~320 lines) but each key is a distinct CSS-in-JS selector for a declarative theme; already has an owner-accepted complexity-baseline directive.
