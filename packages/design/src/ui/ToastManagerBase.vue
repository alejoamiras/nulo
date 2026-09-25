<script setup lang="ts">
/** Vendor */
import { onBeforeUnmount, onMounted, ref, watch } from "vue"

/** Composables */
import { type ToastState, useToast } from "../composables/toast"

/** Components */
import Icon from "../core/Icon.vue"
import MaterialIcon from "../core/MaterialIcon.vue"

// Host-DOM contract: teleports the snack regions to `teleportTo` (default `#toast`); the consuming
// app must declare that root. `bottomInset` is the gap above the viewport's bottom edge. `inColumn`
// says the page is the `--base-width` column centred in a wider viewport, so the card spans that
// column less 16px a side.
withDefaults(defineProps<{ teleportTo?: string; bottomInset?: number; inColumn?: boolean }>(), {
	teleportTo: "#toast",
	bottomInset: 12,
	inColumn: false,
})

const { toast, closeToast, holdToast } = useToast()

/** The snack the regions render: a copy of the shared toast that lags it while a card is leaving. */
const shown = ref<ToastState | null>(null)
let leaveWaiting = false

// One card at a time, across both regions: when the old card must leave before the new one rises
// (a replacement of the other kind, or a close), `shown` empties and `after-leave` installs the
// shared toast as it is at that moment — never a copy taken earlier, so a close during the wait
// installs nothing.
const hovered = ref(false)
const focusWithin = ref(false)
let returnFocusTo: Element | null = null

// A card that appears under a still cursor gets hover events, and may get a move, all at the cursor's
// last position. So only a move away from where the pointer rested when the card opened holds it;
// with no position known then, the first move anywhere after the open gives that spot.
type Point = { x: number; y: number }
let pointer: Point | null = null
let restedAt: Point | null = null
const trackPointer = (event: PointerEvent) => {
	pointer = { x: event.clientX, y: event.clientY }
	restedAt ??= pointer
}

watch([hovered, focusWithin], ([h, f]) => holdToast(h || f))

const show = (next: ToastState | null) => {
	hovered.value = false
	focusWithin.value = false
	restedAt = pointer
	shown.value = next
}

watch(
	toast,
	(next) => {
		if (leaveWaiting) return
		const current = shown.value
		if (current && (!next || next.kind !== current.kind)) {
			leaveWaiting = true
			show(null)
			return
		}
		show(next ?? null)
	},
	{ flush: "sync", immediate: true },
)

const onAfterLeave = () => {
	if (!leaveWaiting) return
	leaveWaiting = false
	show(toast.value ?? null)
}

// Under a pixel apart is rounding between a real move and one the browser synthesised at the same spot.
const onPointerMove = (event: PointerEvent) => {
	if (restedAt === null) return
	if (Math.abs(event.clientX - restedAt.x) >= 1 || Math.abs(event.clientY - restedAt.y) >= 1) hovered.value = true
}

const onFocusIn = (event: FocusEvent) => {
	if (!focusWithin.value) returnFocusTo = event.relatedTarget instanceof Element ? event.relatedTarget : null
	focusWithin.value = true
}

const onFocusOut = (event: FocusEvent) => {
	const card = event.currentTarget as HTMLElement
	if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return
	focusWithin.value = false
}

// A leaving card keeps its listeners while `shown` already holds its successor, so each control is
// bound at render to the snack its card shows and does nothing once that snack is gone.
const closeFor = (id: number) => () => {
	if (shown.value?.id !== id) return
	const target = focusWithin.value ? returnFocusTo : null
	closeToast()
	if (target instanceof HTMLElement && target.isConnected) target.focus()
}

const selectFor = (id: number) => () => {
	if (shown.value?.id !== id) return
	const action = shown.value.action
	closeToast()
	action?.onSelect()
}

onMounted(() => document.addEventListener("pointermove", trackPointer, { capture: true, passive: true }))

onBeforeUnmount(() => {
	document.removeEventListener("pointermove", trackPointer, { capture: true })
	hovered.value = false
	focusWithin.value = false
	holdToast(false)
})
</script>

<template>
	<Teleport :to="teleportTo" defer>
		<div :class="[$style.wrap, inColumn && $style.in_column]" :style="{ bottom: `${bottomInset}px` }">
			<div role="status" aria-live="polite" aria-atomic="true" :class="$style.region">
				<Transition
					mode="out-in"
					:enter-from-class="$style.enter_from"
					:enter-active-class="$style.enter_active"
					:leave-to-class="$style.leave_to"
					:leave-active-class="$style.leave_active"
					@after-leave="onAfterLeave"
				>
					<div
						v-if="shown && shown.kind === 'success'"
						:key="shown.id"
						:class="$style.card"
						data-testid="snackbar"
						data-kind="success"
						@pointermove="onPointerMove"
						@mouseleave="hovered = false"
						@focusin="onFocusIn"
						@focusout="onFocusOut"
					>
						<Icon name="check-circle" size="16" color="green" aria-hidden="true" />
						<div :class="$style.text">
							<span :class="$style.title" data-testid="snackbar-title">{{ shown.label }}</span>
							<span v-if="shown.sub" :class="$style.sub" data-testid="snackbar-sub">{{ shown.sub }}</span>
						</div>
						<button v-if="shown.action" type="button" :class="$style.action" data-testid="snackbar-action" :onClick="selectFor(shown.id)">
							{{ shown.action.label }}
						</button>
					</div>
				</Transition>
			</div>
			<div role="alert" aria-atomic="true" :class="$style.region">
				<Transition
					mode="out-in"
					:enter-from-class="$style.enter_from"
					:enter-active-class="$style.enter_active"
					:leave-to-class="$style.leave_to"
					:leave-active-class="$style.leave_active"
					@after-leave="onAfterLeave"
				>
					<div
						v-if="shown && shown.kind === 'error'"
						:key="shown.id"
						:class="[$style.card, $style.error]"
						data-testid="snackbar"
						data-kind="error"
						@pointermove="onPointerMove"
						@mouseleave="hovered = false"
						@focusin="onFocusIn"
						@focusout="onFocusOut"
					>
						<Icon name="close-circle" size="16" color="red" aria-hidden="true" />
						<div :class="$style.text">
							<span :class="$style.title" data-testid="snackbar-title">{{ shown.label }}</span>
							<span v-if="shown.sub" :class="$style.sub" data-testid="snackbar-sub">{{ shown.sub }}</span>
						</div>
						<button v-if="shown.action" type="button" :class="$style.action" data-testid="snackbar-action" :onClick="selectFor(shown.id)">
							{{ shown.action.label }}
						</button>
						<button type="button" :class="$style.close" aria-label="Close" data-testid="snackbar-close" :onClick="closeFor(shown.id)">
							<MaterialIcon name="close" :size="16" color="secondary" />
						</button>
					</div>
				</Transition>
			</div>
		</div>
	</Teleport>
</template>

<style module>
.wrap {
	position: fixed;
	left: 0;
	right: 0;
	z-index: 2000;
	display: grid;
	pointer-events: none;
}

.region {
	grid-area: 1 / 1;
	display: flex;
	justify-content: center;
}

.card {
	display: flex;
	align-items: center;
	gap: 10px;
	width: calc(100% - 32px);
	max-width: 368px;
	padding: 12px 14px;
	background: var(--nulo-surface-high);
	border: 1px solid var(--nulo-outline);
	box-shadow: 0 8px 24px rgba(10, 9, 8, 0.45);
	color: var(--txt-primary);
	pointer-events: auto;
}

.in_column .card {
	max-width: calc(var(--base-width) - 32px);
}

.error {
	border-color: var(--red);
}

.text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
	overflow-wrap: anywhere;
}

.title {
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.sub {
	font-size: 11px;
	color: var(--nulo-secondary);
}

.action {
	flex: none;
	padding: 6px 4px;
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--nulo-accent);
	background: none;
	border: 0;
	cursor: pointer;
}

.close {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	margin-right: -6px;
	flex: none;
	padding: 0;
	color: var(--nulo-secondary);
	background: none;
	border: 0;
	cursor: pointer;
}

.enter_active,
.leave_active {
	transition:
		opacity 0.15s var(--bezier),
		transform 0.15s var(--bezier);
}

.enter_from,
.leave_to {
	opacity: 0;
	transform: translateY(20px);
}

@media (prefers-reduced-motion: reduce) {
	.enter_from,
	.leave_to {
		transform: none;
	}
}
</style>
