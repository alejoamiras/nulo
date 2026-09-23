# Cluster K — popup/windows, onboarding, popup shell

## Cluster verdict

The popup-shell coordination code (`popup/*.ts`: boot-session, reconcile-locked-boot, lock-landing, apply-boot-outcome, route-guard, auth-guard, network-switch) is genuinely tight — dense but not duplicative, already split into small pure-function modules with dedicated tests, and reads like the product of a prior complexity pass. The waste is concentrated in two places instead: (1) the **onboarding page family** (`onboarding/pages/*.vue`), where 7 near-identical page shells (hero + bar + CTA + CSS) and two functionally-identical explainer pages (`learn.vue`/`fees.vue`) were built by copy-paste rather than parameterizing one component; and (2) the **execute window** (`popup/windows/execute/`), which has one real logic duplication (the "is this operation's fee embedded" predicate, computed independently in `index.vue` and `OperationCard.vue`) and one verbatim-duplicate template branch (`aztec_simulateTx`/`aztec_profileTx`) that also hides a security-relevant rendering gap for `add_public_authwit` actions inside `simulate_transaction`. The single biggest lever is the onboarding `learn.vue`/`fees.vue` pair — one shared "explainer" component would remove the most lines for the least risk. Rough total removable: **350–450 LOC** across the cluster, essentially all from templates/CSS and one shared predicate, with zero behavior change required.

## Findings

### F1 [duplication] `learn.vue` and `fees.vue` are the same page with different copy
- **Where:** `apps/extension/src/onboarding/pages/learn.vue:1-155`, `apps/extension/src/onboarding/pages/fees.vue:1-153`
- **Evidence:** `<style module>` blocks are byte-identical except one comment character:
  ```
  diff <(sed -n '/<style/,/<\/style>/p' learn.vue) <(sed -n '/<style/,/<\/style>/p' fees.vue)
  23c23
  <  * ~130 px — too cramped for the existing card copy. Container query (not
  ---
  >  * ~130 px, too cramped for the existing card copy. Container query (not
  ```
  Templates differ only in `StepIndicator :current`, `BrutalistTitle` text, the description line, the two `data-testid`s, and one comment:
  ```
  diff <(sed -n '/<template/,/<\/template>/p' learn.vue) <(sed -n '/<template/,/<\/template>/p' fees.vue)
  3c3
  < 		<StepIndicator :current="2" />
  ---
  > 		<StepIndicator :current="3" />
  5c5
  < 			<BrutalistTitle main="Meet" sub="Aztec" />
  ---
  > 			<BrutalistTitle main="Fees on" sub="Aztec" />
  ...
  ```
  The `cards` data array (`{number, title, body}` × 3) and the 3-column `.grid`/`.card`/container-query CSS are identical structures with only string content differing. Both also route via `goContinue`/`goSkip` free functions with the same shape.
- **Refactor:** Extract a shared `OnboardingExplainer.vue` in `apps/extension/src/onboarding/components/` (same layer as the existing `OnboardingPage.vue`/`StepIndicator.vue`) taking props `step: 1|2|3|4|5`, `titleMain`, `titleSub`, `subtitle`, `cards: {number,title,body}[]`, `continueTo`, `skipTo`, `continueTestid`, `skipTestid`, `gap` (both pass 40). It owns the `<OnboardingPage>` + `StepIndicator` + hero + grid + actions markup and the entire style block (including the container query). `learn.vue` and `fees.vue` become ~20-line data-only wrappers. Preserve every `data-testid` verbatim by passing them as props (`onboarding-learn-continue`/`onboarding-learn-skip` vs `onboarding-fees-continue`/`onboarding-fees-skip`) rather than hardcoding in the shared component.
- **LOC delta:** -180 (two ~155-line files → one ~110-line component + two ~25-line wrappers).
- **Risk / tests:** low. No component tests exist for these two pages (L4/L5/L6 pages are "not required" coverage per CLAUDE.md); the extension smoke e2e suite drives onboarding, so `bun run test:e2e` and the onboarding step in `tests/e2e/` would catch any testid/route regression.
- **Confidence:** high.

### F2 [duplication] Fee-embedded predicate computed independently in two files
- **Where:** `apps/extension/src/popup/windows/execute/index.vue:295-311` (inside `buildOperationsFromPayload`'s `aztec_sendTx` case) and `:322-329` (`send_transaction` case); `apps/extension/src/popup/windows/execute/OperationCard.vue:73-78` (`hasEmbeddedFee`)
- **Evidence:** index.vue, `aztec_sendTx`:
  ```ts
  const isNoFrom = op.executionMode === "default_entrypoint"
  const embedded = isNoFrom || (op.exec.feePayer !== undefined && !isSelfPay(op.exec, op.opts?.from))
  ...
  feeSettings: embedded ? { paymentMethod: { kind: "embedded" } } : undefined,
  ```
  index.vue, `send_transaction`:
  ```ts
  feeSettings: op.fee?.embeddedFeePayment !== undefined ? { paymentMethod: { kind: "embedded" } } : undefined,
  ```
  OperationCard.vue:
  ```ts
  const hasEmbeddedFee = (op: SendLikeUIOp): boolean => {
      if (op.kind === "send_transaction") return op.fee?.embeddedFeePayment !== undefined
      if (op.kind === "aztec_sendTx")
          return op.executionMode === "default_entrypoint" || (op.exec?.feePayer !== undefined && !isSelfPay(op.exec, op.opts?.from))
      return false
  }
  ```
  Both branches of `hasEmbeddedFee` are exactly the same boolean expressions index.vue already computed to decide whether to pre-fill `feeSettings`. Today they agree, but nothing enforces that a future change to one side (e.g. a new fee-embedding case) is mirrored in the other — the two are the same policy decision ("does this op's fee come pre-set from the dApp") expressed twice, one driving what gets stored on the draft op, the other driving whether the card shows the "set by app" badge vs the live `FeeSettingsCard`.
- **Refactor:** Add `isEmbeddedFeePayment(op: DraftOperation): boolean` to `apps/extension/src/popup/windows/execute/operation-validation.ts` (or a new colocated `fee-detection.ts` if the re-export shim there stays thin), or push it down to `@nulo/wallet-bridge` beside `requiresFeeSelection`/`assertExecutableOperation` (same file already houses the sibling draft/executable narrowing — see `types.ts`'s own note that those moved down "so the dApp-interaction materializer can share the SAME draft→executable narrowing the popup uses"). Call it from both `buildOperationsFromPayload` and `OperationCard.hasEmbeddedFee`.
- **LOC delta:** -10 net (removes the duplicated boolean logic; adds one 6-line shared function).
- **Risk / tests:** low. Covered by `apps/extension/src/popup/windows/execute/OperationCard.selfpay.test.ts` (badge visibility) and `index.test.ts:696` (`feeSettings` pre-fill assertion) — both would catch a behavioral drift from the merge.
- **Confidence:** high.

### F3 [duplication+inconsistency] `aztec_simulateTx`/`aztec_profileTx` render identically, and the shared payload-row logic under-renders `add_public_authwit` for `simulate_transaction`
- **Where:** `apps/extension/src/popup/windows/execute/OperationCard.vue:396-415` (`aztec_simulateTx`), `:428-447` (`aztec_profileTx`); the `simulate_transaction` branch at `:337-361` vs the `send_transaction` payload loop at `:115-172`
- **Evidence:** the two `v-else-if` blocks are byte-for-byte identical apart from the discriminant:
  ```
  diff <(sed -n '396,415p' OperationCard.vue) <(sed -n '428,447p' OperationCard.vue)
  1c1
  < 		<template v-else-if="op.kind === 'aztec_simulateTx'">
  ---
  > 		<template v-else-if="op.kind === 'aztec_profileTx'">
  ```
  (18 identical lines otherwise). Separately, `send_transaction`'s payload loop (over `op.actions: Action[]`, `packages/wallet-bridge/src/operation.ts:81-88`) handles `call`/`encoded_call`/`add_public_authwit`/fallback; `simulate_transaction`'s loop (`:337-361`) shares the exact same `op.actions: Action[]` type (`operation.ts:90-97`) but only handles `call`/`encoded_call`/fallback — an `add_public_authwit` action inside a `simulate_transaction` payload falls through to the generic `{{ action.kind.replace("_", " ") }}` label instead of the rich spender/contract/method/args rendering that the code comments say exists specifically "so the user SEES who they are authorizing" (audit F2, pinned by `OperationCard.authwit.test.ts`, which only exercises `send_transaction`).
- **Refactor:** (a) Merge the two identical branches into one: `v-else-if="op.kind === 'aztec_simulateTx' || op.kind === 'aztec_profileTx'"`. (b) Extract the action-row rendering (the `v-for` over `actions`/`exec.calls` with the `call`/`encoded_call`/`add_public_authwit`/fallback branches) into a small sub-component, e.g. `ActionPayloadRow.vue` colocated in `popup/windows/execute/`, and use it from both the `send_transaction` and `simulate_transaction` branches so `add_public_authwit` gets the same anti-phishing detail regardless of which op kind carries it.
- **LOC delta:** -19 (merge) additionally **-25 / +40** for the extraction (net roughly neutral LOC, but closes the rendering gap) — combined estimate **-25**.
- **Risk / tests:** med — the merge itself (a) is risk-free; the extraction (b) changes `simulate_transaction`'s rendered output for a currently-mishandled action kind, which is a behavior change, not just a refactor. `OperationCard.authwit.test.ts` covers `send_transaction`; add one `simulate_transaction` case to the same file when doing (b).
- **Confidence:** high for (a); medium for (b) (a real behavioral change, flagged for the security angle rather than proposed as a silent refactor).

### F4 [duplication] Onboarding "hero" scaffold copy-pasted across 7 pages
- **Where:** `apps/extension/src/onboarding/pages/{welcome,create,import,learn,fees,accelerator,done}.vue` — hero markup + `.hero`/`.hero_bar` CSS in each: welcome.vue:23-25/65-73, create.vue:117-120/254-263, import.vue:141-145/302-313, learn.vue:40-42/81-90, fees.vue:41-43/79-88, accelerator.vue:72-74/161-170, done.vue:73-75/113-125.
- **Evidence:** every page repeats
  ```vue
  <Flex direction="column" [align="center"] gap="16" :class="$style.hero">
      <BrutalistTitle main="..." sub="..." [align="center"] [size="hero"] />
      <div :class="$style.hero_bar" />
      <!-- optional trailing Text -->
  </Flex>
  ```
  with matching CSS
  ```css
  .hero_bar {
      width: 40px|56px;
      height: 2px;
      background: var(--nulo-accent);
      [margin-top: 12px]
  }
  ```
  (confirmed via `grep -n "hero_bar" onboarding/pages/*.vue` — all 7 files match). `.hero { padding: ... }` varies per page but each variance is a single deliberate value (done.vue even carries a comment justifying its own padding tweak).
- **Refactor:** Extract `OnboardingHero.vue` (in `onboarding/components/`, alongside `OnboardingPage.vue`) with props `main`, `sub`, `align?`, `size?`, `barWidth?` (default 40), and a `padding` passthrough (string, so done.vue/welcome.vue keep their documented exceptions), plus a default slot for trailing `<Text>` lines (subhead/tagline/description). Each page replaces its `<Flex ... class="hero">…</Flex>` block + its own `.hero`/`.hero_bar` rules with one `<OnboardingHero>` call.
- **LOC delta:** -90 (7 sites × ~13 lines template+CSS each ≈ 91, minus one ~35-line shared component ≈ net -90, offset by ~7 lines of prop-passing per call site — conservatively -70 to -90).
- **Risk / tests:** low. `OnboardingPage.test.ts`/`StepIndicator.test.ts` exist as the pattern to follow for a new `OnboardingHero.test.ts`; e2e smoke (`bun run test:e2e`) drives the onboarding flow visually.
- **Confidence:** high.

### F5 [duplication] Profile-name input field byte-identical between `create.vue` and `import.vue`
- **Where:** `apps/extension/src/onboarding/pages/create.vue:123-142`, `apps/extension/src/onboarding/pages/import.vue:147-166`
- **Evidence:** `diff` of the two blocks is empty except indentation:
  ```vue
  <Flex direction="column" gap="8">
      <Text size="11" weight="700" color="secondary" :class="$style.section_label">Profile name</Text>
      <div :class="[shakeName && $style.shake]">
          <Input ref="nameInputRef" v-model="profileName" type="text" placeholder="My Profile" :maxLength="32"
                 :error="!!nameError" :ariaInvalid="!!nameError" sanitize
                 data-testid="onboarding-name-input" @input="handleNameInput" />
      </div>
      <Text v-if="nameError" size="12" color="red" height="150" role="alert">{{ nameError }}</Text>
  </Flex>
  ```
  Both pages also destructure the identical `{ profileName, nameError, shakeName, nameInputRef, handleNameInput }` from their respective flow composables (`useProfileCreateFlow`/`useProfileImportFlow`), so the field is driven by the same shape on both sides. The `.shake`/`@keyframes shakeInput` CSS (12 lines) and `.section_label` CSS (differs only in property order) are also duplicated between the two files.
- **Refactor:** Extract `OnboardingProfileNameField.vue` in `onboarding/components/`, taking `v-model:profileName`, `nameError`, `shakeName`, exposing `nameInputRef` via `defineExpose` (or accepting a `ref` prop), and owning the `.shake`/`@keyframes shakeInput`/`.section_label` styles. Both pages replace the 20-line block with one component call. `data-testid="onboarding-name-input"` moves into the component unchanged.
- **LOC delta:** -45 (20+12+5 lines removed per site × 2 ≈ 74, minus one ~30-line component).
- **Risk / tests:** low. `apps/extension/src/onboarding/components/OnboardingPage.test.ts` shows the existing testing pattern for onboarding components; no dedicated unit test currently pins this field, so add a short one alongside the extraction.
- **Confidence:** high.

### F6 [duplication] "Back" link + `.back` CSS duplicated between `create.vue` and `import.vue`
- **Where:** `apps/extension/src/onboarding/pages/create.vue:107-115/229-252`, `apps/extension/src/onboarding/pages/import.vue:131-139/277-300`
- **Evidence:** template:
  ```vue
  <button type="button" :class="$style.back" data-testid="onboarding-{create,import}-back" @click="router.push('/onboarding/welcome')">
      <MaterialIcon name="chevron_left" :size="14" />
      <span>Back</span>
  </button>
  ```
  and the `.back`/`.back:hover`/`.back:focus-visible` CSS block (21 lines) is byte-identical (`diff` empty) between the two files.
- **Refactor:** Extract `OnboardingBackLink.vue` (or fold into a `to` prop on the same component if F4/F5 land first) taking a `testid` prop and owning the CSS. Both pages replace ~9 template lines + 21 CSS lines with one call.
- **LOC delta:** -40 (2 × ~29 lines removed, minus one ~18-line component).
- **Risk / tests:** low. e2e smoke covers `onboarding-create-back`/`onboarding-import-back` click targets if present; testids are preserved verbatim.
- **Confidence:** high.

### F7 [duplication] `.skipLink` CSS block duplicated verbatim 3×
- **Where:** `apps/extension/src/onboarding/pages/learn.vue:132-153`, `apps/extension/src/onboarding/pages/fees.vue:130-151`, `apps/extension/src/onboarding/pages/accelerator.vue:289-310`
- **Evidence:** the 22-line `.skipLink`/`.skipLink:hover`/`.skipLink:focus-visible` block is byte-identical across all three files (verified via `diff`). Subsumed by F1's extraction for learn/fees; accelerator.vue's copy is the third occurrence.
- **Refactor:** If F1 lands, this collapses to 2 sites (the shared `OnboardingExplainer` + `accelerator.vue`) — move `.skipLink` into a shared onboarding stylesheet or a small `OnboardingSkipLink.vue` used by all three (accelerator.vue's skip is a `<button>` with different click handler/label, so a component with a default slot for the label text covers it).
- **LOC delta:** -25 (folds into F1's count for 2 of the 3 sites; ~-6 additional once accelerator.vue also adopts the shared piece).
- **Risk / tests:** low.
- **Confidence:** high.

### F8 [duplication] `verify/index.vue` reimplements `DappIdentityBlock` inline instead of reusing it
- **Where:** `apps/extension/src/popup/windows/verify/index.vue:56-71` (script), `:193-216` (template), `:267-325` (style); shared component at `apps/extension/src/components/composite/DappIdentityBlock.vue`
- **Evidence:** `DappIdentityBlock.vue`'s own doc comment says it is "shared by the three dApp interaction windows" (execute, capabilities, discover), but `verify/index.vue` — the fourth dApp-interaction window (post-connection verification) — reimplements the identical hostname-sanitization computed (`sanitizedDappName`/`sanitizedName`), the identical `dapp_block`/`dapp_logo_wrapper`/`dapp_logo`/`dapp_info`/`dapp_hostname`/`dapp_name`/`dapp_action` template structure, and the identical CSS for all seven classes (diffed line-for-line against `DappIdentityBlock.vue` — same property values, same order). `execute/index.vue` and `capabilities/index.vue` both already consume `<DappIdentityBlock :dapp :hostname :hostnameSuspicious actionLabel />` instead.
- **Refactor:** Replace verify's inline block (script + template + ~58 lines of CSS) with `<DappIdentityBlock :dapp="dapp" :hostname="dappHostname" :hostnameSuspicious="hostnameHasNonAscii" :actionLabel="isReconnect ? 'Reconnected' : 'Connection established'" />`. Note: `DappIdentityBlock` renders `actionLabel` as a single trailing line same as verify's `.dapp_action`, so the mapping is direct; `sanitizeWireString`-based name sanitization moves into the shared component (already there). No `hostnameTestId`/`nameTestId` were set in verify's version, so passing none preserves current (absent) testids.
- **LOC delta:** -85 (removes ~15 lines script + ~24 lines template + ~58 lines CSS, replaced by one 6-line component call).
- **Risk / tests:** low-med. No dedicated component test exists for `verify/index.vue`; check for e2e coverage of the verify window (`verify-emoji-grid`, `verify-confirm-btn` testids) before landing — those testids are untouched by this change since they live outside the identity block.
- **Confidence:** high.

### F9 [duplication] Approval-window CSS shell (`wrapper`/`scroll_area`) repeated across 4 windows
- **Where:** `apps/extension/src/popup/windows/execute/index.vue:586-604`, `apps/extension/src/popup/windows/capabilities/index.vue:426-444`, `apps/extension/src/popup/windows/discover/index.vue:185-203`, `apps/extension/src/popup/windows/verify/index.vue:248-265`
- **Evidence:** all four define
  ```css
  .wrapper { overflow: hidden; flex: 1; display: flex; flex-direction: column; background: var(--app-bg); border-top: 2px solid var(--nulo-accent); }
  .scroll_area { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
  ```
  (verify's `.wrapper` has the same two declarations in swapped order — CSS-identical) plus each has its own `.sections`/`.body` padding wrapper (`padding: 16px`). The outer template shape (`<Flex v-if="appStore.isLogined" direction="column" class="wrapper">` → strip + `<Flex direction="column" class="scroll_area">` → identity block + sections → footer) is likewise repeated in execute/capabilities/discover.
- **Refactor:** Extract an `ApprovalWindowShell.vue` composite (in `components/composite/`, alongside `DappIdentityBlock.vue`/`DappStatusStrip.vue`/`DappApprovalFooter.vue`, which these same 3-4 windows already share) that owns the `wrapper`/`scroll_area` CSS and takes default + named slots for the strip/identity/body/footer. `verify/index.vue` (which has a materially different footer/strip) can adopt only the CSS portion.
- **LOC delta:** -50 (4 × ~15 lines CSS ≈ 60, minus one ~20-line shared shell).
- **Risk / tests:** low — pure layout CSS; `apps/extension/tests/e2e` smoke suite exercises all four windows visually.
- **Confidence:** med (template-level extraction is more invasive than the CSS-only version; recommend doing CSS-only first).

### F10 [duplication] `json/index.vue` and `logger/index.vue` are near-identical shells
- **Where:** `apps/extension/src/popup/windows/json/index.vue:12-27/60-83`, `apps/extension/src/popup/windows/logger/index.vue:9-26/57-80`
- **Evidence:** `<style module>` blocks are byte-identical (17 lines: `body`, `.wrapper`, `.json_viewer`). The `onActiveProfileChanged` close-on-logout helper is byte-identical:
  ```js
  function onActiveProfileChanged(profile) {
      if (!profile) {
          chrome.windows.getCurrent((window) => {
              chrome.windows.remove(window.id)
          })
      }
  }
  ```
  (json/index.vue:16-22, logger/index.vue:12-18).
- **Refactor:** Move the CSS into a shared class (or a tiny `AuxWindowShell.vue`) and the close-helper into a one-line composable (`useCloseOnLogout()` in `src/composables/`) that both windows call. Given the low absolute size, bundling this with F9's shell extraction is more economical than a standalone change.
- **LOC delta:** -25 (17+6 lines × 2 ≈ 46, minus one ~20-line shared piece).
- **Risk / tests:** low.
- **Confidence:** med (small enough that a reviewer could reasonably decline it standalone; only worth doing alongside F9).

### F11 [duplication] Console-forwarding + unhandled-rejection boilerplate duplicated between `popup/index.ts` and `onboarding/index.ts`
- **Where:** `apps/extension/src/popup/index.ts:1-24`, `apps/extension/src/onboarding/index.ts:8-28`
- **Evidence:**
  ```ts
  const logger = new LoggerServiceClient("popup" /* or "onboarding" */)
  for (const [method, level] of consoleMethods) {
      ;(self as any)[`on${method}`] = (...args: any[]) => { logger.log("ui", level, ...args) }
  }
  self.onunhandledrejection = (e: PromiseRejectionEvent) => {
      const level = isClientDisconnectRejection(e.reason) ? LogLevel.Debug : LogLevel.Error
      logger.log("ui", level, getErrorData(e.reason))
  }
  ```
  is identical apart from the client tag string and one comment word ("page" vs "tab"). `onboarding/index.ts`'s own header comment even says it "mirrors popup/index.ts". A third, more-diverged copy exists in `src/offscreen/index.ts` (different tag `"pxe"`, extra benign-disconnect handling) — out of this cluster, not counted in the LOC delta below.
- **Refactor:** Add `initUiLogging(tag: string): LoggerServiceClient` to `src/wallet/logger/` (outside this cluster but the natural shared home, already imported by both sites) that installs the console hijack + `onunhandledrejection` handler and returns the logger. Both `popup/index.ts` and `onboarding/index.ts` become one-line calls.
- **LOC delta:** -20 (2 × ~20 lines → 2 × ~2 lines + one ~15-line helper).
- **Risk / tests:** low — no direct unit test on this boilerplate in either file; covered indirectly by any e2e test that triggers a logged console call.
- **Confidence:** high for the duplication; the extraction site is technically outside this cluster's read scope (`wallet/logger/`), so coordinate with whichever cluster owns it.

## Not worth it

- `pushUniqueAccount` (execute/index.vue) vs `uniqueSignerAccounts` (signers.ts) both dedupe accounts by a composite key but operate on different inputs (accumulate-while-building vs derive-from-built-list) and are each under 10 lines — not worth unifying.
- `operation-validation.ts` is a 9-line re-export shim with a clear rationale comment (avoids an upward import from wallet-bridge); too small to flag as dead weight.
- `build-items.ts`'s two `for` loops (delta vs existingGrants) share an ~8-line `getSafeDisplay`/`getCapabilityInfo` pattern per iteration, but the surrounding fields genuinely differ (`isNew`, `selected`, `reRequested`); under the 15-line bar to justify a merge.
- `CapabilityCard.vue`'s `granted`/`!granted` branches share structural shape (checkbox-vs-icon, label row, description) but diverge in color/interactivity in a way that's meaningfully different UX, not copy-paste — merging would add conditionals rather than remove them.
- `SignerIdentityStrip.vue` (execute) vs verify's inline `signerDisplay`/`signerNetwork` computeds: same three-way branch shape (single/multiple/none signer) but the "no signer" fallback logic differs materially (verify falls back to a raw CAIP-address trim; execute just says "No signer") — not a clean merge.
- The dense popup-shell coordination files (`boot-session.ts`, `reconcile-locked-boot.ts`, `lock-landing.ts`, `apply-boot-outcome.ts`, `route-guard.ts`, `auth-guard.ts`, `network-switch.ts`) were read in full — no duplication found; each is a distinct, already-tested decision core.
