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

const HINT = {
	token: "what are you sending?",
	amount: "how much, what arrives",
	review: "check it, then sign",
} as const

const steps = computed<Step[]>(() => [
	{ key: "token", label: "Token", value: props.tokenLabel, hint: HINT.token },
	{ key: "amount", label: "Amount", value: props.amountLabel, hint: HINT.amount },
	{ key: "review", label: "Review", hint: HINT.review },
])

const DIRECTIONS = [
	{ value: "l1-to-l2", label: "Ethereum → Aztec", testid: TESTIDS.sendDirectionDeposit },
	{ value: "l2-to-l1", label: "Aztec → Ethereum", testid: TESTIDS.sendDirectionExit },
] as const

const segment = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

const position = computed(() => `Step ${props.step + 1} of ${steps.value.length}`)
const caption = computed(() => {
	const key = (["token", "amount", "review"] as const)[props.step]
	return `${position.value} — ${CAPTION[key]}`
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
		<div class="head">
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
			<span class="position" aria-hidden="true">{{ position }}</span>
		</div>

		<!-- The live caption carries the step's name and hint to assistive tech; sighted users read
		     them off the rail, so it stays out of the layout. -->
		<p class="sr-only" aria-live="polite" :data-testid="TESTIDS.sendStepAnnounce">{{ caption }}</p>

		<div class="body">
			<StepStrip :steps="steps" :active="step" :completed="completed" orientation="vertical" @select="emit('goto', $event)" />
			<div ref="panel" class="panel" tabindex="-1" :data-testid="TESTIDS.sendStepPanel">
				<slot v-if="step === 0" name="token" />
				<slot v-else-if="step === 1" name="amount" />
				<slot v-else name="review" />
			</div>
		</div>
	</section>
</template>

<style scoped>
.wizard {
	width: 100%;
	border: 1px solid var(--nulo-outline);
	background: var(--card-bg);
}

.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 0 20px;
	border-bottom: 1px solid var(--nulo-outline);
}

.segment {
	display: flex;
	gap: 20px;
}

/* Underline tabs: the chosen direction is ink on a 2px rule that sits on the head's border. */
.seg {
	margin-bottom: -1px;
	padding: 15px 0 13px;
	border: 0;
	border-bottom: 2px solid transparent;
	background: transparent;
	color: var(--txt-secondary);
	font: 600 11.5px/1 var(--font-mono);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
	transition: color 0.15s ease;
}

.seg:hover:not(:disabled) {
	color: var(--txt-primary);
}

.seg.sel {
	color: var(--txt-primary);
	border-bottom-color: var(--txt-primary);
}

.seg:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.seg:focus-visible {
	outline: 1px solid var(--txt-primary);
	outline-offset: 2px;
}

.position {
	flex: none;
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-tertiary);
}

.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
	border: 0;
}

.body {
	display: grid;
	grid-template-columns: 168px minmax(0, 1fr);
}

.body > :first-child {
	border-right: 1px solid var(--nulo-outline);
}

.panel {
	padding: 20px;
}

.panel:focus {
	outline: none;
}

@media (max-width: 760px) {
	.body {
		grid-template-columns: 1fr;
	}

	.body > :first-child {
		border-right: 0;
		border-bottom: 1px solid var(--nulo-outline);
	}
}
</style>
