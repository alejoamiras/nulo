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
 * fee, no explorer URL.
 *
 * P10 brutalist restructure: mirrors `tx/[id].vue`'s information hierarchy
 * (hero_meta timestamps → optional amount block → categorical chip → origin
 * chip → details box → dev panel) using the same brutalist tokens (mono
 * labels, headline keys, 1px borders, no rounded corners). Reuses
 * tx/[id].vue's style vocabulary verbatim. The confirmed-tx detail page
 * is NOT touched.
 *
 * The categorical chip (P9 helper) distinguishes pre-broadcast failures
 * from interrupted-mid-flight, surfacing simulation-vs-on-chain UX without
 * exposing internal `JobError.kind` strings.
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
import {
	ACTIVITY_FEED_KINDS,
	categoricalLabel,
	humanizeErrorKind,
	journalTerminalDisplay,
	sanitizeJournalSubtitle,
} from "@/utils/journal-state"
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

// Method label (when title is set; pre-broadcast records may not have one).
const methodLabel = computed(() => {
	if (!op.value?.title) return null
	if (isTransfer.value) return null
	return humanizeMethodName(op.value.title)
})

// Recipient surface for transfer kinds (only populated post-broadcast on
// some paths; null otherwise). Trimmed for the row presentation.
const recipientLabel = computed(() => {
	const r = op.value?.recipientAddress
	if (!r) return null
	return `${r.slice(0, 6)}…${r.slice(-4)}`
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

// B2 categorical label (P9 helper). Wallet-controlled — consumes only
// op.error?.kind + op.kind + op.progress.stage. Never reads op.subtitle.
const category = computed(() => (op.value ? categoricalLabel(op.value) : null))

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

		<Flex v-if="op && display" wide direction="column" gap="20" :class="$style.content">
			<!-- Hero meta — terminal timestamp; matches tx/[id].vue's tx_time slot but
				 with the journal-record terminal time instead of an explorer link.
				 No chain hash / no explorer link branch because journal records have
				 no on-chain tx. -->
			<Flex align="center" justify="center" gap="8" :class="$style.hero_meta">
				<span v-if="terminalAtLabel" :class="$style.tx_time">{{ terminalAtLabel }}</span>
			</Flex>

			<!-- Transfer amount block (transfer kind only) -->
			<Flex v-if="isTransfer && amountDisplay" align="center" direction="column" gap="6">
				<span :class="$style.amount_value">
					{{ amountDisplay }}
					<span v-if="token?.symbol" :class="$style.amount_symbol">{{ token.symbol }}</span>
				</span>
				<span v-if="transferTypeLabel" :class="$style.amount_caption">{{ transferTypeLabel }}</span>
			</Flex>

			<!-- Transfer-type chip (transfer kind only) — mirrors tx/[id].vue. -->
			<div v-if="transferTypeLabel" :class="$style.category_chip" data-testid="journal-detail-transfer-type">
				{{ transferTypeLabel }}
			</div>

			<!-- Details box — mirrors tx/[id].vue's details_box. App/Method/To/etc.
				 surfaced as rows (not standalone chips) so the layout matches the
				 confirmed-tx detail page. -->
			<Flex wide direction="column" gap="10" :class="$style.details_box">
				<Flex v-if="category" wide direction="column" gap="4">
					<span :class="$style.detail_key">What happened</span>
					<span :class="$style.detail_context" data-testid="journal-detail-context">{{ category.context }}</span>
				</Flex>

				<Flex v-if="originChip" wide justify="between" align="center">
					<span :class="$style.detail_key">App</span>
					<span :class="$style.detail_value_mono" data-testid="journal-detail-origin">{{ originChip }}</span>
				</Flex>

				<Flex v-if="methodLabel" wide justify="between" align="center">
					<span :class="$style.detail_key">Method</span>
					<span :class="$style.detail_value_mono" data-testid="journal-detail-method">{{ methodLabel }}</span>
				</Flex>

				<Flex v-if="recipientLabel" wide justify="between" align="center">
					<span :class="$style.detail_key">To</span>
					<span :class="$style.detail_value_mono" data-testid="journal-detail-recipient">{{ recipientLabel }}</span>
				</Flex>

				<Flex v-if="category && category.label !== 'Error'" wide justify="between" align="center">
					<span :class="$style.detail_key">Outcome</span>
					<span :class="$style.detail_value_mono" data-testid="journal-detail-category">{{ category.label }}</span>
				</Flex>

				<Flex v-if="errorKind" wide justify="between" align="center">
					<span :class="$style.detail_key">Reason</span>
					<span :class="$style.detail_value_mono" data-testid="journal-detail-error-kind-tag">
						{{ humanizeErrorKind(errorKind) }}
					</span>
				</Flex>

				<Flex v-if="createdAtLabel" wide justify="between" align="center">
					<span :class="$style.detail_key">Started</span>
					<span :class="$style.detail_value_mono">{{ createdAtLabel }}</span>
				</Flex>

				<Flex v-if="terminalAtLabel" wide justify="between" align="center">
					<span :class="$style.detail_key">Ended</span>
					<span :class="$style.detail_value_mono">{{ terminalAtLabel }}</span>
				</Flex>

				<Flex wide justify="between" align="center">
					<span :class="$style.detail_key">State</span>
					<Flex align="center" gap="6">
						<Icon :name="display.icon" size="12" :color="display.color" />
						<span :class="$style.detail_value_mono" data-testid="journal-detail-state">{{ display.state }}</span>
					</Flex>
				</Flex>
			</Flex>

			<!-- Developer-mode-gated raw error envelope. Preserved verbatim per
				 user QA feedback ("I like the 'developer mode on' error showing"). -->
			<Flex v-if="showDevFields && (errorMessage || errorNormalizedRaw)" direction="column" gap="6" :class="$style.dev_box">
				<span :class="$style.detail_key">Error (developer mode)</span>
				<pre
					v-if="errorMessage"
					:class="$style.code_block"
					data-testid="journal-detail-error-message"
				>{{ errorMessage }}</pre>
				<pre
					v-if="errorNormalizedRaw"
					:class="$style.code_block"
					data-testid="journal-detail-error-raw"
				>{{ errorNormalizedRaw }}</pre>
			</Flex>
		</Flex>

		<Flex v-else-if="notFound" wide direction="column" align="center" gap="12" :class="$style.content">
			<span :class="$style.empty_headline">RECORD NOT FOUND</span>
			<span :class="$style.empty_sub">This journal record isn't in your current activity feed.</span>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	scrollbar-gutter: stable;
	background: var(--app-bg);
	padding-bottom: var(--nav-clearance);
}

.content {
	padding: 4px 20px 24px 20px;
}

/* Hero — mirrors tx/[id].vue */
.hero_meta {
	flex-wrap: wrap;
	row-gap: 4px;
}

.tx_time {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
}

/* Amount block — verbatim from tx/[id].vue tokens */
.amount_value {
	font-family: var(--font-mono);
	font-size: 24px;
	font-weight: 500;
	color: var(--txt-primary);
}

.amount_symbol {
	color: var(--nulo-secondary);
}

.amount_caption {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

/* Categorical chip — same pattern as tx/[id].vue's transfer_type_chip:
   inline pill, mono headline, uppercase, 1px border. */
.category_chip {
	align-self: center;

	padding: 5px 12px;
	border: 1px solid var(--nulo-border);
	background: transparent;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.15em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

/* Origin chip — small subtitle row above the details box */
.origin_row {
	align-self: center;
}

.origin_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.origin_value {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
	word-break: break-all;
}

/* Details box — mirrors tx/[id].vue details_box */
.details_box {
	padding: 12px;
	border: 1px solid var(--nulo-border);
	background: transparent;
}

.detail_key {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.detail_value_mono {
	font-family: var(--font-mono);
	font-size: 12px;
	font-weight: 600;
	color: var(--txt-primary);
}

.detail_context {
	font-family: var(--font-body);
	font-size: 12px;
	line-height: 1.5;
	color: var(--txt-primary);
}

/* Developer-mode error block — preserved styling */
.dev_box {
	padding: 12px;
	border: 1px solid var(--nulo-border);
	background: transparent;
}

.code_block {
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

/* Empty state — mirrors tx/[id].vue */
.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
	margin-top: 48px;
}

.empty_sub {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
	text-align: center;
}
</style>
