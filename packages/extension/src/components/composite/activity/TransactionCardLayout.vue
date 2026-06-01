<script setup>
import { Comment } from "vue"
/**
 * Shared presentational layout for activity cards. Both
 * `TransactionAwaitingCard` (in-flight, TaskService / journal-driven) and
 * `TransactionCard` (settled, transaction-history-driven) compose this so
 * field positions stay byte-identical across the lifecycle. Field-position
 * drift between in-flight and settled was the user-flagged regression for
 * dApp txs (see plan-v4 Branch 4).
 *
 * The layout is intentionally narrow:
 *   [activity_icon + badge] [title (+ trailing slot) / secondary slot] [amount column]
 *
 * Slots:
 *   - badge: top-right corner indicator on the activity icon (spinner, check,
 *     close, etc.). Wrapped here in a unified shell so its absolute positioning
 *     and bg padding are consistent across phases.
 *   - title-trailing: anything that should sit inline beside the title (e.g.
 *     external-link icon on settled cards).
 *   - secondary: the second line. Free-form so callers can drop chips, hash
 *     slices, status text — whatever the phase needs. Caller is responsible
 *     for rendering only when there's content; the wrapper Flex always exists
 *     for vertical-rhythm parity.
 *   - actions: top-right corner of the card (NOT the activity-icon corner; that's
 *     the `badge` slot). Used by awaiting + terminal cards for Cancel / Retry
 *     icon buttons. Absolute-positioned via `.actions`; the wrapper becomes
 *     `position: relative` whenever this slot is used. May visually overlap
 *     the top of the amount column on UI transfer cards — acceptable trade-off
 *     given the 3-row visual budget.
 *
 * Props:
 *   - title: required, the canonical line-1 string. Stays put across phases.
 *   - icon: main activity icon (Custom Icon name).
 *   - amount, amountSymbol: optional right column.
 *   - testId: passes through to the root for e2e selectors.
 *   - txAmountDisplay / txTransferTypeLabel / txStatus / txHash: optional
 *     pass-through props that bind as `data-tx-*` attributes on the root.
 *     Settled `TransactionCard` fills these so e2e tests can synchronize
 *     on the user-visible card state (the amount text, the transfer-type
 *     chip label, the status icon, the hash slice — all things the user
 *     sees). Awaiting / terminal cards leave them blank; Vue omits
 *     `null`/`undefined` data-attribute bindings.
 *   - stage: optional journal FSM stage (pending / queued / simulating /
 *     proving / submitting / succeeded / failed / cancelled). Binds as
 *     `data-stage` on the root. The awaiting card threads its `stage` prop
 *     here so e2e tests can wait for the wallet's in-flight tx to reach a
 *     specific stage — fast-path alternative to waiting on the dApp's
 *     full sendTx promise. Settled cards leave it null.
 */
defineProps({
	title: { type: String, required: true },
	icon: { type: String, required: true },
	amount: { type: String, default: null },
	amountSymbol: { type: String, default: null },
	testId: { type: String, default: undefined },
	txAmountDisplay: { type: String, default: undefined },
	txTransferTypeLabel: { type: String, default: undefined },
	txStatus: { type: String, default: undefined },
	txHash: { type: String, default: undefined },
	stage: { type: String, default: undefined },
})

/**
 * `$slots.actions` is truthy whenever a parent declares `<template #actions>`
 * — even when the template renders zero real VNodes (e.g. `<Btn v-if="false"/>`
 * inside, which compiles to a comment VNode). The wrapper-padding + absolute
 * container should only kick in when the slot actually paints something.
 *
 * MUST NOT use `computed()` here: slot vnodes are NOT reactive deps, and the
 * slots proxy doesn't always re-trigger on declared/undeclared transitions.
 * A computed evaluates once and caches a wrong answer if `cancellable` was
 * false at first paint and flipped true on a later parent render (regression
 * shipped in the first cut of this fix — see git blame). Calling a regular
 * method from the template re-evaluates every parent render, which is exactly
 * what we want.
 */
const slots = useSlots()
function hasActionsContent() {
	const slot = slots.actions
	if (typeof slot !== "function") return false
	try {
		const vnodes = slot() ?? []
		return vnodes.some((v) => {
			if (v.type === Comment) return false
			if (typeof v.children === "string" && v.children.trim() === "") return false
			return true
		})
	} catch {
		return false
	}
}
</script>

<template>
	<Flex
		align="center"
		justify="between"
		gap="10"
		:data-testid="testId"
		:data-tx-amount-display="txAmountDisplay"
		:data-tx-transfer-type="txTransferTypeLabel"
		:data-tx-status="txStatus"
		:data-tx-hash="txHash"
		:data-stage="stage"
		:class="[$style.wrapper, hasActionsContent() && $style.wrapper_has_actions]"
	>
		<Flex align="center" gap="16" :class="$style.left_content">
			<Flex align="center" justify="center" :class="$style.activity_icon">
				<Icon :name="icon" size="18" color="secondary" />
				<div v-if="$slots.badge" :class="$style.badge">
					<slot name="badge" />
				</div>
			</Flex>

			<Flex direction="column" gap="4" :class="$style.text">
				<Flex align="center" gap="6">
					<span :class="$style.title">{{ title }}</span>
					<slot name="title-trailing" />
				</Flex>
				<Flex v-if="$slots.secondary" align="center" gap="6" :class="$style.secondary_row">
					<slot name="secondary" />
				</Flex>
			</Flex>
		</Flex>

		<Flex v-if="amount" direction="column" align="end" gap="2" :class="$style.amount_col">
			<span :class="$style.amount">{{ amount }}</span>
			<span v-if="amountSymbol" :class="$style.amount_symbol">{{ amountSymbol }}</span>
		</Flex>

		<div v-if="hasActionsContent()" :class="$style.actions">
			<slot name="actions" />
		</div>
	</Flex>
</template>

<style module>
.wrapper {
	padding: 8px 0;
	position: relative;
}

/**
 * Reserve 20px on the right when the actions slot is filled so the
 * absolute-positioned X doesn't overlap the amount column (16px X +
 * 4px breathing room). User-tuned: anything larger pushed the amount
 * column off-balance against the title row.
 *
 * The transfer-direction chip used to sit in the secondary row and
 * fought this reservation for space; it now lives in `#title-trailing`
 * (next to the title), so the secondary row has plenty of width for
 * subtitle + originLabel even with the X inside the card.
 */
.wrapper_has_actions {
	padding-right: 20px;
}

/* `top: 6px` puts the X visually just below the card's top edge — anchored
 * to the corner but not jammed into it. Tuned manually against a real
 * in-flight card. */
.actions {
	position: absolute;
	top: 6px;
	right: 0;
	display: flex;
	align-items: center;
}

.left_content {
	min-width: 0;
}

.activity_icon {
	position: relative;
	flex-shrink: 0;

	width: 40px;
	height: 40px;

	background: var(--nulo-surface-low);
	border: 1px solid rgba(74, 70, 63, 0.3);
}

.badge {
	position: absolute;
	top: -6px;
	right: -6px;

	display: flex;
	align-items: center;
	justify-content: center;

	box-sizing: content-box;
	background: var(--app-bg);
	border: 2px solid var(--app-bg);
	border-radius: 50%;
}

.text {
	min-width: 0;
}

.title {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
}

.secondary_row {
	min-height: 14px;
}

.amount_col {
	flex-shrink: 0;
}

.amount {
	font-family: var(--font-mono);
	font-size: 14px;
	font-weight: 500;
	color: var(--txt-primary);
}

.amount_symbol {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-outline);
}
</style>
