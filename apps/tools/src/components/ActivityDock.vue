<script setup lang="ts">
/** Components */
import ActivityRow from "./ActivityRow.vue"
import DockStrip from "./DockStrip.vue"

/** Composables */
import { claimFuelStandalone } from "@/composables/fuel-recovery"
import type { ActivityFeed, ActivityRowModel } from "@/composables/useActivityFeed"
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useDockState } from "@/composables/useDockState"
import { useMediaQuery } from "@/composables/useMediaQuery"
import { useOpsInFlight } from "@/composables/useOpsInFlight"
import { useShell } from "@/composables/useShell"
import { useToast } from "@/composables/useToast"
import { switchActiveAccount } from "@/composables/useWalletConnection"

/** Utils */
import { computed, nextTick, onScopeDispose, ref, watch } from "vue"
import type { ActivityAction } from "@/lib/activity"
import { userMessage } from "@/lib/errors"
import { TESTIDS } from "@/lib/testids"

/**
 * The side list of every bridge the wizard is not showing, grouped by what it wants from you. It
 * dispatches to the same engine entry points the page card does, so a button here can never do
 * something the card would refuse. Open or hidden is the user's persisted choice; the dock opens
 * itself once per record that starts needing you, and never for one that is merely blocked.
 */
const props = defineProps<{ feed: ActivityFeed }>()

const shell = useShell()
const journal = useBridgeJournal()
const dock = useDockState()
const { push } = useToast()
const { busy: opsBusy } = useOpsInFlight()

const strip = ref<{ focus(): void } | null>(null)
const panel = ref<HTMLElement | null>(null)

/** Under 1100px the open dock leaves the grid and floats over the page; the strip stays put. */
const narrow = useMediaQuery("(max-width: 1100px)")
const overlay = computed(() => dock.open.value && narrow.value)

const groups = computed(() => {
	const g = props.feed.grouped.value
	return [
		{ key: "needs-you", title: "Needs you", rows: g.needsYou },
		{ key: "running", title: "Running", rows: g.running },
		{ key: "done", title: "Done", rows: g.done },
	].filter((x) => x.rows.length > 0)
})
const total = computed(() => props.feed.rows.value.length)
const needsYouIds = computed(() => props.feed.grouped.value.needsYou.map((r) => r.id))

async function hide(): Promise<void> {
	dock.hide(needsYouIds.value, props.feed.liveIds.value)
	await nextTick()
	strip.value?.focus()
}

/** The strip's chevron: opens the dock, or closes the overlay it sits beside. Focus moves into the
 *  overlay only on this explicit open — an auto-open must not take the keyboard away from a form. */
async function toggle(): Promise<void> {
	if (dock.open.value) return hide()
	dock.show()
	await nextTick()
	if (overlay.value) panel.value?.querySelector<HTMLElement>("button")?.focus()
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex="0"]'

/** While the overlay is up, Tab cycles inside it and Escape anywhere closes it — unless a wallet
 *  dialog (picker, account chooser, verification) is up, whose own keyboard handling comes first. */
function onKeydown(e: KeyboardEvent): void {
	if (!overlay.value || !panel.value) return
	const active = document.activeElement
	if (active && !panel.value.contains(active) && active.closest("[aria-modal='true']")) return
	if (e.key === "Escape") return void hide()
	if (e.key !== "Tab") return
	const items = panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)
	const first = items[0]
	const last = items[items.length - 1]
	if (!first || !last) return
	const outside = !panel.value.contains(document.activeElement)
	if (e.shiftKey && (outside || document.activeElement === first)) {
		e.preventDefault()
		last.focus()
	} else if (!e.shiftKey && (outside || document.activeElement === last)) {
		e.preventDefault()
		first.focus()
	}
}

watch(
	overlay,
	(on) => {
		if (on) window.addEventListener("keydown", onKeydown)
		else window.removeEventListener("keydown", onKeydown)
	},
	{ immediate: true },
)
onScopeDispose(() => window.removeEventListener("keydown", onKeydown))

watch(props.feed.autoOpenIds, (ids) => dock.autoOpenFor(ids, props.feed.liveIds.value), { immediate: true })

/** Which rows show CLAIMING…; the entry point itself joins a run already in flight. */
const gasInFlight = ref<ReadonlySet<string>>(new Set())
async function claimGas(id: string): Promise<void> {
	if (gasInFlight.value.has(id)) return
	gasInFlight.value = new Set([...gasInFlight.value, id])
	try {
		await claimFuelStandalone(id)
	} catch (e) {
		push({ kind: "error", text: userMessage(e, "Could not claim your gas. Try again from Activity.") })
	} finally {
		gasInFlight.value = new Set([...gasInFlight.value].filter((x) => x !== id))
	}
}

function act(id: string, action: Exclude<ActivityAction, null>): void {
	const row = props.feed.rows.value.find((r) => r.id === id)
	if (!row) return
	if (action === "claim-gas") return void claimGas(id)
	if (action === "switch") {
		if (!opsBusy.value && row.switchTarget) switchActiveAccount(row.switchTarget)
		return
	}
	// claim / finish / retry all re-enter the record's own run; the engine's record lock dedups.
	if (row.direction === "deposit") void journal.runDepositClaim(id)
	else void journal.runWithdrawConsume(id)
}

function acting(row: ActivityRowModel): boolean {
	return row.action === "claim-gas" && gasInFlight.value.has(row.id)
}
</script>

<template>
	<DockStrip v-if="!dock.open.value || narrow" ref="strip" :count="feed.count.value" :open="dock.open.value" @open="toggle" />
	<aside
		v-if="dock.open.value"
		ref="panel"
		class="dock"
		:class="{ overlay }"
		:role="overlay ? 'dialog' : undefined"
		:aria-modal="overlay || undefined"
		:aria-label="overlay ? 'Activity' : undefined"
		:data-testid="TESTIDS.dock"
	>
		<div class="head">
			<h2>Activity</h2>
			<button type="button" class="hide" :data-testid="TESTIDS.dockHide" @click="hide">Hide ›</button>
		</div>
		<div class="groups">
			<p v-if="total === 0" class="empty">Bridges you start or background land here.</p>
			<section v-for="g in groups" :key="g.key" class="group" :data-testid="TESTIDS.dockGroup" :data-group="g.key">
				<h3><span>{{ g.title }}</span><span>{{ g.rows.length }}</span></h3>
				<ActivityRow
					v-for="row in g.rows"
					:key="row.id"
					:row="row"
					:acting="acting(row)"
					:switch-locked="opsBusy"
					@open="shell.openActivity"
					@act="act"
				/>
			</section>
		</div>
		<div class="foot">
			<button type="button" class="all" :data-testid="TESTIDS.dockAll" @click="shell.goTo('activity')">All activity →</button>
			<span>{{ total }} {{ total === 1 ? "record" : "records" }}</span>
		</div>
	</aside>
</template>

<style scoped>
.dock {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	width: 300px;
	max-height: 100vh;
	min-width: 0;
	border-left: 1px solid var(--nulo-outline);
}

.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex: none;
	height: 72px;
	padding: 0 16px;
	border-bottom: 1px solid var(--nulo-outline);
}

.head h2 {
	margin: 0;
	font: 600 13px/1 var(--font-headline);
	color: var(--txt-primary);
}

.hide,
.all {
	padding: 0;
	border: 0;
	background: transparent;
	font: 500 10.5px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
	cursor: pointer;
}

.hide:hover,
.hide:focus-visible,
.all:hover,
.all:focus-visible {
	color: var(--txt-primary);
	outline: none;
}

.groups {
	flex: 1;
	overflow-y: auto;
}

.empty {
	margin: 0;
	padding: 18px 16px;
	font: 500 11px/1.5 var(--font-mono);
	color: var(--txt-tertiary);
}

.group {
	padding: 14px 16px 4px;
}

.group h3 {
	display: flex;
	justify-content: space-between;
	margin: 0;
	padding: 0 0 6px 12px;
	font: 500 10px/1 var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
}

.foot {
	display: flex;
	justify-content: space-between;
	flex: none;
	margin-top: auto;
	padding: 12px 16px;
	border-top: 1px solid var(--nulo-outline);
	font: 500 10.5px/1 var(--font-mono);
	letter-spacing: 0.06em;
	color: var(--txt-tertiary);
}

.dock.overlay {
	position: fixed;
	top: 0;
	right: 44px;
	bottom: 0;
	z-index: 20;
	max-height: none;
	background: var(--app-bg);
	box-shadow: -14px 0 34px rgba(0, 0, 0, 0.18);
}

@media (max-width: 760px) {
	.dock.overlay {
		width: auto;
		left: 0;
	}
}
</style>
