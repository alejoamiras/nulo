<script setup lang="ts">
/** Utils */
import { computed, useTemplateRef } from "vue"
import type { SendIntent } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	intent: SendIntent
	/** An exit has one outcome: the token goes back to Ethereum. */
	exitOnly: boolean
	/** The token IS the gas asset, so its gas leg needs no swap. */
	feeAsset: boolean
	noRoute: boolean
}>()
const emit = defineEmits<{ "update:intent": [intent: SendIntent] }>()

interface Choice {
	key: SendIntent
	testid: string
	label: string
	desc: string
}

const NO_ROUTE_REASON = "This token can't buy Aztec gas on the way in."

const choices = computed<Choice[]>(() => {
	const token: Choice = {
		key: "token",
		testid: TESTIDS.sendChoiceToken,
		label: "TOKEN",
		desc: props.exitOnly ? "Your tokens go back to your Ethereum wallet." : "Only the token arrives.",
	}
	if (props.exitOnly) return [token]
	const oneForOne = props.feeAsset ? " One for one." : ""
	return [
		token,
		{ key: "token+gas", testid: TESTIDS.sendChoiceTokenGas, label: "TOKEN + GAS", desc: `Part of it arrives as gas.${oneForOne}` },
		{ key: "gas", testid: TESTIDS.sendChoiceGas, label: "GAS", desc: `All of it arrives as gas.${oneForOne}` },
	]
})

function enabled(choice: Choice): boolean {
	return choice.key === "token" || !props.noRoute
}

const cards = useTemplateRef<HTMLElement>("cards")

function choose(choice: Choice): void {
	if (enabled(choice)) emit("update:intent", choice.key)
}

// Arrow keys walk only the choices the user can actually take: a disabled cell is not a tab stop, so
// stepping onto it would strand focus outside the group.
function move(from: number, delta: number): void {
	const list = choices.value
	const count = list.length
	for (let step = 1; step <= count; step++) {
		const index = (((from + delta * step) % count) + count) % count
		const choice = list[index]
		if (choice && enabled(choice)) {
			cards.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus()
			emit("update:intent", choice.key)
			return
		}
	}
}
</script>

<template>
	<div ref="cards" class="segment" role="tablist" aria-label="What arrives" :data-testid="TESTIDS.sendChoiceCards" :data-count="choices.length">
		<button
			v-for="(choice, index) in choices"
			:key="choice.key"
			type="button"
			role="tab"
			class="cell"
			:data-testid="choice.testid"
			:data-index="index"
			:data-selected="choice.key === intent || undefined"
			:aria-selected="choice.key === intent"
			:disabled="!enabled(choice)"
			:title="enabled(choice) ? undefined : NO_ROUTE_REASON"
			:tabindex="choice.key === intent ? 0 : -1"
			@click="choose(choice)"
			@keydown.left.prevent="move(index, -1)"
			@keydown.right.prevent="move(index, 1)"
			@keydown.enter.prevent="choose(choice)"
			@keydown.space.prevent="choose(choice)"
		>
			<span class="label">{{ choice.label }}</span>
			<span class="desc">{{ choice.desc }}</span>
		</button>
	</div>
</template>

<style scoped>
.segment {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(0, 1fr);
	gap: 4px;
	padding: 4px;
	background: color-mix(in srgb, var(--txt-primary) 4%, transparent);
}

.cell {
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 10px 14px;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	text-align: left;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease;
}

.cell:hover:not(:disabled) {
	color: var(--txt-primary);
}

.cell[data-selected] {
	color: var(--txt-primary);
	background: color-mix(in srgb, var(--txt-primary) 10%, transparent);
}

.cell:disabled {
	cursor: not-allowed;
	opacity: 0.45;
}

.label {
	font: 700 12px/1 var(--font-mono);
	letter-spacing: 0.08em;
}

.desc {
	font: 500 11px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}
</style>
