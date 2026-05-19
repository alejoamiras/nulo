<route lang="json">
{
	"meta": {
		"title": "History",
		"isAuthRequired": true,
		"showBottomNav": true
	}
}
</route>

<script setup>
/** Components */
import TransactionsList from "../components/modules/activity/TransactionsList.vue"

/** Services */
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
import { TokenServiceClient } from "@/wallet/services/token/client"

/** Utils */
import { ACTIVITY_FEED_KINDS } from "@/utils/journal-state"

/** Store */
import { useAppStore } from "@/stores/app.store"

const appStore = useAppStore()

/** Service clients */
const transactionService = new TransactionServiceClient()
/** Phase 2 follow-up: merge journal terminal records (cancel / interrupted /
 *  failed paths that never produced an on-chain tx) into the History list
 *  alongside settled chain transactions. */
const journalService = new OperationJournalServiceClient()
/** Phase 2 follow-up v4: tokens lookup so terminal transfer rows can format
 *  their amounts. Same pattern as RecentActivityView. */
const tokenService = new TokenServiceClient()
const tokens = ref([])
const tokensById = computed(() => {
	const map = {}
	for (const t of tokens.value) map[t.id] = t
	return map
})

/** Journal terminal records (Phase 2 follow-up).
 *  Loaded on mount + refreshed on every journal event so the list reacts to
 *  late-arriving cancellations / failures while the user is on this page. */
const terminalJournalOps = ref([])

async function loadTerminalJournalOps() {
	if (!appStore.profile?.id) return
	const records = await journalService.getOperations({ profileId: appStore.profile.id, isTerminal: true })
	terminalJournalOps.value = records
}

function onJournalAdded(op) {
	if (op.terminalAt === null) return
	terminalJournalOps.value = [op, ...terminalJournalOps.value.filter((x) => x.id !== op.id)]
}
function onJournalUpdated(op) {
	if (op.terminalAt === null) {
		terminalJournalOps.value = terminalJournalOps.value.filter((x) => x.id !== op.id)
		return
	}
	const idx = terminalJournalOps.value.findIndex((x) => x.id === op.id)
	if (idx !== -1) terminalJournalOps.value[idx] = op
	else terminalJournalOps.value = [op, ...terminalJournalOps.value]
}
function onJournalDeleted(op) {
	terminalJournalOps.value = terminalJournalOps.value.filter((x) => x.id !== op.id)
}

journalService.onOperationAdded.add(onJournalAdded)
journalService.onOperationUpdated.add(onJournalUpdated)
journalService.onOperationDeleted.add(onJournalDeleted)
journalService.onConnected.add(loadTerminalJournalOps)

/** Discriminated row model — see TransactionsList for shape. Merges chain
 *  txs with terminal journal records, filters succeeded-journal (those
 *  already surface as the corresponding chain tx), filters by active
 *  account, sorts newest-first by timestamp. */
const activityRows = computed(() => {
	const rows = []
	for (const tx of appStore.transactions) {
		rows.push({ type: "tx", key: `tx:${tx.hash}`, sortKey: tx.updatedAt, tx })
	}
	for (const op of terminalJournalOps.value) {
		// Skip succeeded — they have a chain TransactionService entry already.
		if (op.progress?.stage === "succeeded") continue
		// Only kinds classified as activity-feed render here (token_import etc.
		// have other home surfaces). Centralized in utils/journal-state.ts.
		if (!ACTIVITY_FEED_KINDS.has(op.kind)) continue
		// Account scoping: don't surface a different account's terminal records.
		if (op.accountAddress !== appStore.account?.address) continue
		if (op.terminalAt === null) continue
		rows.push({ type: "journal", key: `journal:${op.id}`, sortKey: op.terminalAt, op })
	}
	return rows.sort((a, b) => b.sortKey - a.sortKey)
})

/** Hero visibility → compact sticky title fade */
const heroRef = useTemplateRef("heroRef")
const heroVisible = ref(true)
let heroObserver = null

async function loadTokens() {
	if (!appStore.profile?.id || !appStore.network?.chainId) return
	tokens.value = await tokenService.getTokens(appStore.profile.id, appStore.network.chainId)
}

/** Lifecycle hooks */
onMounted(async () => {
	if (heroRef.value) {
		heroObserver = new IntersectionObserver(
			([entry]) => {
				heroVisible.value = entry.isIntersecting
			},
			{ threshold: 0 },
		)
		heroObserver.observe(heroRef.value)
	}
	await loadTerminalJournalOps()
	await loadTokens()
})

onBeforeUnmount(() => {
	transactionService.disconnect()
	tokenService.disconnect()
	journalService.disconnect()
	heroObserver?.disconnect()
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<div :class="[$style.page_title_bar, !heroVisible && $style.page_title_bar_visible]">
			<span :class="$style.page_title_label">HISTORY</span>
		</div>

		<div ref="heroRef">
			<Flex direction="column" align="center" gap="16" :class="$style.hero">
				<h1 :class="$style.hero_title">HISTORY</h1>
				<div :class="$style.hero_bar" />
			</Flex>
		</div>

		<Flex direction="column" gap="24" :class="$style.content">
			<!-- Mixed activity list (chain tx + journal terminal records) -->
			<TransactionsList v-if="activityRows.length" :rows="activityRows" :tokensById="tokensById" />

			<!-- Empty state -->
			<Flex
				v-else
				direction="column"
				align="center"
				gap="12"
				:class="$style.empty_banner"
			>
				<MaterialIcon name="history" :size="32" color="secondary" />
				<span :class="$style.empty_title">No transactions yet</span>
				<span :class="$style.empty_description">
					Once you start working with your assets, all activity will appear here
				</span>
			</Flex>
		</Flex>

	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);

	padding-bottom: var(--nav-clearance);
}

.page_title_bar {
	position: sticky;
	top: 0;
	z-index: 5;

	display: flex;
	align-items: center;

	padding: 12px 24px;

	background: var(--app-bg);

	opacity: 0;
	pointer-events: none;

	transition: opacity 0.18s cubic-bezier(0.4, 0, 1, 1);
}

.page_title_bar_visible {
	opacity: 1;
	pointer-events: auto;
}

.page_title_label {
	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-primary);

	text-decoration: underline;
	text-decoration-color: var(--nulo-accent);
	text-decoration-thickness: 2px;
	text-underline-offset: 4px;
}

.hero {
	padding: 0 24px 32px 24px;
}

.hero_title {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--txt-primary);
	line-height: 1;
	margin: 0;
}

.hero_bar {
	width: 24px;
	height: 1px;
	background: var(--nulo-accent);
}

.content {
	padding: 0 24px;
}

.empty_banner {
	max-width: 280px;
	margin: 48px auto 0 auto;
	text-align: center;
}

.empty_title {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 600;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
}

.empty_description {
	font-family: var(--font-body);
	font-size: 12px;
	line-height: 1.5;
	color: var(--nulo-secondary);
}
</style>
