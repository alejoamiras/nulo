<script setup lang="ts">
/** Utils */
import { useTemplateRef } from "vue"
import { TESTIDS } from "@/lib/testids"

export interface Step {
	key: string
	label: string
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
		<button
			v-for="(step, index) in steps"
			:key="step.key"
			type="button"
			role="tab"
			class="step"
			:data-testid="TESTIDS.sendStep"
			:data-step="step.key"
			:data-index="index"
			:data-state="stateOf(index)"
			:aria-selected="index === active"
			:aria-disabled="reachable(index) ? undefined : 'true'"
			:tabindex="index === active ? 0 : -1"
			@click="choose(index)"
			@keydown.left.prevent="move(index, -1)"
			@keydown.right.prevent="move(index, 1)"
			@keydown.enter.prevent="choose(index)"
			@keydown.space.prevent="choose(index)"
		>
			<span class="num">{{ index + 1 }}</span>
			<span class="label">{{ step.label }}</span>
		</button>
	</div>
</template>

<style scoped>
.strip {
	display: flex;
	gap: 8px;
}

.step {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-secondary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
}

.step[data-state="todo"] {
	cursor: default;
	opacity: 0.55;
}

.step[data-state="done"] {
	color: var(--txt-primary);
}

.step[data-state="active"] {
	color: var(--nulo-accent);
	border-color: var(--nulo-accent);
}

.num {
	font-weight: 700;
}

.label {
	white-space: nowrap;
}
</style>
