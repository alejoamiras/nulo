<script setup lang="ts">
/**
 * What this send publishes, for the sender to read before it goes. Everything shown is a prop and
 * every action an emit: the page owns the popup slot, the facts and the send.
 */
import { computed } from "vue"
import { maskAddress } from "@/components/composite/send/masked-address"
import {
	type FactCell,
	factWord,
	type PayerDescriptor,
	type PayerKind,
	paidBy,
	type PublishFacts,
	publishGlyph,
	rowSentence,
} from "@/components/composite/send/publish-facts"
import mark from "@/components/composite/send/publish-mark.module.css"
import { FEE_JUICE_BRIDGE_URL } from "./fee-helpers"

const props = defineProps<{
	show: boolean
	/** The popup slot's order — the z-index tier `Popup` stacks on. */
	order: number
	/** How many newer popups sit on top — what `PopupCard` displaces behind. */
	depth: number
	facts: PublishFacts
	amount?: string
	symbol?: string
	recipientName?: string
	recipientAddress?: string
	feeText?: string
	payerKind: PayerKind
	payerType?: PayerDescriptor["type"]
	canSend: boolean
	sending: boolean
	ready: boolean
}>()
const emit = defineEmits<{ close: []; send: [] }>()

const ROWS: { cell: FactCell; id: string; name: string }[] = [
	{ cell: "you", id: "you", name: "Your address" },
	{ cell: "recipient", id: "to", name: "Recipient" },
	{ cell: "amount", id: "amount", name: "Amount" },
]

const masked = computed(() => maskAddress(props.recipientAddress))
const toLine = computed(() => {
	const address = masked.value || "—"
	return props.recipientName ? `to ${props.recipientName} · ${address}` : `to ${address}`
})
const paid = computed(() => paidBy(props.payerKind, props.payerType))
const sendable = computed(() => props.show && props.canSend && props.ready && !props.sending)

const rows = computed(() =>
	ROWS.map((row) => {
		const visibility = props.facts[row.cell]
		return {
			...row,
			visibility,
			glyph: publishGlyph(visibility),
			word: factWord(row.cell, props.facts),
			sentence: rowSentence(row.cell, props.facts, props.payerKind),
			remedy: row.cell === "you" && visibility === "exposed",
			noticeShape: row.cell === "you" ? (props.facts.noticeShape ?? undefined) : undefined,
		}
	}),
)

// The button's disabled look mirrors this; the guard is what a programmatic click meets.
const handleSend = () => {
	if (sendable.value) emit("send")
}
</script>

<template>
	<div data-testid="send-review-sheet" :data-open="show" hidden />
	<Popup :show="show" :displaceIdx="order" initial-focus="#send-review-title" @onClose="emit('close')">
		<PopupCard :displaceIdx="depth" fit>
			<div role="dialog" aria-modal="true" aria-labelledby="send-review-title">
				<PopupHeader closable @onClose="emit('close')">
					<template #title>
						<span id="send-review-title" tabindex="-1" :class="$style.title">Review</span>
					</template>
				</PopupHeader>

				<Flex direction="column" gap="14" :class="$style.body">
					<div :class="$style.summary">
						<span :class="$style.amount" data-testid="send-review-amount">
							{{ amount || "—" }}<small v-if="amount && symbol">{{ symbol }}</small>
						</span>
						<span :class="$style.to" data-testid="send-review-recipient">{{ toLine }}</span>
					</div>

					<div :class="$style.rows">
						<div :class="$style.rows_head">This send publishes</div>
						<div
							v-for="row in rows"
							:key="row.cell"
							:class="[$style.row, mark[row.visibility]]"
							:data-testid="`send-review-row-${row.id}`"
							:data-visibility="row.visibility"
							:data-notice-shape="row.noticeShape"
						>
							<Icon v-if="row.glyph" :name="row.glyph" size="10" aria-hidden="true" :class="$style.row_mark" />
							<span v-else :class="$style.row_gap" aria-hidden="true" />
							<div :class="$style.row_body">
								<div :class="$style.row_top">
									<span>{{ row.name }}</span>
									<span :class="$style.row_word">{{ row.word }}</span>
								</div>
								<span v-if="row.sentence" :class="$style.why">{{ row.sentence }}</span>
								<a
									v-if="row.remedy"
									:href="FEE_JUICE_BRIDGE_URL"
									target="_blank"
									rel="noopener noreferrer"
									:class="$style.remedy"
									data-testid="send-fee-privacy-remedy"
								>Get private gas</a>
							</div>
						</div>
					</div>

					<div :class="$style.fee" data-testid="send-review-fee" :data-payer="payerKind ?? 'none'">
						<span>Fee · {{ feeText || "—" }}</span>
						<b v-if="paid">{{ paid }}</b>
					</div>

					<Button
						variant="cta"
						wide
						data-testid="send-review-submit"
						:data-ready="ready"
						:disabled="!sendable"
						:loading="sending"
						@click="handleSend"
					>
						Send now
					</Button>
				</Flex>
			</div>
		</PopupCard>
	</Popup>
</template>

<style module>
.title {
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--txt-primary);
}

.title:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 4px;
}

.body {
	padding: 4px 20px 24px;
}

.summary {
	display: flex;
	flex-direction: column;
	gap: 4px;

	padding-bottom: 12px;
	border-bottom: 1px solid var(--nulo-border);
}

.amount {
	font-family: var(--font-headline);
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.02em;
	line-height: 1;
	color: var(--txt-primary);
}

.amount small {
	margin-left: 4px;

	font-family: var(--font-mono);
	font-size: 11px;
	font-weight: 400;
	letter-spacing: 0;
	color: var(--nulo-secondary);
}

.to {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
}

.rows {
	display: flex;
	flex-direction: column;

	border: 1px solid var(--nulo-border);
}

.rows_head {
	padding: 6px 10px;
	border-bottom: 1px solid var(--nulo-border);

	font-family: var(--font-headline);
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.row {
	display: flex;
	gap: 8px;

	padding: 8px 10px;
	border-bottom: 1px solid var(--nulo-border);
}

.row:last-child {
	border-bottom: none;
}

.row_mark {
	flex: none;
	margin-top: 2px;
}

/* Keeps an unmarked row's words in line with the marked ones. */
.row_gap {
	flex: none;
	width: 10px;
}

.row_body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.row_top {
	display: flex;
	justify-content: space-between;
	gap: 8px;

	font-size: 11.5px;
	font-weight: 600;
	color: var(--txt-primary);
}

.row_word {
	font-family: var(--font-mono);
	font-size: 9.5px;
	font-weight: 500;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.why {
	font-size: 11px;
	font-weight: 500;
	line-height: 1.4;
	color: var(--txt-tertiary);
}

.remedy {
	align-self: flex-start;
	margin-top: 2px;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--orange);
	text-decoration: underline;
	text-underline-offset: 4px;
}

.fee {
	display: flex;
	justify-content: space-between;
	gap: 8px;

	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
}

.fee b {
	font-weight: 500;
	color: var(--txt-primary);
}
</style>
