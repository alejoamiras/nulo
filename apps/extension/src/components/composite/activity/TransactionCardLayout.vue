<script setup lang="ts">
import { Comment, type PropType, ref, useId, useSlots } from "vue"
import type { JobStage, ProveBackend } from "@nulo/wallet-core/jobs"
import RowTarget from "@/components/ui/RowTarget.vue"
/**
 * The one layout every activity card composes, so field positions stay identical across the
 * lifecycle: [activity icon + badge] [title (+ trailing) / secondary] [amount column], with an
 * optional `#actions` corner. It owns the row's interactivity: with `to` the row is a link, with
 * `opens` a button whose press emits `activate`, otherwise it is inert.
 *
 * `txAmountDisplay` / `txTransferTypeLabel` / `txStatus` / `txHash` bind as `data-tx-*` on the
 * root and `stage` / `backend` as `data-stage` / `data-backend`, the facts e2e waits on; Vue omits
 * a null binding.
 */
const props = defineProps({
	title: { type: String, required: true },
	icon: { type: String, required: true },
	iconRotate: { type: [String, Number], default: 0 },
	amount: { type: String, default: null },
	amountSymbol: { type: String, default: null },
	/** `≈ $x.xx` line under the amount — omitted (null) when unpriced. */
	amountFiat: { type: String, default: null },
	testId: { type: String, default: undefined },
	txAmountDisplay: { type: String, default: undefined },
	txTransferTypeLabel: { type: String, default: undefined },
	txStatus: { type: String, default: undefined },
	txHash: { type: String, default: undefined },
	stage: { type: String as PropType<JobStage | null>, default: null },
	/** Where a `proving` op's proof runs, once known. Binds as `data-backend`. */
	backend: { type: String as PropType<ProveBackend | null>, default: null },
	/** Number of 24px buttons in `#actions`; sizes the right-side reservation. */
	actionCount: { type: Number, default: 1 },
	/** The route the row opens. */
	to: { type: String, default: undefined },
	/** The row opens something that is not a route: a press emits `activate`. */
	opens: { type: Boolean, default: false },
	/** The row is a receipt arriving now: it slides in and glows. */
	arriving: { type: Boolean, default: false },
})

const emit = defineEmits(["activate"])

const titleId = useId()
const target = ref<{ activate: () => void } | null>(null)

function onRootClick() {
	if (props.opens) emit("activate")
}

/**
 * Slot presence does not prove rendered content: `<template #actions><Btn v-if="false"/></template>`
 * yields a comment VNode. A method, not a `computed`: slot VNodes are not reactive dependencies.
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
		:data-backend="backend"
		:data-arriving="arriving ? 'true' : undefined"
		:class="[
			$style.wrapper,
			(to || opens) && $style.interactive,
			arriving && [$style['n-row-in'], $style['n-row-glow']],
			hasActionsContent() && $style.wrapper_has_actions,
			hasActionsContent() && actionCount > 1 && $style.wrapper_two_actions,
		]"
		@click="onRootClick"
	>
		<RowTarget v-if="to || opens" ref="target" :to="to" :labelledby="titleId" />

		<Flex align="center" gap="16" :class="$style.left_content">
			<Flex align="center" justify="center" :class="$style.activity_icon">
				<Icon :name="icon" :rotate="iconRotate" size="18" color="secondary" />
				<div v-if="$slots.badge" :class="$style.badge">
					<slot name="badge" />
				</div>
			</Flex>

			<Flex direction="column" gap="4" :class="$style.text">
				<Flex align="center" gap="6">
					<span :id="titleId" :class="$style.title">{{ title }}</span>
					<slot name="title-trailing" />
				</Flex>
				<Flex v-if="$slots.secondary" align="center" gap="6" :class="$style.secondary_row">
					<slot name="secondary" />
				</Flex>
			</Flex>
		</Flex>

		<Flex v-if="amount" direction="column" align="end" gap="2" :class="$style.amount_col">
			<span :class="[$style.amount, arriving && $style['n-amt']]">{{ amount }}</span>
			<span v-if="amountSymbol" :class="$style.amount_symbol">{{ amountSymbol }}</span>
			<!-- Raised above the target so its title shows; `.stop` so a press opens the row once. -->
			<span
				v-if="amountFiat"
				data-testid="activity-fiat"
				title="At today's price"
				:class="[$style.amount_fiat, (to || opens) && $style.raised]"
				@click.stop="target?.activate()"
			>
				{{ amountFiat }}
			</span>
		</Flex>

		<div v-if="hasActionsContent()" :class="$style.actions">
			<slot name="actions" />
		</div>
	</Flex>
</template>

<style module>
.wrapper {
	position: relative;
	margin: 0 -8px;
	padding: 6px 8px;
}

.interactive {
	cursor: pointer;
	transition: background 0.15s var(--bezier);

	&:hover,
	&:has(> [data-row-target]:focus-visible) {
		background: var(--nulo-surface-low);
	}

	&:has(> [data-row-target]:focus-visible) {
		outline: 2px solid var(--nulo-accent);
		outline-offset: -2px;
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

/* One 24px action plus 4px of air, inside the 8px side padding. */
.wrapper_has_actions {
	padding-right: 36px;
}

.wrapper_two_actions {
	padding-right: 60px;
}

.actions {
	position: absolute;
	top: 6px;
	right: 8px;
	z-index: 1;
	display: flex;
	align-items: center;
}

.raised {
	position: relative;
	z-index: 1;
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

.amount_fiat {
	font-family: var(--font-mono);
	font-size: 9px;
	color: var(--nulo-secondary);
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

.n-row-in {
	animation: n-row-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.n-row-glow {
	animation: n-row-glow 2.4s ease-out 0.2s both;
}

.n-row-in.n-row-glow {
	animation:
		n-row-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both,
		n-row-glow 2.4s ease-out 0.2s both;
}

.n-amt {
	animation: n-amt 2.6s ease-out both;
}

@keyframes n-row-in {
	from {
		opacity: 0;
		transform: translateY(-10px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@keyframes n-row-glow {
	0% {
		background: color-mix(in srgb, var(--green), transparent 84%);
	}
	100% {
		background: transparent;
	}
}

@keyframes n-amt {
	0%,
	70% {
		color: var(--green);
	}
	100% {
		color: var(--txt-primary);
	}
}
</style>
