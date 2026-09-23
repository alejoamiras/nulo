<script setup lang="ts">
/** Utils */
import { ref } from "vue"
import { TESTIDS } from "@/lib/testids"

/** The hidden dock: a chevron to reopen it, a vertical label, and one badge that exists only while
 *  a bridge needs you and the dock is closed (open, its buttons are the signal). Running never badges. */
defineProps<{ count: number; open?: boolean }>()
const emit = defineEmits<{ open: [] }>()

const openEl = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => openEl.value?.focus() })
</script>

<template>
	<aside class="strip" :data-testid="TESTIDS.dockStrip">
		<button
			ref="openEl"
			type="button"
			class="open"
			:data-testid="TESTIDS.dockOpen"
			:aria-label="open ? 'Hide activity' : count > 0 ? `Show activity, ${count} need you` : 'Show activity'"
			@click="emit('open')"
		>
			{{ open ? "›" : "‹" }}
			<span v-if="count > 0 && !open" class="badge" :data-testid="TESTIDS.dockBadge">{{ count }}</span>
		</button>
		<span class="lbl" aria-hidden="true">Activity</span>
	</aside>
</template>

<style scoped>
.strip {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	width: 44px;
	max-height: 100vh;
	border-left: 1px solid var(--nulo-outline);
}

.open {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 72px;
	padding: 0;
	border: 0;
	border-bottom: 1px solid var(--nulo-outline);
	background: transparent;
	color: var(--txt-tertiary);
	font: 500 14px/1 var(--font-mono);
	cursor: pointer;
}

.open:hover,
.open:focus-visible {
	color: var(--txt-primary);
	outline: none;
}

.open:focus-visible {
	box-shadow: inset 0 0 0 1px var(--txt-primary);
}

.badge {
	position: absolute;
	top: 10px;
	right: 5px;
	min-width: 16px;
	height: 16px;
	padding: 0 4px;
	background: var(--nulo-accent);
	color: var(--txt-inverse);
	font: 700 9.5px/16px var(--font-mono);
	text-align: center;
}

.lbl {
	margin-top: 16px;
	writing-mode: vertical-rl;
	font: 500 9.5px/1 var(--font-mono);
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
}
</style>
