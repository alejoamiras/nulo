<script setup lang="ts">
/** Utils */
import { useTemplateRef } from "vue"
import { TESTIDS } from "@/lib/testids"

export interface Step {
	key: string
	label: string
	/** What the user chose on this step; a completed step shows it in place of the label. */
	value?: string
}

const props = defineProps<{
	steps: readonly Step[]
	active: number
	/** The highest step the user has already completed; everything past it is not navigable yet. */
	completed: number
}>()
const emit = defineEmits<{ select: [index: number] }>()

const strip = useTemplateRef<HTMLElement>("strip")

function reachable(index: number): boolean {
	return index <= props.completed
}

function stateOf(index: number): "active" | "done" | "todo" {
	if (index === props.active) return "active"
	return reachable(index) ? "done" : "todo"
}

function textOf(step: Step, index: number): string {
	return stateOf(index) === "done" && step.value ? step.value : step.label
}

/** The step keeps its name for assistive tech even when the strip shows the chosen value instead. */
function nameOf(step: Step, index: number): string {
	return stateOf(index) === "done" && step.value ? `${step.label}: ${step.value}` : step.label
}

function choose(index: number): void {
	if (reachable(index)) emit("select", index)
}

// Focus follows the arrow keys across every step (a locked one is still readable), but only a
// reachable step selects — arrowing onto a step the wizard has not unlocked must not jump the user
// ahead of the data the later steps depend on.
function move(from: number, delta: number): void {
	const count = props.steps.length
	if (count === 0) return
	const next = (from + delta + count) % count
	strip.value?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus()
	choose(next)
}
</script>

<template>
	<div ref="strip" class="strip" role="tablist" aria-label="Send steps" :data-testid="TESTIDS.sendStepStrip">
		<template v-for="(step, index) in steps" :key="step.key">
			<span v-if="index > 0" class="rule" aria-hidden="true" :data-reached="reachable(index) || undefined" />
			<button
				type="button"
				role="tab"
				class="step"
				:data-testid="TESTIDS.sendStep"
				:data-step="step.key"
				:data-index="index"
				:data-state="stateOf(index)"
				:aria-label="nameOf(step, index)"
				:aria-selected="index === active"
				:aria-disabled="reachable(index) ? undefined : 'true'"
				:tabindex="index === active ? 0 : -1"
				@click="choose(index)"
				@keydown.left.prevent="move(index, -1)"
				@keydown.right.prevent="move(index, 1)"
				@keydown.enter.prevent="choose(index)"
				@keydown.space.prevent="choose(index)"
			>
				<span class="marker" aria-hidden="true">
					<svg v-if="stateOf(index) === 'done'" class="check" viewBox="0 0 12 12" focusable="false">
						<path d="M2 6.5 4.8 9.2 10 3.5" />
					</svg>
					<template v-else>{{ index + 1 }}</template>
				</span>
				<span class="label">{{ textOf(step, index) }}</span>
			</button>
		</template>
	</div>
</template>

<style scoped>
.strip {
	display: flex;
	align-items: center;
}

.rule {
	flex: 1;
	height: 1px;
	margin: 0 14px;
	background: var(--nulo-outline);
}

.rule[data-reached] {
	background: var(--nulo-accent);
}

.step {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 0;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	cursor: pointer;
}

.step[data-state="todo"] {
	cursor: default;
}

.step[data-state="done"] {
	color: var(--txt-primary);
}

.step[data-state="active"] {
	color: var(--nulo-accent);
}

.marker {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	border: 1px solid var(--nulo-outline);
	font: 700 11px/1 var(--font-mono);
}

.step[data-state="done"] .marker {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.step[data-state="active"] .marker {
	border-color: var(--nulo-accent);
	background: var(--nulo-accent);
	color: var(--txt-inverse);
}

.check {
	width: 12px;
	height: 12px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
}

.label {
	white-space: nowrap;
}
</style>
