<script setup>
/**
 * Terminal-state phase of an activity card for journal records that
 * ended WITHOUT producing an on-chain transaction.
 *
 * Wraps `TransactionCardLayout` so field positions stay byte-identical
 * with `TransactionAwaitingCard` (in-flight phase) and `TransactionCard`
 * (settled on-chain phase). Visual difference is the badge slot: a
 * colored status icon (gray circle-minus / amber refresh-cw / red
 * close-circle) instead of the spinner or success-check.
 *
 * Three user-facing states the journal can land in without going
 * on-chain — see `@/utils/journal-state.ts` for the kind→state mapping:
 *
 *   - Cancelled (color="gray"):  user-initiated, neutral
 *   - Interrupted (color="amber"): wallet was interrupted (SW restart,
 *     prove stuck) — recoverable
 *   - Failed (color="red"):  real failure (network, simulation, prover, …)
 *
 * Caller pipes the mapped `subtitle` / `icon` / `color` straight from
 * `journalTerminalDisplay(op)`. The title row mirrors the in-flight
 * card's contract (token symbol for transfers; humanized op.title for
 * dapp_execute), so users see the same field stay put as the card flips
 * lifecycle phase.
 *
 * Sibling `TransactionAwaitingCard.vue` uses plain `<script setup>` (no
 * lang="ts") for parity with the slot-typing limitations of vue-tsc on
 * untyped child slot consumers; we match that convention here.
 */
import TransactionCardLayout from "./TransactionCardLayout.vue"

defineProps({
	/** Title row content. Token symbol for transfers; humanized op title
	 *  for dapp_execute. Same convention as the awaiting card. */
	title: { type: String, required: true },
	/** State-specific subtitle copy. Comes verbatim from journalTerminalDisplay. */
	subtitle: { type: String, required: true },
	/** Icon name for the status badge (e.g. "cancel", "refresh-circle",
	 *  "close-circle"). Mapped per-state by journalTerminalDisplay. */
	icon: { type: String, required: true },
	/** Status color. Drives the icon color + visual tone. One of
	 *  "gray" | "amber" | "red". */
	color: { type: String, required: true },
	/** Activity-row icon (left of the badge). Same convention as the
	 *  awaiting card: "arrow-narrow-up-right" for UI transfers, "zap" for
	 *  generic dApp ops. */
	activityIcon: { type: String, default: "zap" },
	/** Origin chip — for dApp-initiated txs, the dApp hostname. UI-initiated
	 *  transfers leave this null and the chip is suppressed. */
	originLabel: { type: String, default: null },
	/** Privacy-direction chip ("Private → Public" etc.) for UI transfers.
	 *  Mutually exclusive with originLabel — transfer-kind ops carry only
	 *  transferTypeLabel; dapp_execute-kind ops carry only originLabel. */
	transferTypeLabel: { type: String, default: null },
	amount: { type: String, default: null },
	amountSymbol: { type: String, default: null },
})
</script>

<template>
	<TransactionCardLayout :title="title" :icon="activityIcon" :amount="amount" :amountSymbol="amountSymbol" testId="tx-terminal-card">
		<template #badge>
			<Icon :name="icon" size="12" :color="color" :class="$style.status_icon" :data-color="color" />
		</template>

		<template v-if="transferTypeLabel || originLabel" #title-trailing>
			<span :class="$style.title_sep">·</span>
			<span :class="$style.chip">{{ transferTypeLabel || originLabel }}</span>
		</template>

		<template #secondary>
			<span :class="[$style.subtitle, $style[`subtitle_${color}`]]" role="status" aria-live="polite" aria-atomic="true">{{ subtitle }}</span>
		</template>
	</TransactionCardLayout>
</template>

<style module>
.status_icon {
	/* Inherits the absolute-positioned badge wrapper from TransactionCardLayout */
}

.subtitle {
	font-family: var(--font-mono);
	font-size: 10px;
}

.subtitle_gray {
	color: var(--nulo-secondary);
}
.subtitle_amber {
	color: var(--yellow);
}
.subtitle_red {
	color: var(--nulo-error, #f85149);
}

/* Title-trailing chip + separator. Mirrors the awaiting + settled cards
 * so the chip stays put across the lifecycle (badge swap is the only
 * visible difference between phases). */
.title_sep {
	font-family: var(--font-headline);
	font-size: 13px;
	color: var(--nulo-outline);
	user-select: none;
}

.chip {
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
</style>
