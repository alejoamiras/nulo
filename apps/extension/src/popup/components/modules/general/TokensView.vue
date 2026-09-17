<script setup>
/** Components */
import { SectionLabel, Skeleton } from "@nulo/design"
import { Dropdown } from "@/components/ui/Dropdown"
import TokenCard from "./TokenCard.vue"
import TokenImportRow from "./TokenImportRow.vue"
import TokenSeedRow from "./TokenSeedRow.vue"

/** Services */
import { ContentKind } from "@/wallet/services/task/spec"
import { TaskServiceClient } from "@/wallet/services/task/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Utils */
import { stringCompare } from "@/utils/string"
import { parseRawBalance, safeFiatOf } from "@/utils/token-amount"
import { capTokenRows, forChain, orderTokenRows } from "@/utils/token-order"

/** Composables */
import { usePinnedTokens, pinScopeOf } from "@/composables/usePinnedTokens"
import { usePrices } from "@/composables/usePrices"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

/** The page owns the seed-status client; a mount without one has no defaults to wait for. */
const props = defineProps({
	seedEntries: {
		type: Array,
		default: () => [],
	},
	seedReady: {
		type: Boolean,
		default: true,
	},
})
const emit = defineEmits(["retry-seed"])

const router = useRouter()

const tasks = ref([])

/** In-flight + recently-failed token-import journal records, rendered as TokenImportRow above the
 *  TokenCard list. Succeeded records are filtered out — the new TokenCard, with its initial-sync
 *  skeleton, takes over once the watchlist entry lands. */
const FAILED_RETENTION_MS = 30_000
/** The one journal kind this view scopes to: the filters and the query must not drift apart. */
const TOKENS_VIEW_KIND = "token_import"
const tokenImports = ref([])
// 5s tick is a generous fraction of the 30s retention window — the failed
// row visibly disappears even if no new journal event fires.
const tickNow = useTicker(5_000)
const visibleTokenImports = computed(() => {
	const account = appStore.account?.address
	const now = tickNow.value ?? Date.now()
	return tokenImports.value.filter((op) => {
		if (op.kind !== TOKENS_VIEW_KIND) return false
		if (op.accountAddress !== account) return false
		// Two profiles can hold the SAME address (one mnemonic imported twice): the profile
		// compare keeps one profile's import from rendering under the other.
		if (op.profileId && appStore.profile?.id && op.profileId !== appStore.profile.id) return false
		// In-flight
		if (op.terminalAt === null) return true
		// Recently-failed retention window so the user sees the reason.
		if (op.progress?.stage === "failed" && now - op.terminalAt < FAILED_RETENTION_MS) return true
		return false
	})
})

const tokenBalances = ref([])
/** `loading` and `unavailable` both mean "not known yet": only `loaded` may say the list is empty. */
const balancesState = ref("loading")
/** Any row's balance projection in flight → the section-header activity dot. */
const anyRefreshing = computed(() => tokenBalances.value.some((tb) => tb.isUpdating))

/** Prices order the rows; the client is disconnected AFTER the composable is disposed (cleanup order). */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
const fiatOf = safeFiatOf((tb) => prices.tokenFiatMicro(tb.token, parseRawBalance(tb)))

const pins = usePinnedTokens({
	getScope: () => pinScopeOf(appStore.profile?.id, appStore.network?.chainId),
	knownContracts: () => new Set(tokenBalances.value.map((tb) => tb.token.contract)),
})
void pins.refresh()

const orderedTokenBalances = computed(() => orderTokenRows(tokenBalances.value, { pinnedContracts: pins.pinnedContracts.value, fiatOf }))
const homeRows = computed(() => capTokenRows(orderedTokenBalances.value))
const shownTokenBalances = computed(() => homeRows.value.shown)
const overflowCount = computed(() => homeRows.value.overflow)

/** A default shows as a placeholder only until something real stands for it: its token row, or
 *  the import row its own persist step journals. Matched by contract, never by symbol. */
const seedPlaceholders = computed(() => {
	const chainId = appStore.network?.chainId
	const taken = new Set(tokenBalances.value.map((tb) => tb.token?.contract?.toLowerCase()))
	for (const op of visibleTokenImports.value) taken.add(op.contractAddress?.toLowerCase())
	return props.seedEntries.filter((entry) => entry.chainId === chainId && !taken.has(entry.contract.toLowerCase()))
})
const hasAnyRow = computed(
	() => shownTokenBalances.value.length > 0 || visibleTokenImports.value.length > 0 || seedPlaceholders.value.length > 0,
)
const isSettled = computed(() => balancesState.value === "loaded" && props.seedReady)

/** Anonymous rows cover a wait with nothing to name yet — but only a wait long enough to notice:
 *  a warm service worker answers first, and a flash of skeletons reads as a glitch. */
const GHOST_ROWS = 2
const GHOST_DELAY_MS = 300
const ghostDelayElapsed = ref(false)
let ghostTimer
const isWaitingBlank = computed(() => !isSettled.value && !hasAnyRow.value)
const showGhostRows = computed(() => isWaitingBlank.value && ghostDelayElapsed.value)

const taskService = new TaskServiceClient()
taskService.onTaskCreated.add(onTaskCreated)
taskService.onTaskUpdated.add(onTaskUpdated)
taskService.onTaskDeleted.add(onTaskDeleted)
function onTaskCreated(task) {
	let idx
	switch (task.content.kind) {
		case ContentKind.BalanceUpdate:
			if (task.content.account !== appStore.account?.address) return

			// Keep the snapshot current — `fetchTokenBalances` derives `isUpdating` from `tasks` on
			// every scope change, so a missing/stale entry would strand or lose the section dot.
			if (!tasks.value.some((t) => t.id === task.id)) tasks.value.push(task)

			idx = tokenBalances.value.findIndex((tb) => tb.id === task.content.tbId)
			if (idx !== -1) {
				tokenBalances.value[idx].isUpdating = true
			}

			break

		default:
			break
	}
}
function onTaskUpdated(task) {
	let idx
	switch (task.content.kind) {
		case ContentKind.BalanceUpdate:
			if (!task.finishedAt) return

			// Terminal → drop from the snapshot; a lingering unfinished-looking entry would resurrect
			// `isUpdating: true` on the next scope-change refetch (stranded section dot).
			idx = tasks.value.findIndex((t) => t.id === task.id)
			if (idx !== -1) tasks.value.splice(idx, 1)

			idx = tokenBalances.value.findIndex((tb) => tb.id === task.content.tbId)
			if (idx !== -1) {
				tokenBalances.value[idx].isUpdating = false
			}

			break
		default:
			break
	}
}
function onTaskDeleted(task) {
	let idx
	switch (task.content.kind) {
		case ContentKind.BalanceUpdate:
			idx = tasks.value.findIndex((t) => t.id === task.id)
			if (idx !== -1) tasks.value.splice(idx, 1)

			idx = tokenBalances.value.findIndex((tb) => tb.id === task.content.tbId)
			if (idx !== -1) {
				tokenBalances.value[idx].isUpdating = false
			}

			break

		default:
			break
	}
}

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
tokenBalanceService.onTokenBalanceDeleted.add(onBalanceDeleted)
// A snapshot in flight is older than any event that lands meanwhile: the event marks it stale and
// the fetch refetches instead of overwriting the event's row with its own older answer.
let fetchDirty = false
// The balance service fans a shared address's rows out from every chain; only the active one counts.
const inActiveScope = (tb) => tb.account === appStore.account?.address && tb.token?.chainId === appStore.network?.chainId
function onBalanceAdded(tb) {
	if (!inActiveScope(tb)) return
	fetchDirty = true
	if (tokenBalances.value.some((_tb) => _tb.id === tb.id)) return

	tokenBalances.value.push({
		...tb,
		isUpdating: tasks.value.some((t) => t.content.tbId === tb.id && !t.finishedAt),
		isMinting: tasks.value.some((t) => t.content.name === tb.token.name && t.content.symbol === tb.token.symbol && !t.finishedAt),
	})
}
function onBalanceUpdated(tb) {
	if (inActiveScope(tb)) fetchDirty = true
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value[idx] = tb
	}
}
function onBalanceDeleted(tb) {
	if (inActiveScope(tb)) fetchDirty = true
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value.splice(idx, 1)
	}
}
// The first connect is the one the mount's fetch opened. A later one is a port drop: events may
// have been missed and the request in flight was rejected, so resnapshot.
let balanceConnectsSeen = 0
tokenBalanceService.onConnected.add(onBalancesReconnected)
function onBalancesReconnected() {
	balanceConnectsSeen++
	if (balanceConnectsSeen > 1) void fetchTokenBalances()
}

const journalService = new OperationJournalServiceClient()
journalService.onOperationAdded.add(onJournalAdded)
journalService.onOperationUpdated.add(onJournalUpdated)
journalService.onOperationDeleted.add(onJournalDeleted)
journalService.onConnected.add(fetchTokenImports)
function onJournalAdded(op) {
	if (op.kind !== TOKENS_VIEW_KIND) return
	tokenImports.value.push(op)
}
function onJournalUpdated(op) {
	if (op.kind !== TOKENS_VIEW_KIND) return
	const idx = tokenImports.value.findIndex((x) => x.id === op.id)
	if (idx === -1) tokenImports.value.push(op)
	else tokenImports.value[idx] = op
}
function onJournalDeleted(op) {
	tokenImports.value = tokenImports.value.filter((x) => x.id !== op.id)
}
// SW restarts / port reconnects can leave the list stale (an event fired
// while we were disconnected is dropped). Resnapshot the kind-scoped slice
// every time the port reconnects — same pattern as RecentActivityView.
async function fetchTokenImports() {
	try {
		tokenImports.value = await journalService.getOperations({ kind: TOKENS_VIEW_KIND })
	} catch {
		// Reconnect may race the port — next event or the next reconnect retries.
	}
}

// `scopeGen` identifies the current (account, network) scope. The watcher bumps it SYNCHRONOUSLY (before
// any await) on every scope change; every snapshot captures it at request and drops if it changed by the
// time it resolves. This closes the A→B→A cycle where an old scope's in-flight snapshot would otherwise
// pass a bare equality check after the user switched back.
let scopeGen = 0

function refreshBalances() {
	for (const tb of tokenBalances.value) tokenBalanceService.refreshTokenBalance(tb.id)
}

/** A rejected snapshot is retried once on a timer; after that a reconnect or a scope change retries. */
const BALANCES_RETRY_MS = 2_000
let balancesRetryTimer
let fetchGeneration = 0
const withTaskFlags = (tb) => ({
	...tb,
	isUpdating: tasks.value.some((t) => t.content.tbId === tb.id && !t.finishedAt),
	isMinting: tasks.value.some((t) => t.content.name === tb.token.name && t.content.symbol === tb.token.symbol && !t.finishedAt),
})

// Only the latest request may land, a snapshot overtaken by a live event is refetched rather than
// applied, and a refetch within a scope keeps the rows already shown (the watcher clears them on a
// scope change). A rejection never reads as an empty list: the state stays short of `loaded`.
async function fetchTokenBalances(isTimedRetry = false) {
	const scopeAtStart = scopeGen
	const generation = ++fetchGeneration
	clearTimeout(balancesRetryTimer)
	fetchDirty = false
	const address = appStore.account?.address
	const chainId = appStore.network?.chainId
	if (!address) {
		tokenBalances.value = []
		balancesState.value = "loaded"
		return
	}
	let fetched
	try {
		fetched = await tokenBalanceService.getTokenBalances(undefined, address)
	} catch {
		if (scopeGen !== scopeAtStart || generation !== fetchGeneration) return
		if (balancesState.value !== "loaded") balancesState.value = "unavailable"
		if (!isTimedRetry) balancesRetryTimer = setTimeout(() => void fetchTokenBalances(true), BALANCES_RETRY_MS)
		return
	}
	if (scopeGen !== scopeAtStart || generation !== fetchGeneration) return
	if (fetchDirty) return fetchTokenBalances()
	tokenBalances.value = forChain(fetched, chainId).map(withTaskFlags)
	balancesState.value = "loaded"
}

/** Resnapshot the task list for the ACTIVE scope. Runs on mount, scope changes, and TaskService
 *  reconnects — the live events alone can't repair a snapshot that went stale while disconnected,
 *  and `fetchTokenBalances` derives `isUpdating` from this list on every refetch. Scope-guarded so
 *  a late resolve from a superseded scope can't clobber the fresh one. */
async function fetchTasks() {
	const scopeAtStart = scopeGen
	const all = await taskService.getTasks()
	if (scopeGen !== scopeAtStart) return
	tasks.value = all.filter((t) => t.content.kind === ContentKind.BalanceUpdate && t.content.account === appStore.account?.address)
}

// A reconnect (SW restart) may have dropped terminal task events — resnapshot AND reapply the
// per-row flags so a completion missed offline can't leave a row (and the section dot) stuck.
taskService.onConnected.add(onTaskReconnected)
async function onTaskReconnected() {
	const scopeAtStart = scopeGen
	await fetchTasks()
	if (scopeGen !== scopeAtStart) return
	for (const tb of tokenBalances.value) {
		tb.isUpdating = tasks.value.some((t) => t.content.kind === ContentKind.BalanceUpdate && t.content.tbId === tb.id && !t.finishedAt)
	}
}

watch(
	isWaitingBlank,
	(waiting) => {
		clearTimeout(ghostTimer)
		ghostDelayElapsed.value = false
		if (!waiting) return
		ghostTimer = setTimeout(() => {
			ghostDelayElapsed.value = true
		}, GHOST_DELAY_MS)
	},
	{ immediate: true },
)

// Profile, account AND network id: a network switch changes the token list, and one phrase imported
// twice gives two profiles the same address. `scopeGen` is bumped SYNCHRONOUSLY (before any await)
// so every in-flight snapshot from the prior scope is invalidated.
watch(
	() => [appStore.profile?.id, appStore.account?.address, appStore.network?.id],
	async () => {
		scopeGen++
		// The previous scope's rows go now, before any await, so they are never ordered under the
		// new scope's pins; pins refresh on their own, not behind the task snapshot.
		tokenBalances.value = []
		balancesState.value = "loading"
		void pins.refresh()
		const gen = scopeGen
		// Tasks first: fetchTokenBalances derives isUpdating from the snapshot.
		await fetchTasks().catch(() => undefined)
		// A newer scope, or the unmount (which bumps the generation), owns the balances now.
		if (scopeGen !== gen) return
		await fetchTokenBalances()
	},
)
onMounted(async () => {
	const gen = scopeGen
	// A rejected task snapshot only costs the refresh dot; it must not strand the balances behind it.
	await fetchTasks().catch(() => undefined)
	// Seed in-flight + recently-terminal token-import journal records so
	// the row is visible even if the user opened the popup after submission.
	await fetchTokenImports()
	// An unmount or a scope change during the awaits owns the balances now; fetching here would
	// reconnect a disconnected client and could leave a retry timer behind.
	if (scopeGen !== gen) return
	await fetchTokenBalances()
})
onBeforeUnmount(() => {
	scopeGen++
	clearTimeout(ghostTimer)
	clearTimeout(balancesRetryTimer)
	taskService.disconnect()
	tokenBalanceService.onConnected.remove(onBalancesReconnected)
	tokenBalanceService.disconnect()
	journalService.disconnect()
	prices.dispose()
	priceService.disconnect()
	pins.dispose()
})
</script>

<template>
	<Flex direction="column" gap="12" :class="$style.wrapper">
		<Flex align="end" justify="between" :class="$style.section_header">
			<Flex align="center" gap="8">
				<SectionLabel label="Holdings" :count="tokenBalances.length + seedPlaceholders.length || null" countTestid="tokens-count" />
				<!-- The ONE refresh-activity signal for the whole list (per-row indication is deliberately
				     silent — batch refreshes would animate every row). Same vocabulary as the gas card's
				     activity dot: grey pulse = a shown value being re-verified. -->
				<span v-if="anyRefreshing" :class="$style.refreshing_dot" data-testid="tokens-refreshing" aria-hidden="true" />
			</Flex>

			<Flex align="center" gap="10">
				<span
					v-if="overflowCount > 0"
					@click="router.push('/popup/holdings')"
					data-testid="tokens-view-all"
					:class="$style.view_all"
				>View all</span>
				<Dropdown>
					<Button variant="secondary" size="micro" data-testid="tokens-menu-trigger">
						<Icon name="dots" size="12" color="secondary" />
					</Button>

					<template #popup>
						<DropdownItem @click="popupStore.open('new_token')" data-testid="tokens-menu-import">
							<Flex align="center" gap="8">
								<Icon name="plus-circle" size="14" color="primary" />
								Import token
							</Flex>
						</DropdownItem>
						<DropdownItem @click="router.push('/popup/settings/tokens')" data-testid="tokens-menu-manage">
							<Flex align="center" gap="8">
								<Icon name="settings" size="14" color="primary" />
								Manage tokens
							</Flex>
						</DropdownItem>
						<DropdownItem
							@click="router.push('/popup/settings/contacts')"
							data-testid="tokens-menu-contacts"
						>
							<Flex align="center" gap="8">
								<Icon name="user" size="14" color="primary" />
								Manage contacts
							</Flex>
						</DropdownItem>
						<DropdownDivider />
						<DropdownItem @click="refreshBalances" data-testid="tokens-menu-refresh">
							<Flex align="center" gap="8">
								<Icon name="refresh" size="14" color="primary" />
								Refresh balances
							</Flex>
						</DropdownItem>
					</template>
				</Dropdown>
			</Flex>
		</Flex>

		<Flex direction="column" :class="$style.token_list">
			<template v-if="visibleTokenImports.length">
				<TokenImportRow v-for="op in visibleTokenImports" :key="op.id" :op="op" />
			</template>
			<template v-if="shownTokenBalances.length">
				<TokenCard v-for="tb in shownTokenBalances" :key="tb.id" :tokenBalance="tb" />
			</template>
			<TokenSeedRow
				v-for="entry in seedPlaceholders"
				:key="entry.contract"
				:entry="entry"
				@retry="emit('retry-seed', entry)"
			/>
			<template v-if="showGhostRows">
				<div v-for="n in GHOST_ROWS" :key="n" data-testid="tokens-skeleton-row" aria-hidden="true" :class="$style.ghost_row">
					<Flex direction="column" gap="5">
						<Skeleton :width="52" :height="14" />
						<Skeleton :width="84" :height="9" />
					</Flex>
					<Flex direction="column" align="end" gap="5">
						<Skeleton :width="64" :height="13" />
						<Skeleton :width="92" :height="9" />
					</Flex>
				</div>
			</template>
			<template v-if="isSettled && !hasAnyRow">
				<div :class="$style.empty_state">
					<span :class="$style.empty_headline">NOTHING HERE YET</span>
					<span :class="$style.empty_sub">
						<button
							type="button"
							@click="popupStore.open('new_token')"
							data-testid="tokens-empty-import-link"
							:class="$style.empty_link"
						>Tap</button>
						to import your first token.
					</span>
				</div>
			</template>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	/* no extra styling needed */
}

.section_header {
	padding-bottom: 0;
}

/* The gas card's activity-dot vocabulary, verbatim (4px grey, 1.2s ease pulse). */
.refreshing_dot {
	width: 4px;
	height: 4px;
	border-radius: 50%;
	background: var(--nulo-secondary);
	animation: refresh_pulse 1.2s ease-in-out infinite;
}

@keyframes refresh_pulse {
	0%,
	100% {
		opacity: 0.25;
	}
	50% {
		opacity: 0.9;
	}
}

@media (prefers-reduced-motion: reduce) {
	.refreshing_dot {
		animation: none;
	}
}

/* Same voice as RecentActivityView's "View Archives" link. */
.view_all {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-outline);
	cursor: pointer;

	transition: color 0.2s var(--bezier);

	&:hover {
		color: var(--nulo-accent);
	}
}

.token_list {
	gap: 1px;
}

/* A TokenCard's box with nothing in it to name yet. */
.ghost_row {
	display: flex;
	align-items: center;
	justify-content: space-between;

	min-height: 32px;
	padding: 8px 0;
}

.empty_state {
	composes: empty_state from "./list-empty.module.css";
}

.empty_headline {
	composes: empty_headline from "./list-empty.module.css";
}

.empty_sub {
	composes: empty_sub from "./list-empty.module.css";
}

.empty_link {
	/* Real <button> styled inline as a link so it carries native a11y
	   (focusable, Enter/Space activatable) instead of <a href="#"> + preventDefault.
	   Inherits font + spacing from the surrounding .empty_sub. */
	display: inline;
	padding: 0;
	margin: 0;
	border: 0;
	background: transparent;

	font: inherit;
	color: var(--txt-secondary);
	text-decoration: underline;
	text-underline-offset: 2px;
	cursor: pointer;

	transition: color 0.2s var(--bezier);

	&:hover {
		color: var(--nulo-accent);
	}

	&:focus-visible {
		outline: 2px solid var(--nulo-accent);
		outline-offset: 2px;
	}
}
</style>
