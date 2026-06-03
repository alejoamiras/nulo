<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/**
 * Detail page for a journal record that ended without producing an on-chain
 * transaction (cancelled, interrupted, failed-pre-broadcast). Cousin of
 * `tx/[id].vue` — that page handles records that DID produce a chain tx
 * via `TransactionService`. Journal records have no `hash`, no block, no
 * fee, no explorer URL — what they have is a kind, a terminal-state badge,
 * an optional dApp origin chip, an optional transfer amount, and
 * (when developer/debug mode is on) the raw error fields.
 *
 * Subscribes to `onOperationDeleted` so that if the record is removed
 * (GC or profile delete) while the user is on this page, we redirect back
 * to the activity feed rather than rendering a blank.
 *
 * Raw `op.error.message` AND `op.error.normalizedRaw` are gated behind the
 * same `developerMode || debugMode` toggle that `tx/[id].vue` uses for its
 * `TxDebugPanel` — `JobError.normalizedRaw` can contain serialized stacks
 * + internal strings.
 */

/** Components */
import SubPageHeader from "@/components/ui/SubPageHeader.vue"

/** Vendor */
import { DateTime } from "luxon"

/** Services */
import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { TokenServiceClient } from "@/wallet/services/token/client"

/** Utils */
import { ACTIVITY_FEED_KINDS, humanizeErrorKind, journalTerminalDisplay, sanitizeJournalSubtitle } from "@/utils/journal-state"
import { humanizeMethodName, formatTransferType } from "@/utils/tx-enrichment"
import { balanceFormatted } from "@/utils/amount.js"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const route = useRoute()
const router = useRouter()

const journalService = new OperationJournalServiceClient()
const configService = new ConfigServiceClient()
const tokenService = new TokenServiceClient()

const op = ref(null)
const tokens = ref([])
const showDevFields = ref(false)
const notFound = ref(false)

const idFromRoute = computed(() => route.params.id)

const display = computed(() => (op.value ? journalTerminalDisplay(op.value) : null))

const isTransfer = computed(() => op.value?.kind === "transfer")

const token = computed(() => {
	if (!isTransfer.value || op.value?.tokenId === undefined) return null
	return tokens.value.find((t) => t.id === op.value.tokenId) ?? null
})

const title = computed(() => {
	if (!op.value) return "Transaction"
	if (isTransfer.value) return token.value?.symbol || "Transfer"
	return op.value.title ? humanizeMethodName(op.value.title) : "Transaction"
})

const amountDisplay = computed(() => {
	if (!isTransfer.value || !op.value?.amountRaw || !token.value) return null
	return balanceFormatted(op.value.amountRaw, token.value.decimals ?? 0, 8).value
})

const transferTypeLabel = computed(() => {
	if (!isTransfer.value || op.value?.transferType === undefined) return null
	return formatTransferType(op.value.transferType)
})

// Sanitize the dApp-controlled subtitle before rendering. A malicious dApp
// could set its origin to an http(s)-URL-looking string; the helper brackets
// URL-shaped values so the UI signals "not a link" at a glance.
const originChip = computed(() => {
	if (op.value?.kind !== "dapp_execute") return null
	return sanitizeJournalSubtitle(op.value.subtitle)
})

const errorKind = computed(() => op.value?.error?.kind ?? null)
const errorMessage = computed(() => op.value?.error?.message ?? null)
const errorNormalizedRaw = computed(() => op.value?.error?.normalizedRaw ?? null)

const createdAtLabel = computed(() => {
	if (!op.value?.createdAt) return null
	return DateTime.fromMillis(op.value.createdAt).toFormat("MMM dd, yyyy 'at' HH:mm")
})

const terminalAtLabel = computed(() => {
	if (!op.value?.terminalAt) return null
	return DateTime.fromMillis(op.value.terminalAt).toFormat("MMM dd, yyyy 'at' HH:mm")
})

async function loadOp() {
	if (!idFromRoute.value) {
		op.value = null
		notFound.value = true
		return
	}
	const record = await journalService.getOperation(idFromRoute.value)
	if (!record || !ACTIVITY_FEED_KINDS.has(record.kind) || record.terminalAt === null) {
		op.value = null
		notFound.value = true
		return
	}
	op.value = record
}

function onOperationDeleted(deleted) {
	if (deleted.id === idFromRoute.value) {
		openToast({ label: "Record removed", icon: "info" })
		router.replace("/popup/activity")
	}
}

journalService.onOperationDeleted.add(onOperationDeleted)

onMounted(async () => {
	if (appStore.profile && appStore.network) {
		tokens.value = await tokenService.getTokens(appStore.profile.id, appStore.network.chainId)
	}
	const props = await configService.getProps()
	const debugMode = props.find((p) => p.key === "debugMode")?.value ?? false
	const developerMode = props.find((p) => p.key === "developerMode")?.value ?? false
	showDevFields.value = Boolean(debugMode || developerMode)
	await loadOp()
})

onBeforeUnmount(() => {
	journalService.disconnect()
	configService.disconnect()
	tokenService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper" data-testid="journal-detail-page">
		<SubPageHeader :title="title" :backTo="'/popup/activity'" />

		<Flex v-if="op && display" wide direction="column" gap="24" :class="$style.content">
			<!-- Terminal-state badge — cancelled / interrupted / failed -->
			<Flex align="center" gap="12" :class="$style.statusRow">
				<Icon :name="display.icon" size="20" :color="display.color" />
				<Flex direction="column" gap="2">
					<span :class="$style.statusLabel" data-testid="journal-detail-state">{{ display.state }}</span>
					<span :class="$style.statusSubtitle" data-testid="journal-detail-error-kind">{{ display.subtitle }}</span>
				</Flex>
			</Flex>

			<!-- Transfer amount block (transfer kind only) -->
			<Flex v-if="isTransfer && amountDisplay" align="center" direction="column" gap="6">
				<span :class="$style.amountValue">
					{{ amountDisplay }}
					<span v-if="token?.symbol" :class="$style.amountSymbol">{{ token.symbol }}</span>
				</span>
				<span v-if="transferTypeLabel" :class="$style.amountCaption">{{ transferTypeLabel }}</span>
			</Flex>

			<!-- Origin chip (dApp identity, URL-sanitized) -->
			<Flex v-if="originChip" direction="column" gap="6" :class="$style.row">
				<span :class="$style.rowLabel">App</span>
				<span :class="$style.rowValue" data-testid="journal-detail-origin">{{ originChip }}</span>
			</Flex>

			<!-- Categorical error kind (always safe to display) -->
			<Flex v-if="errorKind" direction="column" gap="6" :class="$style.row">
				<span :class="$style.rowLabel">Reason</span>
				<span :class="$style.rowValue" data-testid="journal-detail-error-kind-tag">{{ humanizeErrorKind(errorKind) }}</span>
			</Flex>

			<!-- Timestamps -->
			<Flex v-if="createdAtLabel || terminalAtLabel" direction="column" gap="6" :class="$style.row">
				<span :class="$style.rowLabel">Times</span>
				<Flex direction="column" gap="2">
					<span v-if="createdAtLabel" :class="$style.rowValue">Started {{ createdAtLabel }}</span>
					<span v-if="terminalAtLabel" :class="$style.rowValue">Ended {{ terminalAtLabel }}</span>
				</Flex>
			</Flex>

			<!-- Developer-mode-gated raw error envelope -->
			<Flex v-if="showDevFields && (errorMessage || errorNormalizedRaw)" direction="column" gap="6" :class="$style.row">
				<span :class="$style.rowLabel">Error (developer mode)</span>
				<pre
					v-if="errorMessage"
					:class="$style.codeBlock"
					data-testid="journal-detail-error-message"
				>{{ errorMessage }}</pre>
				<pre
					v-if="errorNormalizedRaw"
					:class="$style.codeBlock"
					data-testid="journal-detail-error-raw"
				>{{ errorNormalizedRaw }}</pre>
			</Flex>
		</Flex>

		<Flex v-else-if="notFound" wide direction="column" align="center" gap="12" :class="$style.content">
			<span :class="$style.emptyHeadline">RECORD NOT FOUND</span>
			<span :class="$style.emptySub">This journal record isn't in your current activity feed.</span>
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
.content {
	padding: 4px 20px 24px 20px;
}
.statusRow {
	padding-top: 12px;
}
.statusLabel {
	font-family: var(--font-headline);
	font-size: 18px;
	font-weight: 700;
	letter-spacing: 0.02em;
	color: var(--txt-primary);
	text-transform: capitalize;
}
.statusSubtitle {
	font-family: var(--font-body);
	font-size: 13px;
	color: var(--txt-secondary);
}
.amountValue {
	font-family: var(--font-headline);
	font-size: 28px;
	font-weight: 700;
	color: var(--txt-primary);
	letter-spacing: -0.01em;
}
.amountSymbol {
	font-family: var(--font-mono);
	font-size: 14px;
	letter-spacing: 0.1em;
	color: var(--txt-secondary);
	margin-left: 6px;
}
.amountCaption {
	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-secondary);
}
.row {
	border-top: 1px solid var(--nulo-border);
	padding-top: 16px;
}
.rowLabel {
	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
}
.rowValue {
	font-family: var(--font-body);
	font-size: 14px;
	color: var(--txt-primary);
	word-break: break-word;
}
.codeBlock {
	font-family: var(--font-mono);
	font-size: 11px;
	background: var(--nulo-surface-low);
	padding: 8px 12px;
	border: 1px solid var(--nulo-border);
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--txt-secondary);
	margin: 0;
}
.emptyHeadline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.12em;
	color: var(--txt-secondary);
}
.emptySub {
	font-family: var(--font-body);
	font-size: 12px;
	line-height: 1.5;
	color: var(--nulo-secondary);
	text-align: center;
}
</style>
