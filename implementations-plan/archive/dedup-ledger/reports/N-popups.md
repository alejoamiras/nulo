# Cluster N — popup dialogs (L5)

Scope: `apps/extension/src/popup/components/popups/*.vue` (29 SFCs) + `apps/extension/src/popup/components/Navigation.vue`. Read all 29 non-test SFCs + Navigation.vue in full.

## Cluster verdict

The cluster already leans on good shared infrastructure — `FormPopup` (L3) + `usePopupEntity`/`useFormState` (C1) cover the show/hide/submit/latch/reset dance for ~15 of the 29 popups, and `ContactFormFields`/`ProcessingErrorNote` are real, working extractions. The duplication that remains is one level down: **the same service-event-subscription boilerplate (add/update/delete → mirror into a local ref array) is hand-rolled independently in at least 9 places** across contacts, FPCs, and token-balances, and **a 5-line "field already invalid/exists" warning template is copy-pasted verbatim 13 times**. There's also a component (`ProcessingErrorNote`) that two popups already adopted but three more re-typed inline instead of importing. None of this is exotic — it's the classic "wrote the same 10-20 lines by hand each time a new popup needed the same wiring" pattern, exactly what the brief describes. Biggest lever: extract the entity-sync composable (F1) and the inline warning-row component (F2) — together they're the highest-count, lowest-risk removal, roughly **150-180 LOC** in this cluster alone (more if applied to the two out-of-cluster call sites the same patterns leak into). Total realistic removable across all findings: **~320-380 LOC**.

## Findings

### F1 [duplication] Hand-rolled add/update/delete event-sync repeated 9× across 3 entity types

**Where:**
- Contacts (identical `onContactAdded/onContactUpdated/onContactDeleted` triple): `NewContactPopup.vue:36-49`, `EditContactPopup.vue:38-62` (adds one extra branch), `ImportContactsPopup.vue:29-46`. A 4th copy lives outside the cluster at `apps/extension/src/popup/pages/send.vue:154-171` (byte-identical to `NewContactPopup.vue`'s).
- FPCs (`onFpcAdded/onFpcUpdated/onFpcDeleted`): `NewFpcPopup.vue:88-98`, `EditFpcPopup.vue:134-151`, `SelectFpcPopup.vue:77-87`.
- Token balances (`onTokenBalanceAdded/Updated/Deleted`): `SelectBalanceTypePopup.vue:50-70`. A near-identical copy is outside the cluster at `apps/extension/src/popup/components/modules/general/BalanceView.vue:153-168`.

**Evidence** (contacts — `NewContactPopup.vue:36-49` vs `send.vue:158-171`, byte-identical):
```js
function onContactAdded(contact) {
	contacts.value.push(contact)
}
function onContactUpdated(contact) {
	const idx = contacts.value.findIndex((c) => c.id === contact.id)
	if (idx !== -1) {
		contacts.value[idx] = contact
	} else {
		contacts.value.push(contact)
	}
}
function onContactDeleted(contact) {
	contacts.value = contacts.value.filter((c) => c.id !== contact.id)
}
```
(FPCs — `NewFpcPopup.vue:88-98` vs `SelectFpcPopup.vue:77-87`, same shape, minus a `prepareFpc` decorator on the Select side.)

**Refactor:** Extract a C1 composable `useEntityCollectionSync(service, events, list, opts?)` in `apps/extension/src/composables/useEntityCollectionSync.ts`. It takes an already-constructed (not yet necessarily connected) service instance, the three `EventHandler` properties to subscribe to, and the target ref array; it does NOT call `.connect()`/`.disconnect()` itself (caller keeps owning that, per the C1 contract). An `upsertOnMissingUpdate: boolean` option covers the contacts/tokens "push if not found" variant vs the FPC/balance "no-op if not found" variant. Each of the 6 in-cluster call sites collapses from 8-25 lines to 1-3 lines (register + optional key comparator). `EditContactPopup`'s extra "external update to the contact being edited" branch (lines 44-54) stays as a small additional `watch`/callback layered on top, not lost.

**LOC delta:** approx. `-90` in-cluster (contacts: 3 sites ≈ -35; FPCs: 3 sites ≈ -30; balances: 1 site ≈ -15) plus a new ~35-line composable ⇒ net **≈ -55 to -70** in-cluster; a further ≈ -25 if `send.vue` and `BalanceView.vue` are migrated too (out of cluster scope but the same win).

**Risk / tests:** low — pure mechanical extraction of already-tested wiring. Covered by `EditContactPopup.test.ts`, `NewContactPopup.test.ts`, `ImportContactsPopup.test.ts`, `EditFpcPopup.test.ts`, `NewFpcPopup.test.ts`. No `data-testid` involved.

**Confidence:** high.

### F2 [duplication] The "field already exists/invalid" warning row is copy-pasted 13×

**Where:** `NewEndpointPopup.vue:114-118`, `EditEndpointPopup.vue:126-130`, `NewFpcPopup.vue:152-157` and `:169-174`, `EditFpcPopup.vue:250-255` and `:268-273`, `NewAccountPopup.vue:134-139`, `EditNetworkPopup.vue:126-131`, `NewNetworkPopup.vue:170-176` and `:187-196`, `NewSenderPopup.vue:114-119`, `EditProfilePopup.vue:151-160`.

**Evidence** (`NewAccountPopup.vue:135-138`):
```html
<Flex v-if="isAlreadyExist" align="center" gap="6">
	<Icon name="warning" size="12" color="red" />
	<Text size="12" weight="600" color="primary"> Already exist </Text>
</Flex>
```
(`EditNetworkPopup.vue:127-130`, same shape, different copy):
```html
<Flex v-if="isNameAlreadyExist" align="center" gap="6">
	<Icon name="warning" size="12" color="red" />
	<Text size="12" weight="600" color="primary"> Already exists </Text>
</Flex>
```
Every occurrence sits inside an `<Input>`'s `#right` slot, wrapped in `<Transition name="fade">`, with the same `align="center" gap="6"` / `size="12" weight="600" color="red|primary"` styling.

**Refactor:** New L2 primitive, e.g. `apps/extension/src/components/ui/FieldWarning.vue` (or add to `@nulo/design/ui` if the owner wants it shared with `apps/tools`): props `show: Boolean`, `text: String`, renders the `Transition` + `Flex` + `Icon` + `Text`. Callers become `<FieldWarning :show="isAlreadyExist" text="Already exist" />` inside `#right`. `NewNetworkPopup.vue`'s two-branch case (`isUrlHasError` / `isUrlAlreadyExist`) becomes two sibling `FieldWarning`s or a `text` computed.

**LOC delta:** 13 sites × ~4 lines saved (5-line block → 1 line) ≈ `-52`, plus a ~15-line new component ⇒ **≈ -37** net, growing as new popups adopt it instead of copy-pasting again.

**Risk / tests:** low — purely presentational, no `data-testid` on any of these warning rows (verified by grep — none carry `data-testid`), so nothing to preserve there. Covered by each popup's existing component test (`NewAccountPopup.test.ts`, `EditFpcPopup.test.ts`, `NewFpcPopup.test.ts`, `NewNetworkPopup.test.ts`, `EditProfilePopup.test.ts`).

**Confidence:** high.

### F3 [duplication/inconsistency] `ProcessingErrorNote` exists but is re-typed inline 3 more times

**Where:** shared component at `apps/extension/src/popup/components/modules/settings/contacts/ProcessingErrorNote.vue` (used correctly by `EditContactPopup.vue` and `NewContactPopup.vue`). Reimplemented inline at `EditFpcPopup.vue:277-298` (22 lines), `NewFpcPopup.vue:178-207` (30 lines), `NewSenderPopup.vue:124-150` (27 lines).

**Evidence** (`ProcessingErrorNote.vue:16-42`, the canonical shape):
```html
<Transition name="fade">
	<Tooltip v-if="show" side="top" position="start" wide :disabled="!tooltip" :style="{ marginTop: '-12px' }">
		<Flex align="center" wide>
			<Icon name="info" size="14" color="primary" />
			<Text size="12" weight="600" color="secondary" :style="{ paddingLeft: '4px' }">{{ title }}</Text>
		</Flex>
		<template #content><Text size="12" color="secondary">{{ tooltip }}</Text></template>
	</Tooltip>
</Transition>
```
vs `NewFpcPopup.vue:180-206` — same structure, hand-copied, plus a dead branch:
```html
<Icon name="info" size="14" :color="processingError.type === 'warning' ? 'orange' : 'red'" />
```
`processingError.type` is never assigned anywhere in `NewFpcPopup.vue` (`processingError.value` is always `{ show, title, tooltip }`), so this ternary is always `'red'` — a dead conditional.

**Refactor:** Move `ProcessingErrorNote` out of `modules/settings/contacts/` to a neutral location it can be imported from generically (e.g. `src/components/composite/` per the L3 rule, since it's already service-agnostic), and switch `EditFpcPopup`, `NewFpcPopup`, `NewSenderPopup` to use it. Drop the dead `processingError.type` branch in `NewFpcPopup.vue`. Note the icon color differs (component uses `primary`, all three inline copies hard-code `red`) — either add a `color` prop or standardize on one; that's a one-line decision, not a blocker.

**LOC delta:** 3 sites × ~20 lines avg → ~3 lines each ⇒ **≈ -60**.

**Risk / tests:** low-med — moving the component's file path touches its own unit test's import; the three consuming popups' `.test.ts` files assert on rendered text/tooltip content, which is preserved. Med only because of the file move; a same-directory re-export shim avoids even that if preferred.

**Confidence:** high.

### F4 [duplication] `EditEndpointPopup` ↔ `NewEndpointPopup`: identical error classifier + form fields

**Where:** `EditEndpointPopup.vue:66-80` (error mapping) and `:107-132` (Input fields); `NewEndpointPopup.vue:51-65` and `:95-120`.

**Evidence** (`EditEndpointPopup.vue:66-76`):
```js
} catch (err) {
	const msg = err instanceof Error ? err.message : String(err)
	if (msg.includes("ENDPOINT_CHAIN_MISMATCH")) {
		errorText.value = `Wrong chain — this network is chain ${network.value.chainId}.`
	} else if (msg.includes("DUPLICATE_ENDPOINT")) {
		errorText.value = "Another endpoint of this network uses that URL."
	} else if (msg === "Failed to fetch node info") {
		errorText.value = "RPC didn't respond. Check the URL."
	} else {
```
vs `NewEndpointPopup.vue:52-59` — same branches, same order, only the `DUPLICATE_ENDPOINT` copy differs ("This URL is already an endpoint of this network."). The two `<Input label="Label…">` / `<Input label="RPC URL">` template blocks (26 lines each) are identical apart from placeholder/label text and `autofocus` placement.

**Refactor:** Extract `classifyEndpointError(err, network): string` into `apps/extension/src/popup/utils/` (pure function, colocated helper per the C0/pure-helper rule — no Vue reactivity involved) and call it from both `catch` blocks. Extract the two `<Input>` blocks into a small `EndpointFormFields.vue` (mirrors `ContactFormFields.vue`'s role) taking `v-model:label`/`v-model:url` + an `error` prop, used by both popups the same way `ContactFormFields` unifies `NewContactPopup`/`EditContactPopup`.

**LOC delta:** ≈ `-15` (error classifier) + `≈ -35` (form fields component, 2×26 lines → 2×3 lines + ~20-line component) ⇒ **≈ -50**.

**Risk / tests:** low — both popups have no dedicated `.test.ts` in this cluster listing (verify before merging: `grep -l EditEndpointPopup apps/extension/**/*.test.ts`); e2e smoke covers the settings→network→endpoint flow. Flag as med if no unit coverage exists — confirm via `apps/extension/tests/e2e` before landing.

**Confidence:** high on the duplication; med on the "no unit test" claim (not exhaustively verified beyond this cluster's file listing, which shows no `EditEndpointPopup.test.ts`/`NewEndpointPopup.test.ts`).

### F5 [duplication] `ChangeAuthwitsRegistryPopup` ↔ `RevokeAuthwitsPopup`: registry-status fetch/watch/keydown scaffold

**Where:** `ChangeAuthwitsRegistryPopup.vue:28-58` and `:98-115`; `RevokeAuthwitsPopup.vue:30-62` and `:149-171`.

**Evidence** (`ChangeAuthwitsRegistryPopup.vue:28-40`):
```js
const authwitsService = new AuthRegistryServiceClient()
authwitsService.onRegistryEnabled.add(onRegistryEnabled)
authwitsService.onRegistryDisabled.add(onRegistryDisabled)
function onRegistryEnabled(account) {
	if (appStore.account?.address === account) {
		isRegistryEnabled.value = true
	}
}
function onRegistryDisabled(account) {
	if (appStore.account?.address === account) {
		isRegistryEnabled.value = false
	}
}
```
identical in `RevokeAuthwitsPopup.vue:30-42`. Both `fetchRegistryStatus()` functions (lines 48-58 / 52-62) are byte-identical, and both `watch(() => props.show, …)` blocks follow the same shape: on show, `await fetchRegistryStatus()` then `document.addEventListener("keydown", onKeydown)`; on hide, reset state + `authwitsService.disconnect()` + `removeEventListener`.

**Refactor:** Extract a small composable `useAuthRegistryStatus(appStore)` (C1 — receives the store, owns the `AuthRegistryServiceClient` internally but exposes `dispose()` for the parent to call, per the C1 contract) returning `{ isRegistryEnabled, isLoading, error, fetchRegistryStatus, dispose }`. Each popup keeps its own `watch(show, …)`/keydown wiring (that part differs meaningfully — Revoke also chunks authwits) but drops the ~20 duplicated setup/fetch lines.

**LOC delta:** ≈ `-20` (2 sites' setup+fetch collapse to ~5 lines each) plus ~25-line composable ⇒ **≈ +5 to -10** net — smaller win than F1-F4, but worth doing alongside F1 since it's the same category of hand-rolled service wiring, and it removes a real correctness-duplication risk (a future bug fix to the registry-status polling would otherwise need to land in two places).

**Risk / tests:** low. Covered by `ChangeAuthwitsRegistryPopup` (no dedicated test file found in this listing) — verify against `RevokeAuthwitsPopup.test.ts` at minimum before merging; that file does exist.

**Confidence:** med (smaller LOC payoff than the others, listed for completeness since jscpd flagged it).

### F6 [duplication] `ConfirmPopup` ↔ `IncomingTrustPopup`: identical CSS block (jscpd-confirmed)

**Where:** `ConfirmPopup.vue:162-178` and `:210-212`; `IncomingTrustPopup.vue:258-271` and `:346-348`.

**Evidence** (`ConfirmPopup.vue:166-178`):
```css
.header {
	padding-top: 4px;
}

.pre_title {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;

	color: var(--nulo-secondary);
}
```
vs `IncomingTrustPopup.vue:261-270` — byte-identical rule bodies (only whitespace/blank-line formatting differs). Both files also share an identical `.title` rule (16px/700/uppercase/`--font-headline`) and an identical `:global([theme="light"]) .pre_title { color: var(--txt-secondary); }` override. Total confirmed identical CSS: `.header`, `.pre_title`, `.title`, the light-theme override — ~30 lines combined across the two files.

**Refactor:** These are both "confirmation-style popup with a pre-title + title header" — the pattern likely recurs as new confirmation popups are added. Pull the four rules into a shared CSS Modules partial (e.g. `apps/extension/src/popup/components/popups/_confirm-header.module.css`, composed via `composes: header from "./_confirm-header.module.css"`), or promote it to a small presentational `<ConfirmHeader>` component (icon + pre-title + title props) since both call sites also share the same `<Flex direction="column" align="center" gap="12"><Icon .../><span class="pre_title">/<h2 class="title">` markup shape, not just the CSS.

**LOC delta:** ≈ `-25` (CSS dedup only) to `-45` (if the markup is componentized too).

**Risk / tests:** low — pure visual, no behavior change. No `data-testid` on any of the affected elements.

**Confidence:** high (this is the exact pair jscpd flagged).

### F7 [duplication] `IncomingTrustPopup`'s `handleAllow`/`handleReject` are a 26-line internal near-clone

**Where:** `IncomingTrustPopup.vue:104-130` (`handleAllow`) vs `:132-149` (`handleReject`).

**Evidence:**
```js
async function handleAllow() {
	if (isSubmitting.value) return
	isSubmitting.value = true
	const myGen = ++submitGeneration
	const symbol = tokenSymbol.value
	const key = payloadKey()
	try {
		const ok = await cacheStore.incomingTrust.allow?.()
		if (ok === true) {
			openToast({ label: `Now showing receives for ${symbol}`, icon: "check" })
		}
	} catch {
		openToast({ label: "Couldn't update trust state", icon: "warning" })
	} finally {
		if (submitGeneration === myGen) isSubmitting.value = false
	}
	if (payloadKey() === key) emit("onClose")
}
```
`handleReject` (lines 132-149) is identical modulo `cacheStore.incomingTrust.reject?.()`, the toast label (`"Hiding receives from ${symbol}"`, `icon: "info"`), and the toast icon.

**Refactor:** Factor into `async function decide(action, successLabel, successIcon)` called as `decide(cacheStore.incomingTrust.allow, \`Now showing receives for ${symbol}\`, "check")` / `decide(cacheStore.incomingTrust.reject, ...)`, or keep two thin wrappers calling one shared `runTrustDecision(fn, toastConfig)`. This is exactly the kind of two-call-site duplication the brief says only merits action when each copy is >20 lines — both copies here are 18 lines, so this sits right at the edge; including it because the surrounding function (the whole `<script setup>`) is dense and the two copies are the single largest reducible chunk in the file.

**LOC delta:** ≈ `-18`.

**Risk / tests:** low-med — this function carries several audit-hardened invariants (submit-generation latch, `payloadKey()` re-check before close) called out in inline comments; a refactor must preserve the exact ordering (capture `key`/`symbol` before await, release latch only if `submitGeneration === myGen`, close only if `payloadKey() === key`). Covered by `IncomingTrustPopup.test.ts` (12KB, looks thorough — race/latch scenarios likely covered).

**Confidence:** med (small absolute size, but the two copies are 90%+ identical and it's the highest-risk file to touch, so flagging precisely what must be preserved has value even if the team decides not to merge it).

### F8 [verbosity] `TokenMetadataPopup`'s 6 capability-flag rows are the same row typed 6 times

**Where:** `TokenMetadataPopup.vue:127-207` (81 lines for 6 rows: `hasPrivateBalances`, `hasPrivateTransfers`, `hasPrivateToPublicTransfers`, `hasPublicBalances`, `hasPublicTransfers`, `hasPublicToPrivateTransfers`).

**Evidence** (one of six, `:127-138`):
```html
<Flex align="center" justify="between">
	<Flex direction="column" gap="6">
		<Text size="12" weight="600" color="tertiary"> Balances </Text>
		<Text size="11" weight="600" color="secondary" mono> hasPrivateBalances </Text>
	</Flex>
	<Icon
		:name="token.hasPrivateBalances ? 'check-circle' : 'close-circle'"
		size="12"
		:color="token.hasPrivateBalances ? 'green' : 'red'"
	/>
</Flex>
```
The other 5 blocks are this exact shape with only the label text and the `token.<key>` swapped.

**Refactor:** Replace with a data table + `v-for`:
```js
const capabilitySections = [
	{ title: "Private Methods", rows: [
		{ label: "Balances", key: "hasPrivateBalances" },
		{ label: "Transfers", key: "hasPrivateTransfers" },
		{ label: "Private to public", key: "hasPrivateToPublicTransfers" },
	]},
	{ title: "Public Methods", rows: [
		{ label: "Balances", key: "hasPublicBalances" },
		{ label: "Transfers", key: "hasPublicTransfers" },
		{ label: "Public to private", key: "hasPublicToPrivateTransfers" },
	]},
]
```
then one `<template v-for="section in capabilitySections">…<template v-for="row in section.rows">` block using `token[row.key]`. While touching this file, also fix the hand-rolled `token.contract.slice(0, 6)` / `.slice(-4)` (lines 83/85) to use `trimAddress` from `@/utils/string` (already imported and used correctly by `AccountsPopup.vue`, `ImportContactsPopup.vue`, `IncomingTrustPopup.vue` — `ReceivePopup.vue:69,71` has the same hand-rolled slice and should get the same fix, though it's only 2 sites so not a standalone finding).

**LOC delta:** 81 lines of repeated markup → ~15 lines of data + ~20 lines of `v-for` template ⇒ **≈ -45**.

**Risk / tests:** low — purely presentational restructuring, no `data-testid` on these rows to preserve (verified: none of the 6 blocks carry one). No dedicated `.test.ts` for `TokenMetadataPopup` in this cluster's file listing — verify with e2e/settings→token-detail smoke coverage before merging.

**Confidence:** high.

### F9 [duplication] Hand-rolled "clickable list row" CSS repeated 4× instead of a shared class

**Where:** `SelectFpcPopup.vue:190-212` (`.fpc`), `SelectNetworksPopup.vue:123-140` (`.network`), `SelectBalanceTypePopup.vue:227-244` (`.card`), `ImportContactsPopup.vue:277-297` (`.contact`).

**Evidence** (`SelectNetworksPopup.vue:123-135`):
```css
.network {
	border-radius: 0;
	cursor: pointer;
	border: 1px solid var(--nulo-border);
	padding: 12px;
	transition: all 0.2s var(--bezier);
	&:hover {
		background: var(--nulo-surface-low);
		border: 1px solid var(--nulo-outline);
	}
	&:active {
		background: var(--nulo-surface-high);
	}
}
```
`SelectFpcPopup.vue:190-212`'s `.fpc` and `SelectBalanceTypePopup.vue:227-244`'s `.card` are the same rule set (differing only in `padding`/`min-height`); `ImportContactsPopup.vue:277-297`'s `.contact` adds one nested `& .icons { opacity: 1 }` line on hover, otherwise identical.

**Refactor:** These are all CSS Modules-scoped, so a literal shared class needs `composes:` from a common partial (e.g. `apps/extension/src/popup/components/popups/_row.module.css` with a `.clickableRow` rule), then each file does `composes: clickableRow from "./_row.module.css";` on its own class name to keep per-popup padding overrides. Alternatively push it into `@nulo/design` as a low-level utility if the tools app has the same pattern (not verified — out of scope for this cluster).

**LOC delta:** ≈ `-30` (4×~10 duplicated lines → 1 shared ~10-line partial + 4×1-line `composes`).

**Risk / tests:** low — visual only.

**Confidence:** med (CSS Modules `composes:` changes are mechanical but worth a visual smoke-check across all 4 popups before merging).

## Not worth it

- **`PopupManager.vue`'s incoming-trust queue** (lines 44-316) looks dense but is single-purpose, heavily audit-hardened orchestration (dedup, replay, stale-triple races) — not duplicated anywhere else in the cluster; leave it alone.
- **`FormPopup`/`usePopupEntity`/`useFormState` adoption** across ~15 popups is the intended abstraction working as designed, not a duplication smell.
- **`AccountsPopup.vue:3`** imports `AccountType` and never uses it — real dead code, but only 1 line, well under the ≥20-line bar.
- **`ReceivePopup.vue:69,71`** hand-rolls the same address-slice `TokenMetadataPopup.vue` does, but only 2 sites (~4 lines each) — below the duplication value bar on its own; folded into F8's write-up as a drive-by fix instead of its own finding.
- **`SelectTokenPopup.vue`/`TokenMetadataPopup.vue`/`SelectFpcPopup.vue`'s "list item with check-circle/circle icon"** rows were considered for the F1 composable, but their selection-highlight logic is too varied (different comparison keys, some via `SettingItem`, some raw `Flex`) to safely fold into one generic component without a deeper pass — left as-is.
- **`NewTokenPopup.vue`'s `createBalanceWait` state machine** (lines 90-151) is unique, non-duplicated, and load-bearing (task/balance-event race handling) — verbose but justified, not a target.
