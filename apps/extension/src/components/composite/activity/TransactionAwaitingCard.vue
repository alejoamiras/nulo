<script setup lang="ts">
/**
 * In-flight phase of an activity card. Wraps `TransactionCardLayout` so its
 * field positions stay byte-identical with `TransactionCard` (the settled
 * phase). The only visible difference between phases is the badge slot
 * (spinner here vs. status icon there) and the secondary-row content.
 *
 * Phase 2 follow-up: optional Cancel surface. When `cancellable: true` AND
 * `jobId` is non-null, renders a small `close` icon button at the top-right
 * of the card and emits `cancel` on click. Parent (RecentActivityView) wires
 * the emit to `ExecutionService.cancelJob(jobId)`. The button is hidden when
 * `stage === "submitting"` because the FSM forbids `submitting → cancelled`
 * at that point — removing the affordance is structurally honest (better than
 * a silent no-op click).
 *
 * While a dApp request is `queued` its approval popup may be open on another
 * display; the card is then a button that emits `focus` (click, Enter, Space)
 * so the parent can ask the SW to bring that window to the front.
 */
import { computed, type PropType } from "vue"
import type { JobStage } from "@nulo/wallet-core/jobs"
import TransactionCardLayout from "./TransactionCardLayout.vue"

const props = defineProps({
	title: { type: String, default: "Creating transaction" },
	/** Default kept terse on purpose. The orphan-fallback render paths in
	 *  `RecentActivityView.vue` mount this card without an explicit subtitle,
	 *  so the default surfaces to real users. A longer default ("Estimating
	 *  fees, generating proofs...") overflows the 150px secondary-row text
	 *  column even before the transfer-direction chip lands next to it. */
	subtitle: { type: String, default: "Preparing..." },
	/** Origin chip — for dApp-initiated txs, this is the dApp hostname. UI-initiated
	 *  transfers leave this null and the chip is suppressed. */
	originLabel: { type: String, default: null },
	/** Activity icon. Defaults to "zap" for the generic dApp case; UI transfers
	 *  pass the same arrow-narrow-up-right that the settled card uses. */
	icon: { type: String, default: "zap" },
	amount: { type: String, default: null },
	amountSymbol: { type: String, default: null },
	/** Privacy-direction chip ("Private → Public" etc.). Suppressed when null —
	 *  e.g. dApp ops we don't synthesize a transfer type for. The parent
	 *  resolves it via `formatTransferType(op.transferType)`. */
	transferTypeLabel: { type: String, default: null },
	/** Phase 2 follow-up: enable the Cancel button. Renders only when
	 *  `cancellable && jobId && stage !== "submitting"`. */
	cancellable: { type: Boolean, default: false },
	/** Journal id to cancel. Emitted with the `cancel` event so multi-card
	 *  render paths (RecentActivityView with N concurrent in-flight ops)
	 *  cancel the correct journal record from the correct button — the
	 *  parent can't infer which card was clicked from a payload-less emit. */
	jobId: { type: String, default: null },
	/** Current journal stage. When `"submitting"`, the Cancel button is
	 *  hidden — the FSM forbids `submitting → cancelled` and the SW would
	 *  silently drop the signal. Removing the affordance is the cleaner UX.
	 *  Typed via `JobStage` so e2e selectors that key off `data-stage` can
	 *  rely on the literal set defined in `@nulo/wallet-core/jobs`. */
	stage: { type: String as PropType<JobStage | null>, default: null },
})

const emit = defineEmits(["cancel", "focus"])

/** `queued` is the only stage at which an approval popup can exist. */
const focusable = computed(() => Boolean(props.jobId) && props.stage === "queued")

function onActivate() {
	if (focusable.value) emit("focus", props.jobId)
}

function onKeydown(event: KeyboardEvent) {
	// Self-targeted only: Enter/Space on the Cancel button must not bubble into a focus.
	if (!focusable.value || event.target !== event.currentTarget) return
	if (event.key !== "Enter" && event.key !== " ") return
	event.preventDefault()
	emit("focus", props.jobId)
}
</script>

<template>
	<div
		:class="[$style.card, focusable && $style.focusable]"
		:tabindex="focusable ? 0 : undefined"
		:role="focusable ? 'button' : undefined"
		:title="focusable ? 'Show the approval window' : undefined"
		@click="onActivate"
		@keydown="onKeydown"
	>
		<TransactionCardLayout
			:title="title"
			:icon="icon"
			:amount="amount"
			:amountSymbol="amountSymbol"
			:stage="stage"
			testId="tx-awaiting-card"
		>
			<template #badge>
				<Spinner size="10" color="--nulo-accent" />
			</template>

			<template v-if="transferTypeLabel || originLabel" #title-trailing>
				<span :class="$style.title_sep">·</span>
				<span :class="$style.transfer_chip">{{ transferTypeLabel || originLabel }}</span>
			</template>

			<template #secondary>
				<span :class="$style.subtitle" role="status" aria-live="polite" aria-atomic="true">{{ subtitle }}</span>
			</template>

			<template v-if="cancellable && jobId && stage !== 'submitting'" #actions>
				<button
					type="button"
					:class="$style.action_btn"
					aria-label="Cancel transaction"
					data-testid="tx-awaiting-cancel"
					@click.stop="emit('cancel', jobId)"
				>
					<Icon name="close" size="14" color="secondary" />
				</button>
			</template>
		</TransactionCardLayout>
	</div>
</template>

<style module>
.card {
	display: contents;
}

.focusable {
	display: block;
	cursor: pointer;
}
.focusable:focus-visible {
	outline: 2px solid var(--nulo-accent);
	outline-offset: -2px;
}

/* Subtitle takes whatever horizontal room it can after the chip; truncates
 * with ellipsis when the chip pushes back. min-width: 0 + flex: 0 1 auto
 * let it shrink below its intrinsic width inside the Flex parent. */
.subtitle {
	flex: 0 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;

	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

/* Subtle separator between the title and the title-trailing chip.
 * Matches the settled card's separator so the lifecycle reads identical. */
.title_sep {
	font-family: var(--font-headline);
	font-size: 13px;
	color: var(--nulo-outline);
	user-select: none;
}

/* Mirror TransactionCard's secondary-row chip styling so the awaiting and
 * settled phases read identically once the wallet swaps the badge. */
.transfer_chip {
	flex-shrink: 0;
	white-space: nowrap;

	font-family: var(--font-mono);
	font-size: 8px;
	text-transform: uppercase;
	color: var(--nulo-secondary);
	background: var(--nulo-surface-low);
	border: 1px solid rgba(74, 70, 63, 0.2);
	padding: 1px 4px;
}

/* User-tuned: 16px wide is below W3C's 24x24 touch-target minimum on the
 * width axis. The wallet is a desktop popup (cursor-precision input, not
 * touch), and the button stays 28px tall — the clickable area is 16x28,
 * still a clean rectangular hit zone. */
.action_btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 16px;
	height: 28px;
	padding: 0;
	background: transparent;
	border: 0;
	cursor: pointer;
	color: var(--nulo-secondary);
	transition: color 0.15s var(--bezier);
}
.action_btn:hover {
	color: var(--txt-primary);
}
.action_btn:focus-visible {
	outline: 2px solid var(--nulo-accent);
	outline-offset: -2px;
	border-radius: 4px;
}
</style>
