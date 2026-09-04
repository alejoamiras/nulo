<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"

/** Components */
import StepStrip from "./StepStrip.vue"

/** Utils */
import type { Direction } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	direction: Direction
	step: 0 | 1 | 2
	completed: number
	/** False while a send is in flight: switching direction mid-flight would strand the plan on screen. */
	canSwitchDirection: boolean
}>()
const emit = defineEmits<{ "update:direction": [Direction]; goto: [number] }>()

const STEPS = [
	{ key: "token", label: "Token" },
	{ key: "amount", label: "Amount" },
	{ key: "review", label: "Review" },
] as const

const DIRECTIONS = [
	{ value: "l1-to-l2", label: "Ethereum → Aztec", testid: TESTIDS.sendDirectionDeposit },
	{ value: "l2-to-l1", label: "Aztec → Ethereum", testid: TESTIDS.sendDirectionExit },
] as const

const segment = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

const announcement = computed(() => `Step ${props.step + 1} of ${STEPS.length}: ${STEPS[props.step]?.label ?? ""}`)

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

		<StepStrip :steps="STEPS" :active="step" :completed="completed" @select="emit('goto', $event)" />

		<p class="announce" aria-live="polite" :data-testid="TESTIDS.sendStepAnnounce">{{ announcement }}</p>

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
}

/* Announced, never drawn: the strip already shows the step visually. */
.announce {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
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
