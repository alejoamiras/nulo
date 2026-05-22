<script setup>
/** Components */
import TransactionAwaitingCard from "@/components/composite/activity/TransactionAwaitingCard.vue"
import TransactionTerminalCard from "@/components/composite/activity/TransactionTerminalCard.vue"
import TransactionCard from "../activity/TransactionCard.vue"

/** Vendor */

/** Services */
import { ExecutionServiceClient } from "@/wallet/services/execution/client"
import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
import { TaskServiceClient } from "@/wallet/services/task/client"
import { ContentKind, TaskStatus } from "@/wallet/services/task/spec"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { OriginType, TxStatus } from "@/wallet/services/transaction/spec"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { ACTIVITY_FEED_KINDS, buildJournalTerminalCardProps, journalTerminalDisplay } from "@/utils/journal-state"
import { formatTransferType, humanizeMethodName } from "@/utils/tx-enrichment"
import { buildCancelHandler, isMatchingTask } from "./recent-activity-handlers"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const props = defineProps({
	token: {
		type: Object,
	},
})

const router = useRouter()

/** Phase 2 follow-up v4: terminal journal records (cancelled / interrupted /
 *  failed) stay visible in the recent-activity area until browser exit —
 *  same lifetime as settled chain txs. Previously a 5-min window aged them
 *  out, which user QA found confusing ("what the hell, why did it disappear?").
 *
 *  Row budget: total visible rows cap at 5. Codex post-impl audit caught
 *  that v4 v1 capped settled txs separately + rendered structurally
 *  (awaiting → all terminals → settled), which let 6+ terminals push out
 *  every settled row. Fixed below via `recentActivityRows` chronological
 *  merge — terminals + settled compete fairly for the remaining slots
 *  after awaiting cards. */
const ROW_BUDGET = 5

const filteredRecentTransactions = computed(() => {
	const source = props.token
		? appStore.transactions.filter((t) => t.calls?.some((c) => c.contract === props.token?.contract))
		: appStore.transactions
	// Suppress pending txs while any in-flight awaiting card is showing —
	// the card already represents the operation; a pending tx arriving
	// before the task completes would cause a duplicate entry at different
	// lifecycle stages. With multi-card rendering, ANY in-flight surface
	// (journal cards or orphan executingTask) keeps the suppression active.
	const inFlight = executingTask.value || showJournalAwaiting.value
	return inFlight ? source.filter((t) => t.status !== TxStatus.Pending) : source
})

/** Chronological merge of terminal journal records + settled chain txs.
 *  In-flight cards render BEFORE this list; this list takes whatever slots
 *  remain after subtracting the count of rendered awaiting cards. With N
 *  concurrent in-flight ops the home-tab preview can exceed ROW_BUDGET —
 *  every in-flight op is visible by design (per user requirement), and
 *  settled overflow goes to the Activity page. */
const recentActivityRows = computed(() => {
	// Count slots only for cards that actually render. The send.vue fallback
	// (`awaitingAccountTxs` / `isTokenAwaitingTx` generic card) is suppressed
	// by the template when ANY journal card or orphan executing task is on
	// screen — counting it in that window would undercount remaining settled
	// slots by 1 (codex post-impl catch). Mirror the template's `v-else-if`
	// chain here so the math matches the DOM.
	const journalCount = renderedInFlightOps.value.length
	const orphanCount = hasOrphanExecutingTask.value ? 1 : 0
	const fallbackRendered =
		journalCount === 0 && orphanCount === 0 && (props.token ? isTokenAwaitingTx.value : awaitingAccountTxs.value.length > 0)
	const inFlightCount = journalCount + orphanCount + (fallbackRendered ? 1 : 0)
	const remaining = Math.max(0, ROW_BUDGET - inFlightCount)
	if (remaining === 0) return []
	const rows = []
	for (const op of recentlyTerminalJournalOps.value) {
		rows.push({ type: "journal", key: `journal:${op.id}`, sortKey: op.terminalAt ?? 0, op })
	}
	for (const tx of filteredRecentTransactions.value) {
		rows.push({ type: "tx", key: `tx:${tx.hash}`, sortKey: tx.updatedAt, tx })
	}
	rows.sort((a, b) => b.sortKey - a.sortKey)
	return rows.slice(0, remaining)
})
const isTokenAwaitingTx = computed(() => {
	return props.token
		? appStore.awaitingTransactions.findIndex((t) => t.account === appStore.account.address && t.contract === props.token.contract) > -1
		: false
})
const awaitingAccountTxs = computed(() => {
	return appStore.awaitingTransactions.filter((t) => t.account === appStore.account?.address)
})

/** Unified in-flight task: covers both dapp-initiated (ExecuteOperation) and
 *  UI-initiated (Transfer) sends. The backend emits task+subtasks with progress
 *  labels; we surface them through a single awaiting card with live subtitle. */
const executingTask = ref(null)
const executingSubtasks = ref([])

/** Tokens lookup — UI Transfer tasks carry a tokenId; we resolve to symbol +
 *  decimals so the awaiting card can mirror TransactionCard (icon + amount). */
const tokens = ref([])
const tokenService = new TokenServiceClient()
async function loadTokens() {
	if (!appStore.profile || !appStore.network) return
	tokens.value = await tokenService.getTokens(appStore.profile.id, appStore.network.chainId)
}

function tokenById(id) {
	return tokens.value.find((t) => t.id === id)
}

const isUiTransfer = computed(() => executingTask.value?.content?.kind === ContentKind.Transfer)

const executingProgressTitle = computed(() => {
	if (!executingTask.value) return ""
	if (isUiTransfer.value) {
		const token = tokenById(executingTask.value.content.tokenId)
		return token?.symbol || "Transfer"
	}
	// Dapp path: title is the method name only — the dApp identity rides
	// in the secondary-row chip (originLabel) so the title position stays
	// stable across the lifecycle into the settled card.
	const method = executingTask.value.content?.primaryMethod
	if (method) return humanizeMethodName(method)
	return "Transaction"
})
const executingProgressSubtitle = computed(() => {
	const active = executingSubtasks.value.find((s) => s.status === TaskStatus.Processing)
	return active ? `${active.content.label}...` : "Preparing..."
})
/** dApp identity chip for the in-flight card — same chip the settled
 *  `TransactionCard` shows via `getOriginLabel`. UI-initiated transfers
 *  leave this null so the chip is suppressed. */
const executingOriginLabel = computed(() => {
	if (!executingTask.value || isUiTransfer.value) return null
	return executingTask.value.origin?.name ?? null
})
const executingAmount = computed(() => {
	if (!isUiTransfer.value) return null
	const token = tokenById(executingTask.value.content.tokenId)
	if (!token) return null
	return balanceFormatted(String(executingTask.value.content.amount), token.decimals || 0, 8).value
})
const executingAmountSymbol = computed(() => {
	if (!isUiTransfer.value) return null
	return tokenById(executingTask.value.content.tokenId)?.symbol || null
})

const taskService = new TaskServiceClient()
taskService.onTaskCreated.add(onExecutingTaskCreated)
taskService.onTaskUpdated.add(onExecutingTaskUpdated)
taskService.onTaskDeleted.add(onExecutingTaskDeleted)

/** Durable journal records. Survives SW restart + popup close/reopen so if
 *  the user starts a send, closes the popup, and reopens, they still see the
 *  progress card. Filtered to in-flight states only — submitted/failed drop
 *  off automatically. */
const journalService = new OperationJournalServiceClient()
const journalOps = ref([])

/** Phase 2 follow-up: execution-service client for Cancel surface.
 *  Disconnected in onBeforeUnmount alongside the others. */
const executionService = new ExecutionServiceClient()

/** Phase 2 follow-up: cancel handler for the awaiting card's `@cancel` emit.
 *  Built from a pure module so the wire is unit-testable without mounting
 *  the full Vue component. The card emits `cancel(jobId)`; the handler
 *  cancels exactly that record. With multiple in-flight cards on screen
 *  (concurrent transfers / dapp ops), each card cancels its own op — the
 *  previous closure-over-top-op API would have cross-fired.
 *
 *  Cancel-dupe fix (transfer regression): keep a small set of jobIds the
 *  user just clicked Cancel on. When the journal event arrives with one of
 *  those ids in a terminal stage we clear executingTask via DIRECT ID match
 *  rather than the kind+tokenId heuristic in `isMatchingTask`. ID
 *  correlation has no such fragility. */
const pendingCancelJobIds = ref(new Set())
const onCancelInFlight = buildCancelHandler(executionService, (jobId) => pendingCancelJobIds.value.add(jobId))

/** Shared account / network / token scoping for journal-record filters.
 *  Same rules apply to in-flight and recently-terminal surfaces. */
function journalRecordInScope(op) {
	if (op.accountAddress !== appStore.account?.address) return false
	// Network scoping (codex audit gap on multi-network profiles): a tx
	// fired on chain A shouldn't surface in the activity feed for chain B.
	// Records before the journal carried `networkId` may have it
	// undefined — show those everywhere so we don't strand legacy ops.
	if (op.networkId && appStore.network?.id && op.networkId !== appStore.network.id) return false
	if (props.token && op.tokenId !== props.token.id) return false
	return true
}

const inFlightJournalOps = computed(() =>
	journalOps.value.filter((op) => {
		// Drop terminal records — they surface via the parallel
		// `recentlyTerminalJournalOps` computed below.
		if (op.terminalAt !== null) return false
		// Only kinds classified as activity-feed render here. Centralized in
		// `utils/journal-state.ts` so future kinds opt in (or stay routed to
		// their own home surface) by one set update, not scattered if-chains.
		if (!ACTIVITY_FEED_KINDS.has(op.kind)) return false
		return journalRecordInScope(op)
	}),
)

/** Terminal journal records (cancelled / failed) in scope, sorted newest-first.
 *  No time window — they stay visible until browser exit, same lifetime
 *  as the chain settled txs they sit alongside. */
const recentlyTerminalJournalOps = computed(() => {
	return journalOps.value
		.filter((op) => {
			if (op.terminalAt === null) return false
			// Filter out succeeded too — those have a TransactionService entry
			// and render via TransactionCard.
			if (op.progress?.stage === "succeeded") return false
			if (!ACTIVITY_FEED_KINDS.has(op.kind)) return false
			return journalRecordInScope(op)
		})
		.sort((a, b) => (b.terminalAt ?? 0) - (a.terminalAt ?? 0))
})

/**
 * Phase 2 W5 — journal is the primary source of truth.
 *
 * Pre-W5 the popup preferred the in-memory TaskService over the durable
 * journal, which meant a stale task from before SW restart could mask the
 * journal's truth and never get re-snapshotted. Now: if the journal shows
 * an in-flight op, that's what we render. The executingTask remains as
 * SUBTASK ENRICHMENT — its progress lines decorate the journal card when
 * both exist for the same op — but it no longer gates whether the
 * in-flight card appears.
 *
 * Reconnect handling is via `journalService.onConnected` (registered
 * below): on every port reconnect (SW restart) we re-snapshot the journal
 * list so a record that became terminal during the disconnect window
 * stops surfacing as in-flight.
 */
const showJournalAwaiting = computed(() => inFlightJournalOps.value.length > 0)

/** Stable render order: newest-first (by `createdAt` descending). Matches
 *  how the settled transaction list orders rows (newest on top) and the
 *  user's mental model ("the one I just submitted goes on top; older ones
 *  scroll down"). The disappearance bug being fixed here is about
 *  *rendering all cards*, not about which one sits at index 0 — the order
 *  is independent. */
const renderedInFlightOps = computed(() => [...inFlightJournalOps.value].sort((a, b) => b.createdAt - a.createdAt))

/** Per-op card title. Used in the template's v-for; was previously a
 *  computed over `topJournalOp` which forced single-card rendering. */
function cardTitleFor(op) {
	if (!op) return ""
	if (op.kind === "transfer") {
		const token = op.tokenId !== undefined ? tokenById(op.tokenId) : undefined
		return token?.symbol || "Transfer"
	}
	// dapp_execute: title is the raw primary-method fn name persisted in
	// the journal (e.g. "swap_tokens_for_exact_tokens"). Humanize for display.
	return op.title ? humanizeMethodName(op.title) : "Transaction"
}

/** Per-op dApp identity chip. The persisted record's `subtitle` field
 *  carries the dApp hostname for `dapp_execute` ops; null for transfers. */
function cardOriginLabelFor(op) {
	if (!op || op.kind === "transfer") return null
	return op.subtitle ?? null
}

/** Per-op icon. Transfers use the up-right arrow; dApp ops use the zap. */
function cardIconFor(op) {
	return op?.kind === "transfer" ? "arrow-narrow-up-right" : "zap"
}

/** Per-op amount string. Derived from `op.amountRaw` (raw base units) and the
 *  token's decimals — same formatter the settled `TransactionCard` uses, so
 *  the in-flight and settled phases read identically once the badge swaps.
 *  Returns null when the token hasn't loaded yet OR when the journal record
 *  doesn't carry an amount (dApp ops). */
function cardAmountFor(op) {
	if (op?.kind !== "transfer") return null
	if (op.amountRaw === undefined) return null
	if (op.tokenId === undefined) return null
	const token = tokenById(op.tokenId)
	if (!token) return null
	return balanceFormatted(op.amountRaw, token.decimals || 0, 8).value
}

/** Per-op symbol. Same gating as the amount — returns null when token
 *  hasn't loaded or the record isn't a transfer. */
function cardAmountSymbolFor(op) {
	if (op?.kind !== "transfer") return null
	if (op.tokenId === undefined) return null
	return tokenById(op.tokenId)?.symbol || null
}

/** Per-op transfer-type chip. Resolves the persisted `op.transferType`
 *  through `formatTransferType()` — same source the settled card uses.
 *  Guard on `=== undefined` because `TransferType.Private === 0`; a truthy
 *  check would silently drop the Private → Private chip. */
function cardTransferTypeFor(op) {
	if (op?.kind !== "transfer") return null
	if (op.transferType === undefined) return null
	return formatTransferType(op.transferType)
}

/** Compute card props for a terminal journal record. Thin wrapper over
 *  the shared `buildJournalTerminalCardProps` helper — id is spread in
 *  here because the template's `v-bind` propagates it as an attr; the
 *  shared helper deliberately omits `id` so other consumers (e.g.
 *  TransactionsList) don't carry an unused attr through fallthrough. */
function journalTerminalCardProps(op) {
	const props = buildJournalTerminalCardProps(op, { tokenById })
	if (!props) return null
	return { id: op.id, ...props }
}

/** Per-op subtitle. The active executingTask's subtask label decorates
 *  ONLY the matching journal card — and ONLY when the match is unambiguous.
 *
 *  `isMatchingTask` is kind-only for `dapp_execute` and kind+tokenId for
 *  `transfer`. Two concurrent same-token transfers (or any two dapp_execute
 *  ops) would both match the same executingTask. Broadcasting the subtask
 *  label to both cards would attribute progress to the wrong op — codex
 *  post-impl catch. When the match is ambiguous (≥ 2 cards match), every
 *  card falls back to the bare FSM-stage label so we never lie about
 *  which op the subtask belongs to. */
function cardSubtitleFor(op) {
	if (!op) return "Processing..."
	if (executingTask.value) {
		const account = appStore.account?.address
		if (isMatchingTask(executingTask.value, op, account)) {
			const matches = renderedInFlightOps.value.filter((other) => isMatchingTask(executingTask.value, other, account))
			if (matches.length === 1) {
				const active = executingSubtasks.value.find((s) => s.status === TaskStatus.Processing)
				if (active) return `${active.content.label}...`
			}
		}
	}
	switch (op.progress?.stage) {
		case "queued":
			// Pre-handler state surfaced by the wallet-sdk session FIFO.
			// User sees "Queued..." while a previous sendTx is still being
			// approved + simulated + built ahead of this one.
			return "Queued..."
		case "pending":
			return "Preparing..."
		case "simulating":
			return "Simulating..."
		case "proving":
			return "Generating proof..."
		case "submitting":
			return "Submitting..."
		default:
			return "Processing..."
	}
}

/** True when an executingTask is present but no in-flight journal record
 *  matches it. Drives the orphan-fallback render path: a single executingTask
 *  card renders ALONGSIDE journal cards in the rare case where TaskService
 *  has an active task without a corresponding journal entry (legacy paths,
 *  pre-W5 stragglers after SW restart, etc.). */
const hasOrphanExecutingTask = computed(() => {
	if (!executingTask.value) return false
	const account = appStore.account?.address
	return !renderedInFlightOps.value.some((op) => isMatchingTask(executingTask.value, op, account))
})

/**
 * Phase 2 follow-up v4: when a journal record turns terminal and matches
 * the current executingTask, clear executingTask in the same tick so the
 * stale awaiting card disappears immediately alongside the terminal card
 * appearing. Without this, TaskService's eventual onTaskUpdated (after
 * the SW's catch block runs) leaves a brief duplicate-render window.
 *
 * Two call shapes — codex post-impl review caught a HARD regression in
 * the original v1 (scan-all) implementation: with terminals living forever,
 * any OLD cancelled record matching by kind+tokenId would false-clear a
 * fresh executingTask. Narrowed:
 *
 * - **Event path** (`onJournalAdded`/`Updated`): we already know which op
 *   just changed; check only that op. No scan; can't false-match an
 *   ancient terminal.
 * - **Snapshot path** (`onMounted` + `resnapshotJournal`): no incoming
 *   op; scan with a 30-second `terminalAt` window. Catches the
 *   close-popup-mid-cancel-and-reopen race without sweeping in week-old
 *   terminals.
 */
const SNAPSHOT_TERMINAL_WINDOW_MS = 30_000

function clearExecutingTaskIfThisIsTerminalMatch(op) {
	if (!executingTask.value) return
	if (op.terminalAt === null) return
	if (!isMatchingTask(executingTask.value, op, appStore.account?.address)) return
	executingTask.value = null
	executingSubtasks.value = []
}

function clearExecutingTaskIfRecentTerminalMatch() {
	if (!executingTask.value) return
	const account = appStore.account?.address
	const cutoff = Date.now() - SNAPSHOT_TERMINAL_WINDOW_MS
	const match = journalOps.value.find(
		(op) => op.terminalAt !== null && op.terminalAt >= cutoff && isMatchingTask(executingTask.value, op, account),
	)
	if (match) {
		executingTask.value = null
		executingSubtasks.value = []
	}
}

/** Direct ID correlation: the user just cancelled this specific jobId and
 *  the journal confirms it's now terminal. Clear executingTask without
 *  consulting `isMatchingTask` — kind/tokenId fragility doesn't apply when
 *  we KNOW which jobId we asked to cancel. */
function clearExecutingTaskIfPendingCancelTerminal(op) {
	if (!pendingCancelJobIds.value.has(op.id)) return
	if (op.terminalAt === null) return
	pendingCancelJobIds.value.delete(op.id)
	executingTask.value = null
	executingSubtasks.value = []
}

/**
 * Cancel-dupe — THIRD producer fix (codex audit `019e275a`):
 *
 * `send.vue` pushes a fallback row into `appStore.awaitingTransactions`
 * BEFORE `executeTransfer` runs ([send.vue:262]) and only splices it out
 * on the executeTransfer promise's resolve/reject path. On user cancel,
 * the journal goes terminal IMMEDIATELY but the executeTransfer promise
 * doesn't reject until the prove pipeline hits its next AbortSignal
 * checkpoint — which is seconds for a transfer mid-proof. That gap is
 * exactly the dupe window: cancelled terminal card shown alongside the
 * `isTokenAwaitingTx` / `awaitingAccountTxs` fallback card.
 *
 * dApp `aztec_sendTx` doesn't use awaitingTransactions, so the bug was
 * transfer-only.
 *
 * Fix: when a transfer journal record turns terminal, splice the matching
 * fallback entry. Match by (account, destination=recipient, contract via
 * tokenId → token lookup) — same triple `send.vue` pushes. Guard on the
 * carry fields the journal has had since v4 commit 1 (amountRaw + recipient).
 */
function clearAwaitingTransactionFallback(op) {
	if (op.kind !== "transfer") return
	if (op.terminalAt === null) return
	const recipient = op.recipientAddress
	if (!recipient || op.tokenId === undefined) return
	const tokenContract = tokenById(op.tokenId)?.contract
	if (!tokenContract) return
	const idx = appStore.awaitingTransactions.findIndex(
		(t) => t.account === op.accountAddress && t.destination === recipient && t.contract === tokenContract,
	)
	if (idx !== -1) appStore.awaitingTransactions.splice(idx, 1)
}

function onJournalAdded(op) {
	journalOps.value = [op, ...journalOps.value.filter((x) => x.id !== op.id)]
	clearExecutingTaskIfPendingCancelTerminal(op)
	clearExecutingTaskIfThisIsTerminalMatch(op)
	clearAwaitingTransactionFallback(op)
}
function onJournalUpdated(op) {
	const idx = journalOps.value.findIndex((x) => x.id === op.id)
	if (idx !== -1) journalOps.value[idx] = op
	else journalOps.value = [op, ...journalOps.value]
	clearExecutingTaskIfPendingCancelTerminal(op)
	clearExecutingTaskIfThisIsTerminalMatch(op)
	clearAwaitingTransactionFallback(op)
}
function onJournalDeleted(op) {
	journalOps.value = journalOps.value.filter((x) => x.id !== op.id)
}

journalService.onOperationAdded.add(onJournalAdded)
journalService.onOperationUpdated.add(onJournalUpdated)
journalService.onOperationDeleted.add(onJournalDeleted)

/**
 * SW-restart safety: re-snapshot the full journal list on every port
 * reconnect. Without this, a record that became terminal (succeeded /
 * failed / cancelled — including reaper-driven `stuck_proving`) during
 * the disconnect window would never receive its onOperationUpdated event
 * here and would keep surfacing as in-flight. The reconnect listener
 * registers BEFORE the initial snapshot (same race-closure pattern as
 * `subscribeWithSnapshot`). The Phase 2 reaper is what generates those
 * terminal transitions during SW down windows.
 */
async function resnapshotJournal() {
	try {
		const ops = await journalService.getOperations({ accountAddress: appStore.account?.address })
		journalOps.value = ops.sort((a, b) => b.createdAt - a.createdAt)
		// v4 cancel-dupe (snapshot path): catches close-popup-mid-cancel-and-
		// reopen + SW disconnect mid-cancel. Uses 30s window to avoid
		// sweeping in old terminals that don't actually correspond to the
		// current executingTask.
		clearExecutingTaskIfRecentTerminalMatch()
	} catch {
		// Reconnect may race the port — next event or the next reconnect retries.
	}
}
journalService.onConnected.add(resnapshotJournal)

function isExecutingTask(task) {
	if (task.finishedAt) return false
	// Dapp-initiated send operation
	if (
		task.content.kind === ContentKind.ExecuteOperation &&
		task.origin?.type === OriginType.DAPP &&
		(task.content.operationKind === "send_transaction" || task.content.operationKind === "aztec_sendTx")
	) {
		// Token-mode pages skip dapp tasks (TransferContent carries the token id we'd
		// filter on; ExecuteOperation can't be cheaply scoped to a single token here).
		if (props.token) return false
		return true
	}
	// UI-initiated transfer — must match active account AND (in token-mode) the page's token.
	if (task.content.kind === ContentKind.Transfer && task.origin?.type === OriginType.UI) {
		if (task.content.senderAddress !== appStore.account?.address) return false
		if (props.token && task.content.tokenId !== props.token.id) return false
		return true
	}
	return false
}
function onExecutingTaskCreated(task) {
	if (isExecutingTask(task)) {
		executingTask.value = task
		executingSubtasks.value = task.subtasks || []
		return
	}
	if (task.parentId && executingTask.value && task.parentId === executingTask.value.id) {
		executingSubtasks.value.push(task)
	}
}
function onExecutingTaskUpdated(task) {
	if (executingTask.value && task.id === executingTask.value.id) {
		if (task.finishedAt) {
			executingTask.value = null
			executingSubtasks.value = []
		} else {
			executingTask.value = task
		}
		return
	}
	if (task.parentId && executingTask.value && task.parentId === executingTask.value.id) {
		const idx = executingSubtasks.value.findIndex((s) => s.id === task.id)
		if (idx !== -1) {
			executingSubtasks.value[idx] = task
		} else {
			executingSubtasks.value.push(task)
		}
	}
}
function onExecutingTaskDeleted(task) {
	if (executingTask.value && task.id === executingTask.value.id) {
		executingTask.value = null
		executingSubtasks.value = []
	}
}

const handleSelectTx = (tx) => {
	router.push(`/popup/tx/${tx.hash}`)
}

onMounted(async () => {
	await loadTokens()

	// Newest-first replay — otherwise concurrent tasks could surface the older one.
	const allTasks = await taskService.getTasks()
	const matching = allTasks.filter((t) => isExecutingTask(t)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
	const activeExec = matching[0]
	if (activeExec) {
		executingTask.value = activeExec
		executingSubtasks.value = activeExec.subtasks || []
	}

	// Load persisted in-flight ops. Sort newest-first so the most recent
	// operation is the one we surface via inFlightJournalOps[0].
	journalOps.value = (await journalService.getOperations({ accountAddress: appStore.account?.address })).sort(
		(a, b) => b.createdAt - a.createdAt,
	)
	// v4 cancel-dupe (mount snapshot path): clears if there's a recently-
	// terminal record matching executingTask. 30s window — recent enough
	// to catch close-popup-mid-cancel-and-reopen; not so wide it sweeps
	// in an old cancelled record from earlier in the session.
	clearExecutingTaskIfRecentTerminalMatch()
})
onBeforeUnmount(() => {
	taskService.disconnect()
	tokenService.disconnect()
	journalService.disconnect()
	executionService.disconnect()
})
</script>

<template>
	<Flex
		v-if="token && (executingTask || showJournalAwaiting || isTokenAwaitingTx || recentActivityRows.length)"
		direction="column"
		gap="16"
	>
		<Flex align="end" justify="between" :class="$style.section_header">
			<span :class="$style.header_title">RECENT TRANSACTIONS</span>
			<span @click="router.push('/popup/activity')" :class="$style.archive_link">View Archives</span>
		</Flex>

		<div :class="$style.list">
			<!-- One awaiting card per in-flight journal op, oldest-first by
			     createdAt. The previous single-card render keyed off
			     inFlightJournalOps[0] caused tx A to disappear when tx B was
			     submitted concurrently (codex audit catch). Cancel is per-card:
			     TransactionAwaitingCard emits `cancel(jobId)` and
			     buildCancelHandler dispatches to that specific record. -->
			<TransactionAwaitingCard
				v-for="op in renderedInFlightOps"
				:key="`awaiting:${op.id}`"
				:title="cardTitleFor(op)"
				:subtitle="cardSubtitleFor(op)"
				:icon="cardIconFor(op)"
				:originLabel="cardOriginLabelFor(op)"
				:amount="cardAmountFor(op)"
				:amountSymbol="cardAmountSymbolFor(op)"
				:transferTypeLabel="cardTransferTypeFor(op)"
				:cancellable="true"
				:jobId="op.id"
				:stage="op.progress?.stage ?? null"
				@cancel="onCancelInFlight"
			/>
			<!-- Orphan executingTask fallback: an active TaskService entry
			     with no matching journal record (rare; legacy paths /
			     pre-W5 stragglers after SW restart). Renders alongside
			     journal cards, not instead of them. -->
			<TransactionAwaitingCard
				v-if="hasOrphanExecutingTask"
				:title="executingProgressTitle"
				:subtitle="executingProgressSubtitle"
				:icon="isUiTransfer ? 'arrow-narrow-up-right' : 'zap'"
				:originLabel="executingOriginLabel"
				:amount="executingAmount"
				:amountSymbol="executingAmountSymbol"
			/>
			<TransactionAwaitingCard v-else-if="!renderedInFlightOps.length && isTokenAwaitingTx" />
			<!-- Chronological merge of terminal journal records + settled chain
			     txs. Branch by row.type. -->
			<template v-for="row in recentActivityRows" :key="row.key">
				<TransactionTerminalCard
					v-if="row.type === 'journal' && journalTerminalCardProps(row.op)"
					v-bind="journalTerminalCardProps(row.op)"
				/>
				<TransactionCard v-else-if="row.type === 'tx'" :tx="row.tx" @click="handleSelectTx(row.tx)" />
			</template>
		</div>
	</Flex>
	<Flex
		v-else-if="!token && (executingTask || showJournalAwaiting || recentActivityRows.length || awaitingAccountTxs.length)"
		direction="column"
		gap="16"
	>
		<Flex align="end" justify="between" :class="$style.section_header">
			<span :class="$style.header_title">RECENT TRANSACTIONS</span>
			<span @click="router.push('/popup/activity')" :class="$style.archive_link">View Archives</span>
		</Flex>

		<div :class="$style.list">
			<TransactionAwaitingCard
				v-for="op in renderedInFlightOps"
				:key="`awaiting:${op.id}`"
				:title="cardTitleFor(op)"
				:subtitle="cardSubtitleFor(op)"
				:icon="cardIconFor(op)"
				:originLabel="cardOriginLabelFor(op)"
				:amount="cardAmountFor(op)"
				:amountSymbol="cardAmountSymbolFor(op)"
				:transferTypeLabel="cardTransferTypeFor(op)"
				:cancellable="true"
				:jobId="op.id"
				:stage="op.progress?.stage ?? null"
				@cancel="onCancelInFlight"
			/>
			<TransactionAwaitingCard
				v-if="hasOrphanExecutingTask"
				:title="executingProgressTitle"
				:subtitle="executingProgressSubtitle"
				:icon="isUiTransfer ? 'arrow-narrow-up-right' : 'zap'"
				:originLabel="executingOriginLabel"
				:amount="executingAmount"
				:amountSymbol="executingAmountSymbol"
			/>
			<TransactionAwaitingCard v-else-if="!renderedInFlightOps.length && awaitingAccountTxs.length" />
			<template v-for="row in recentActivityRows" :key="row.key">
				<TransactionTerminalCard
					v-if="row.type === 'journal' && journalTerminalCardProps(row.op)"
					v-bind="journalTerminalCardProps(row.op)"
				/>
				<TransactionCard v-else-if="row.type === 'tx'" :tx="row.tx" @click="handleSelectTx(row.tx)" />
			</template>
		</div>
	</Flex>
	<Flex v-else-if="token" direction="column" gap="16">
		<Flex align="end" justify="between" :class="$style.section_header">
			<span :class="$style.header_title">RECENT TRANSACTIONS</span>
		</Flex>

		<div :class="$style.empty_state">
			<span :class="$style.empty_headline">NOTHING HERE YET</span>
			<span :class="$style.empty_sub">Add contacts to send and receive {{ token.symbol }}.</span>
		</div>
	</Flex>
</template>

<style module>
.section_header {
	padding-bottom: 8px;
	border-bottom: 1px solid rgba(74, 70, 63, 0.2);
}

.header_title {
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.archive_link {
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

.list {
	display: flex;
	flex-direction: column;
	gap: 4px;
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
</style>
