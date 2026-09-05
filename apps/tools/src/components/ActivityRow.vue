<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import type { ActivityRowModel } from "@/composables/useActivityFeed"
import type { ActivityAction } from "@/lib/activity"
import { TESTIDS } from "@/lib/testids"

/** A dock row never explains why: the word or button here, the reasons on the card it opens. */
const props = defineProps<{
	row: ActivityRowModel
	/** The row's own action is running. */
	acting?: boolean
	/** SWITCH is refused while another operation runs — the same gate the card applies. */
	switchLocked?: boolean
}>()

const emit = defineEmits<{
	open: [id: string]
	act: [id: string, action: Exclude<ActivityAction, null>]
}>()

const LABELS: Record<Exclude<ActivityAction, null>, string> = {
	claim: "CLAIM",
	finish: "FINISH",
	retry: "RETRY",
	"claim-gas": "CLAIM GAS",
	switch: "SWITCH",
}

const action = computed(() => props.row.action)
const label = computed(() => {
	if (!action.value) return ""
	if (props.acting) return action.value === "claim-gas" ? "CLAIMING…" : "WORKING…"
	return LABELS[action.value]
})
const disabled = computed(() => props.acting || (action.value === "switch" && props.switchLocked))
const title = computed(() => (action.value === "switch" && props.switchLocked ? "Finish the current operation to switch." : undefined))

/** Needs-you rows carry the accent; a done row's gas recovery is an outline, so one screen never
 *  shows two filled calls. */
const filled = computed(() => props.row.group === "needs-you")

const meta = computed(() => ({ head: `${props.row.route} · `, visibility: props.row.visibility, tail: ` · ${props.row.age}` }))

const side = computed(() => {
	const r = props.row
	if (r.group === "done") return "Bridged ✓"
	if (r.group === "running") return r.phase
	return "blocked"
})

function onAct(): void {
	if (action.value && !disabled.value) emit("act", props.row.id, action.value)
}
</script>

<template>
	<div
		class="row"
		:class="{ dim: row.group === 'done', 'has-button': !!action }"
		:data-testid="TESTIDS.activityRow"
		:data-record-id="row.id"
		:data-group="row.group"
		:data-action="action ?? undefined"
	>
		<span class="dot" :class="row.group" aria-hidden="true" />
		<button type="button" class="body" :data-testid="TESTIDS.activityRowOpen" @click="emit('open', row.id)">
			<span class="amt">{{ row.amount }} <small>{{ row.symbol }}</small></span>
			<span class="meta">{{ meta.head }}<b>{{ meta.visibility }}</b>{{ meta.tail }}</span>
		</button>
		<button
			v-if="action"
			type="button"
			class="side btn"
			:class="{ filled }"
			:disabled="disabled"
			:title="title"
			:aria-busy="acting || undefined"
			:data-testid="TESTIDS.activityRowAction"
			@click="onAct"
		>
			{{ label }}
		</button>
		<span v-else class="side" :class="row.group">{{ side }}</span>
	</div>
</template>

<style scoped>
.row {
	position: relative;
	display: grid;
	grid-template-columns: 12px minmax(0, 1fr) auto;
	column-gap: 8px;
	align-items: center;
	padding: 10px 0 11px 12px;
	border-top: 1px solid var(--nulo-border);
}

.dot {
	display: inline-block;
	width: 6px;
	height: 6px;
	background: var(--txt-secondary);
}

.dot.running {
	background: var(--txt-primary);
}

.dot.done {
	background: var(--mint);
}

.dot.needs-you {
	background: var(--nulo-accent);
}

.body {
	display: flex;
	flex-direction: column;
	gap: 5px;
	min-width: 0;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
}

.body:focus-visible {
	outline: 1px solid var(--txt-primary);
	outline-offset: 2px;
}

.amt {
	font: 600 12.5px/1 var(--font-mono);
	color: var(--txt-primary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.amt small {
	font-weight: 500;
	font-size: 11px;
	color: var(--txt-secondary);
}

.dim .amt {
	color: var(--txt-secondary);
}

.meta {
	font: 500 10.5px/1.3 var(--font-mono);
	color: var(--txt-tertiary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.meta b {
	font-weight: 500;
	color: var(--txt-secondary);
}

.side {
	font: 500 10.5px/1 var(--font-mono);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--txt-secondary);
	white-space: nowrap;
}

.side.done {
	color: var(--mint);
	text-transform: none;
}

.side.needs-you {
	color: var(--txt-primary);
}

.btn {
	padding: 8px 12px;
	border: 1px solid var(--txt-primary);
	background: transparent;
	color: var(--txt-primary);
	font: 700 11px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
}

.btn.filled {
	border-color: var(--nulo-accent);
	background: var(--nulo-accent);
	color: var(--txt-inverse);
}

.btn:disabled {
	opacity: 0.55;
	cursor: default;
}

.btn:focus-visible {
	outline: 1px solid var(--txt-primary);
	outline-offset: 2px;
}
</style>
