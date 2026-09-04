<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"

/** Components */
import StepStrip, { type Step } from "./StepStrip.vue"

/** Utils */
import type { Direction } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	direction: Direction
	step: 0 | 1 | 2
	completed: number
	/** False while a send is in flight: switching direction mid-flight would strand the plan on screen. */
	canSwitchDirection: boolean
	/** The chosen token and amount, shown on their steps once the user has moved past them. */
	tokenLabel?: string
	amountLabel?: string
}>()
const emit = defineEmits<{ "update:direction": [Direction]; goto: [number] }>()

const CAPTION = {
	token: "what are you sending?",
	amount: "how much, and what should arrive?",
	review: "check it, then sign.",
} as const

const steps = computed<Step[]>(() => [
	{ key: "token", label: "Token", value: props.tokenLabel },
	{ key: "amount", label: "Amount", value: props.amountLabel },
	{ key: "review", label: "Review" },
])

const DIRECTIONS = [
	{ value: "l1-to-l2", label: "Ethereum → Aztec", testid: TESTIDS.sendDirectionDeposit },
	{ value: "l2-to-l1", label: "Aztec → Ethereum", testid: TESTIDS.sendDirectionExit },
] as const

const segment = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

const caption = computed(() => {
	const key = (["token", "amount", "review"] as const)[props.step]
	return `Step ${props.step + 1} of ${steps.value.length} — ${CAPTION[key]}`
})

// A step swap replaces the whole panel, which would otherwise drop focus to <body> and make the
// keyboard user Tab back in from the top of the page. Not on mount: arriving is not a step change.
watch(
	() => props.step,
	async () => {
		await nextTick()
		panel.value?.focus()
	},
)

function pick(direction: Direction): void {
	if (!props.canSwitchDirection || direction === props.direction) return
	emit("update:direction", direction)
}

/** Roving tablist: the segment is ONE Tab stop and ←/→ move both selection and focus, so the two
 *  directions never cost the keyboard user two stops between the header and the first field. */
function onArrow(delta: number): void {
	if (!props.canSwitchDirection) return
	const index = DIRECTIONS.findIndex((d) => d.value === props.direction)
	const nextIndex = (index + delta + DIRECTIONS.length) % DIRECTIONS.length
	emit("update:direction", DIRECTIONS[nextIndex].value)
	segment.value?.querySelectorAll<HTMLElement>("[role='tab']")[nextIndex]?.focus()
}
</script>

<template>
	<section class="wizard">
		<div
			ref="segment"
			class="segment"
			role="tablist"
			aria-label="Send direction"
			:data-testid="TESTIDS.sendDirection"
			:data-direction="direction"
			:data-locked="!canSwitchDirection"
		>
			<button
				v-for="option in DIRECTIONS"
				:key="option.value"
				type="button"
				role="tab"
				class="seg"
				:class="{ sel: direction === option.value }"
				:aria-selected="direction === option.value"
				:tabindex="direction === option.value ? 0 : -1"
				:disabled="!canSwitchDirection"
				:data-testid="option.testid"
				@click="pick(option.value)"
				@keydown.left.prevent="onArrow(-1)"
				@keydown.right.prevent="onArrow(1)"
			>
				{{ option.label }}
			</button>
		</div>

		<div class="steps">
			<StepStrip :steps="steps" :active="step" :completed="completed" @select="emit('goto', $event)" />
			<p class="caption" aria-live="polite" :data-testid="TESTIDS.sendStepAnnounce">{{ caption }}</p>
		</div>

		<div ref="panel" tabindex="-1" :data-testid="TESTIDS.sendStepPanel">
			<slot v-if="step === 0" name="token" />
			<slot v-else-if="step === 1" name="amount" />
			<slot v-else name="review" />
		</div>
	</section>
</template>

<style scoped>
.wizard {
	display: flex;
	flex-direction: column;
	gap: 20px;
	padding: 24px;
	border: 1px solid var(--nulo-outline);
	background: var(--card-bg);
}

.steps {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.caption {
	margin: 0;
	font: 500 11.5px/1.4 var(--font-mono);
	color: var(--txt-tertiary);
}

.segment {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 4px;
	padding: 4px;
	background: color-mix(in srgb, var(--txt-primary) 4%, transparent);
}

.seg {
	padding: 10px 14px;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font: 600 13px/1 var(--font-mono);
	letter-spacing: 0.04em;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease;
}

.seg:hover:not(:disabled) {
	color: var(--txt-primary);
}

.seg.sel {
	color: var(--txt-primary);
	background: color-mix(in srgb, var(--txt-primary) 10%, transparent);
}

.seg:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}
</style>
