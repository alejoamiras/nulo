<script setup lang="ts">
/** Composables */
import { type Section, useShell } from "@/composables/useShell"

import { useMediaQuery } from "@/composables/useMediaQuery"

/** Utils */
import { useTemplateRef } from "vue"
import { TESTIDS } from "@/lib/testids"

/**
 * The left rail: three sections as one roving tablist (one Tab stop; ↑/↓ and ←/→ move between them).
 * The Activity count is a count, not a call — the needs-you accent lives on the dock's button or
 * the strip's badge, never here.
 */
const props = defineProps<{ activityCount: number }>()

const shell = useShell()
const rail = useTemplateRef<HTMLElement>("rail")
/** Under 760px the rail renders as a top row; the tablist says so. */
const topRow = useMediaQuery("(max-width: 760px)")

const ENTRIES: ReadonlyArray<{ key: Section; label: string; testid: string }> = [
	{ key: "send", label: "Send", testid: TESTIDS.tabSend },
	{ key: "drip", label: "Faucet", testid: TESTIDS.tabDrip },
	{ key: "activity", label: "Activity", testid: TESTIDS.tabActivity },
]

function move(from: number, delta: number): void {
	const next = (from + delta + ENTRIES.length) % ENTRIES.length
	const entry = ENTRIES[next]
	if (!entry) return
	shell.goTo(entry.key)
	rail.value?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus()
}
</script>

<template>
	<nav
		ref="rail"
		class="rail"
		role="tablist"
		aria-label="Sections"
		:aria-orientation="topRow ? 'horizontal' : 'vertical'"
		:data-testid="TESTIDS.tabs"
	>
		<button
			v-for="(entry, index) in ENTRIES"
			:key="entry.key"
			type="button"
			role="tab"
			class="entry"
			:class="{ on: shell.section.value === entry.key }"
			:aria-selected="shell.section.value === entry.key"
			:tabindex="shell.section.value === entry.key ? 0 : -1"
			:data-testid="entry.testid"
			:data-index="index"
			@click="shell.goTo(entry.key)"
			@keydown.up.prevent="move(index, -1)"
			@keydown.down.prevent="move(index, 1)"
			@keydown.left.prevent="move(index, -1)"
			@keydown.right.prevent="move(index, 1)"
		>
			<span>{{ entry.label }}</span>
			<span v-if="entry.key === 'activity' && props.activityCount > 0" class="count" aria-label="bridges needing you">{{ props.activityCount }}</span>
		</button>
	</nav>
</template>

<style scoped>
.rail {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.entry {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px;
	font: 600 13.5px/1 var(--font-headline);
	color: var(--txt-secondary);
	background: transparent;
	border: none;
	text-align: left;
	cursor: pointer;
	transition: color 0.15s ease, background 0.15s ease;
}

.entry:hover {
	color: var(--txt-primary);
}

.entry.on {
	color: var(--txt-primary);
	background: color-mix(in srgb, var(--txt-primary) 6%, transparent);
	box-shadow: inset 2px 0 0 var(--txt-primary);
}

.entry:focus-visible {
	outline: 1px solid var(--txt-primary);
	outline-offset: -1px;
}

.count {
	margin-left: auto;
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-secondary);
}

@media (max-width: 760px) {
	.rail {
		flex-direction: row;
		gap: 4px;
	}

	.entry.on {
		box-shadow: inset 0 -2px 0 var(--txt-primary);
	}
}
</style>
