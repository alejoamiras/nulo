<script setup lang="ts">
/** Utils */
import { useTemplateRef } from "vue"
import { TESTIDS } from "@/lib/testids"

export interface Step {
	key: string
	label: string
	/** What the user chose on this step; a completed step shows it in place of the label. */
	value?: string
	/** One line under the label; the vertical rail shows it, the horizontal strip has no room. */
	hint?: string
}

const props = withDefaults(
	defineProps<{
		steps: readonly Step[]
		active: number
		/** The highest step the user has already completed; everything past it is not navigable yet. */
		completed: number
		/** Vertical stacks the steps down a rail and moves with ↑/↓ as well as ←/→. */
		orientation?: "horizontal" | "vertical"
	}>(),
	{ orientation: "horizontal" },
)
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
	<div
		ref="strip"
		class="strip"
		:class="orientation"
		role="tablist"
		aria-label="Send steps"
		:aria-orientation="orientation"
		:data-testid="TESTIDS.sendStepStrip"
	>
		<template v-for="(step, index) in steps" :key="step.key">
			<span v-if="index > 0 && orientation === 'horizontal'" class="rule" aria-hidden="true" :data-reached="reachable(index) || undefined" />
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
				@keydown.up.prevent="orientation === 'vertical' && move(index, -1)"
				@keydown.down.prevent="orientation === 'vertical' && move(index, 1)"
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
				<span v-if="orientation === 'vertical' && step.hint" class="hint" aria-hidden="true">{{ step.hint }}</span>
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

/* The rail: one step per row, marker beside the label, the hint under it. Only the active marker
   carries the accent; a done marker is ink, so the card never lights more than one square. */
.vertical {
	flex-direction: column;
	align-items: stretch;
	padding: 16px 0;
}

.vertical .step {
	display: grid;
	grid-template-columns: 24px minmax(0, 1fr);
	column-gap: 10px;
	align-items: center;
	padding: 10px 18px;
	color: var(--txt-tertiary);
	text-align: left;
}

.vertical .step[data-state="done"],
.vertical .step[data-state="active"] {
	color: var(--txt-primary);
}

.vertical .marker {
	width: 24px;
	height: 24px;
	color: var(--txt-tertiary);
}

.vertical .step[data-state="done"] .marker {
	border-color: var(--txt-primary);
	color: var(--txt-primary);
}

.vertical .label {
	font: 600 11.5px/24px var(--font-mono);
	letter-spacing: 0.08em;
	overflow: hidden;
	text-overflow: ellipsis;
}

.hint {
	grid-column: 2;
	margin-top: 2px;
	font: 500 10.5px/1.4 var(--font-mono);
	letter-spacing: 0;
	text-transform: none;
	color: var(--txt-tertiary);
}

.vertical .step:focus-visible {
	outline: 1px solid var(--txt-primary);
	outline-offset: -1px;
}
</style>
