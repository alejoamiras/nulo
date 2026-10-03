<script setup>
/**
 * Terminal phase of the activity card for a journal record with no settled `TransactionService`
 * row. It wraps `TransactionCardLayout`, so every field sits where the awaiting and settled cards
 * put it and only the badge changes between phases. `subtitle`, `icon` and `color` come verbatim
 * from `journalTerminalDisplay` (`@/utils/journal-state.ts`); every color it returns needs a
 * `subtitle_<color>` rule below.
 *
 * Plain `<script setup>`, like `TransactionAwaitingCard.vue`: vue-tsc cannot type the slots of
 * its untyped consumers.
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
	 *  "gray" | "amber" | "red" | "green". */
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
	/** The route the row opens. */
	to: { type: String, default: undefined },
})
</script>

<template>
	<TransactionCardLayout :title="title" :icon="activityIcon" :amount="amount" :amountSymbol="amountSymbol" :to="to" testId="tx-terminal-card">
		<template #badge>
			<Icon :name="icon" size="12" :color="color" :class="$style.status_icon" :data-color="color" />
		</template>

		<template v-if="transferTypeLabel || originLabel" #title-trailing>
			<span :class="$style.title_sep">·</span>
			<span :class="$style.chip">{{ transferTypeLabel || originLabel }}</span>
		</template>

		<template #secondary>
			<span :class="[$style.subtitle, $style[`subtitle_${color}`]]" role="status" aria-live="polite" aria-atomic="true" data-testid="tx-terminal-subtitle">{{ subtitle }}</span>
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
	color: var(--red);
}
.subtitle_green {
	color: var(--green);
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
	border: 1px solid var(--hairline-soft);
	padding: 1px 4px;
}
</style>
