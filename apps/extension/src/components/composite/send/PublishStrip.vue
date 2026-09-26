<script setup lang="ts">
import { computed } from "vue"
import { type FactCell, factWord, type PublishFacts, publishGlyph, stripAriaLabel } from "./publish-facts"
import mark from "./publish-mark.module.css"

const props = defineProps<{ facts: PublishFacts }>()
const emit = defineEmits<{ open: [] }>()

const CELLS: { cell: FactCell; name: string; attr: string }[] = [
	{ cell: "you", name: "You", attr: "you" },
	{ cell: "recipient", name: "To", attr: "to" },
	{ cell: "amount", name: "Amount", attr: "amount" },
]

const label = computed(() => stripAriaLabel(props.facts))
const cells = computed(() => CELLS.map((c) => ({ ...c, glyph: publishGlyph(props.facts[c.cell]) })))
</script>

<template>
	<button
		type="button"
		:class="$style.strip"
		data-testid="send-publish-strip"
		:data-you="facts.you"
		:data-to="facts.recipient"
		:data-amount="facts.amount"
		:aria-label="label"
		@click="emit('open')"
	>
		<span v-for="{ cell, name, attr, glyph } in cells" :key="cell" :class="[$style.cell, mark[facts[cell]]]" :data-cell="attr">
			<Icon v-if="glyph" :name="glyph" size="10" aria-hidden="true" />
			<b :class="$style.name">{{ name }}</b>
			<span :class="$style.word">{{ factWord(cell, facts) }}</span>
		</span>
		<span :class="$style.chevron" aria-hidden="true">
			<MaterialIcon name="chevron_right" :size="15" color="secondary" />
		</span>
	</button>
</template>

<style module>
.strip {
	display: flex;
	width: 100%;
	padding: 0;

	font: inherit;
	color: inherit;
	text-align: left;

	background: none;
	border: 1px solid var(--nulo-border);
	cursor: pointer;

	transition: background 0.15s var(--bezier);
}

.strip:hover {
	background: var(--nulo-surface-low);
}

.strip:focus-visible {
	outline: 2px solid var(--nulo-accent);
	outline-offset: 2px;
}

.cell {
	flex: 1 1 auto;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 5px;

	padding: 6px 2px;
	border-right: 1px solid var(--nulo-border);

	font-family: var(--font-mono);
	font-size: 8.5px;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	white-space: nowrap;
}

.name {
	font-family: var(--font-headline);
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--nulo-secondary);
}

.word {
	font-weight: 500;
}

.chevron {
	flex: 0 0 20px;
	display: flex;
	align-items: center;
	justify-content: center;
}
</style>
