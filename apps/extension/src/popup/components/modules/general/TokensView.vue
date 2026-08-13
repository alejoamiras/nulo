<script setup>
/** Components */
import { Dropdown } from "@/components/ui/Dropdown"
import TokenCard from "./TokenCard.vue"
import TokenImportRow from "./TokenImportRow.vue"

/** Services */
import { ContentKind } from "@/wallet/services/task/spec"
import { TaskServiceClient } from "@/wallet/services/task/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
import { BACKFILL_INDICATOR_THRESHOLD_BLOCKS, IncomingTransferServiceClient } from "@/wallet/services/incoming-transfer/client"

import { stringCompare } from "@/utils/string"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const router = useRouter()

const tasks = ref([])
const newTokens = computed(() => {
	return tasks.value
		.filter(
			(t) =>
				t.content.kind === ContentKind.TokenMint &&
				t.content.account === appStore.account.address &&
				!tokenBalances.value?.some((tb) => tb.token.name === t.content.name && tb.token.symbol === t.content.symbol) &&
				!t.finishedAt,
		)
		.map((t) => t.content)
		.sort((a, b) => stringCompare(a.name, b.name))
})

/** Phase 2.5: in-flight + recently-failed token-import journal records.
 *  Renders as TokenImportRow above the existing TokenCard list. Succeeded
 *  records are filtered out — the new TokenCard with its initial-sync
 *  spinner takes over once the watchlist entry lands. */
const FAILED_RETENTION_MS = 30_000
/** Single source of truth for the kind this view scopes to. Used by both
 *  filters and the journal query so the four references no longer drift
 *  independently — codex caught two duplicate `getOperations({ kind: ... })`
 *  call sites in this file alone. */
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
		// In-flight
		if (op.terminalAt === null) return true
		// Recently-failed retention window so the user sees the reason.
		if (op.progress?.stage === "failed" && now - op.terminalAt < FAILED_RETENTION_MS) return true
		return false
	})
})

const tokenBalances = ref([])
/** Any row's balance projection in flight → the section-header activity dot. */
const anyRefreshing = computed(() => tokenBalances.value.some((tb) => tb.isUpdating))
const sortedTokenBalances = computed(() => {
	return tokenBalances.value.sort((a, b) => {
		const tokenA = a.token
		const tokenB = b.token

		return stringCompare(tokenA.name, tokenB.name)
	})
})

const taskService = new TaskServiceClient()
taskService.onTaskCreated.add(onTaskCreated)
taskService.onTaskUpdated.add(onTaskUpdated)
taskService.onTaskDeleted.add(onTaskDeleted)
function onTaskCreated(task) {
	let idx
	switch (task.content.kind) {
		case ContentKind.BalanceUpdate:
			idx = tokenBalances.value.findIndex((tb) => tb.id === task.content.tbId)
			if (idx !== -1) {
				tokenBalances.value[idx].isUpdating = true
			}

			break
		case ContentKind.TokenMint:
			if (task.content.account !== appStore.account?.address) return

			idx = tokenBalances.value.findIndex((tb) => tb.token.name === task.content.name && tb.token.symbol === task.content.symbol)
			if (idx !== -1) {
				tokenBalances.value[idx].isMinting = true
			} else {
				tasks.value.push(task)
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

			idx = tokenBalances.value.findIndex((tb) => tb.id === task.content.tbId)
			if (idx !== -1) {
				tokenBalances.value[idx].isUpdating = false
			}

			break
		case ContentKind.TokenMint:
			idx = tasks.value.findIndex((t) => t.id === task.id)
			if (idx !== -1 && task.finishedAt) {
				tasks.value.splice(idx, 1)

				const tbIdx = tokenBalances.value.findIndex(
					(tb) => tb.token.name === task.content.name && tb.token.symbol === task.content.symbol && tb.isMinting,
				)
				if (tbIdx !== -1) {
					tokenBalances.value[tbIdx].isMinting = false
				}
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
			idx = tokenBalances.value.findIndex((tb) => tb.id === task.content.tbId)
			if (idx !== -1) {
				tokenBalances.value[idx].isUpdating = false
			}

			break

		case ContentKind.TokenMint:
			idx = tasks.value.findIndex((t) => t.id === task.id)
			if (idx !== -1) {
				tasks.value.splice(idx, 1)
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
function onBalanceAdded(tb) {
	if (tb.account !== appStore.account.address) return

	tokenBalances.value.push({
		...tb,
		isUpdating: tasks.value.some((t) => t.content.tbId === tb.id && !t.finishedAt),
		isMinting: tasks.value.some((t) => t.content.name === tb.token.name && t.content.symbol === tb.token.symbol && !t.finishedAt),
	})
	// §3: seed the newly-added token's sync state (via the same staleness-guarded applySnapshot, so it can't
	// clobber a newer live event). With zero prior tokens `seedSyncStates` never ran, so the client isn't
	// connected yet — this getSyncState also connects it so its future events flow.
	const networkId = appStore.network?.id
	const contract = tb.token?.contract
	if (networkId && contract) applySnapshot(contract, networkId)
}
function onBalanceUpdated(tb) {
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value[idx] = tb
	}
}
function onBalanceDeleted(tb) {
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value.splice(idx, 1)
	}
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

// §3 "Catching up…": per-contract public-scan sync state for the ACTIVE network. Seeded on mount /
// account / network change + on port reconnect via getSyncState (the snapshot the SW holds), then kept
// live by the transition-only event. Keyed by contract because the scan is per (networkId, contract) and
// this view only ever shows the active network's tokens.
//
// Async-ordering guards (a getSyncState snapshot resolves later than a live event / scope change):
//  - LIVE events are the freshest truth. `liveClock` ticks per event; `lastLiveAt` records each contract's
//    last event tick. A snapshot captures the clock at REQUEST and applies only if no newer live event for
//    that contract landed since — so no stale snapshot (seed OR the onBalanceAdded fill) can clobber a
//    live event.
//  - `scopeGen` (below) discards any snapshot whose (account, network) scope changed before it resolved.
const incomingTransferService = new IncomingTransferServiceClient()
const syncByContract = ref(new Map())
let liveClock = 0
const lastLiveAt = new Map()
// `scopeGen` identifies the current (account, network) scope. The watcher bumps it SYNCHRONOUSLY (before
// any await) on every scope change; every snapshot captures it at request and drops if it changed by the
// time it resolves. This closes the A→B→A cycle where an old scope's in-flight snapshot would otherwise
// pass a bare network-equality check after the user switched back. `liveClock` is monotonic (never reset),
// so a stale `lastLiveAt` from a prior scope can never falsely block a newer request.
let scopeGen = 0
incomingTransferService.onIncomingSyncStateChanged.add(onSyncStateChanged)
// A SW restart / port reconnect can drop a transition event → resnapshot on reconnect (same pattern as
// fetchTokenImports above); the event alone would never re-fire the missed state.
incomingTransferService.onConnected.add(seedSyncStates)
function onSyncStateChanged({ networkId, contract, state, blocksBehind }) {
	// The scan runs per (networkId, contract); ignore events for any network other than the one on screen.
	if (networkId !== appStore.network?.id) return
	lastLiveAt.set(contract, ++liveClock)
	syncByContract.value.set(contract, { state, blocksBehind })
}

// §3 threshold gate: the dot renders only when the scan is GENUINELY behind — never on routine
// tip-following or RPC blips. The lag is node-reported and advisory: hostile values (non-integer,
// negative, non-finite) degrade to "no dot" rather than poisoning the comparison.
function isBackfilling(contract) {
	const snap = syncByContract.value.get(contract)
	if (snap?.state !== "backfilling") return false
	return Number.isSafeInteger(snap.blocksBehind) && snap.blocksBehind >= BACKFILL_INDICATOR_THRESHOLD_BLOCKS
}
// Fetch + apply ONE contract's snapshot, dropping it if it's stale by the time it resolves: the scope
// (account/network) changed since we requested, or a newer live event for this contract landed since.
async function applySnapshot(contract, networkId) {
	const scopeAtStart = scopeGen
	const requestedAt = liveClock
	let state
	try {
		state = await incomingTransferService.getSyncState(networkId, contract)
	} catch {
		return // unavailable (port race) — recovered by the next reconnect reseed
	}
	if (scopeGen !== scopeAtStart) return // account/network changed (incl. an A→B→A cycle) → stale
	if ((lastLiveAt.get(contract) ?? 0) > requestedAt) return // a newer live event owns this contract
	syncByContract.value.set(contract, state)
}
// Refresh the current scope's snapshots (called on mount, after a scope change, and on port reconnect).
// The map is reset synchronously by the watcher on a scope change, so this only fills — it never reassigns.
async function seedSyncStates() {
	const networkId = appStore.network?.id
	if (!networkId) return
	const contracts = [...new Set(tokenBalances.value.map((tb) => tb.token?.contract).filter(Boolean))]
	await Promise.all(contracts.map((contract) => applySnapshot(contract, networkId)))
}

function refreshBalance(tb) {
	if (tb?.id) {
		tokenBalanceService.refreshTokenBalance(tb.id)
	} else {
		for (const _tb of tokenBalances.value) tokenBalanceService.refreshTokenBalance(_tb.id)
	}
}

async function fetchTokenBalances() {
	// Guard the outer race with the same scope generation: a rapid account/network switch fires two
	// fetches; the one that RESOLVES last would otherwise write its (older) balances + reseed and win.
	const scopeAtStart = scopeGen
	const balances = (await tokenBalanceService.getTokenBalances(undefined, appStore.account?.address)).map((tb) => ({
		...tb,
		isUpdating: tasks.value.some((t) => t.content.tbId === tb.id && !t.finishedAt),
		isMinting: tasks.value.some((t) => t.content.name === tb.token.name && t.content.symbol === tb.token.symbol && !t.finishedAt),
	}))
	if (scopeGen !== scopeAtStart) return // scope changed since we started → stale
	tokenBalances.value = balances
	await seedSyncStates()
}

// Watch account AND the active network id — a network switch changes both the token list and the
// per-(networkId, contract) sync scope. Bump `scopeGen` + reset the indicator map SYNCHRONOUSLY here
// (before any await) so any in-flight snapshot from the prior scope is invalidated, then reseed.
watch(
	() => [appStore.account?.address, appStore.network?.id],
	async () => {
		scopeGen++
		syncByContract.value = new Map()
		await fetchTokenBalances()
	},
)
onMounted(async () => {
	tasks.value = (await taskService.getTasks()).filter(
		(t) =>
			(t.content.kind === ContentKind.BalanceUpdate || t.content.kind === ContentKind.TokenMint) &&
			t.content.account === appStore.account.address,
	)
	// Seed in-flight + recently-terminal token-import journal records so
	// the row is visible even if the user opened the popup after submission.
	await fetchTokenImports()

	await fetchTokenBalances()
})
onBeforeUnmount(() => {
	taskService.disconnect()
	tokenBalanceService.disconnect()
	journalService.disconnect()
	incomingTransferService.onIncomingSyncStateChanged.remove(onSyncStateChanged)
	incomingTransferService.onConnected.remove(seedSyncStates)
	incomingTransferService.disconnect()
})
</script>

<template>
	<Flex direction="column" gap="12" :class="$style.wrapper">
		<Flex align="end" justify="between" :class="$style.section_header">
			<Flex align="center" gap="8">
				<span :class="$style.header_title">TOKEN BALANCES</span>
				<!-- The ONE refresh-activity signal for the whole list (per-row indication is deliberately
				     silent — batch refreshes would animate every row). Same vocabulary as the gas card's
				     activity dot: grey pulse = a shown value being re-verified. -->
				<span v-if="anyRefreshing" :class="$style.refreshing_dot" data-testid="tokens-refreshing" aria-hidden="true" />
			</Flex>

			<Flex align="center" gap="6">
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
						<DropdownItem @click="refreshBalance" data-testid="tokens-menu-refresh">
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
			<template v-if="newTokens.length">
				<TokenCard v-for="t in newTokens" :newToken="t" />
			</template>
			<template v-if="sortedTokenBalances.length">
				<TokenCard
					v-for="tb in sortedTokenBalances"
					@onRefreshBalance="refreshBalance(tb)"
					:tokenBalance="tb"
					:backfilling="isBackfilling(tb.token.contract)"
				/>
			</template>
			<template v-if="!newTokens.length && !sortedTokenBalances.length && !visibleTokenImports.length">
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

.header_title {
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.token_list {
	gap: 1px;
}

.empty_state {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	padding: 32px 16px;
	border: 1px dashed var(--nulo-border);

	text-align: center;
}

.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.empty_sub {
	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
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
