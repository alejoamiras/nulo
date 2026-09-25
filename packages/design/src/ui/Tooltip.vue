<!-- Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0. -->
<script setup lang="ts">
/**
 * Vendor
 */
import { ref, reactive, nextTick, watch, onBeforeUnmount } from "vue"
import type { PropType, VNode } from "vue"

/** Utils */
import { placeTooltip } from "./tooltip-placement"

const props = defineProps({
	side: {
		type: String as PropType<"top" | "bottom" | "left" | "right">,
		default: "bottom",
		validator: (value: string) => {
			return ["top", "bottom", "left", "right"].includes(value)
		},
	},
	position: {
		type: String as PropType<"start" | "end" | "center">,
		default: "center",
		validator: (value: string) => {
			return ["start", "end", "center"].includes(value)
		},
	},

	textAlign: { type: String as PropType<"center" | "left" | "right">, default: "center" },
	wide: { type: Boolean, default: null },
	disabled: { type: Boolean, default: false },
	delay: { type: [String, Number], default: 0 },
	/** Narrows the text below the bubble's width cap (CSS length string, e.g. "220px"), for a short
	 *  trigger with long copy. */
	maxWidth: { type: String, default: undefined },
	/** Lays the trigger out inline on the text baseline, so it can sit inside a sentence. */
	inline: { type: Boolean, default: false },
	// Host-DOM contract: the consuming app must declare this teleport root (the extension declares
	// `#tooltip` in its popup/onboarding shells).
	teleportTo: { type: String, default: "#tooltip" },
})

defineSlots<{
	default?: () => VNode[]
	content?: () => VNode[]
}>()

const CLOSE_GRACE_MS = 150
const PRESS_TARGETS = 'button, a, [role="button"]'

const isOpen = ref(false)
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
// A press focuses its control, and that focusin must not reopen what the press closed, until a mouse
// or pen arrives or the pointer or focus leaves.
let dismissed = false

const trigger = ref<HTMLElement | null>(null)
const tip = ref<HTMLElement | null>(null)

const styles = reactive({
	transform: "translate3d(0, 0, 0)",
})

const delayMs = () => (typeof props.delay === "number" ? props.delay : Number.parseInt(props.delay, 10))

const cancelTimers = () => {
	clearTimeout(openTimer)
	clearTimeout(closeTimer)
	openTimer = undefined
	closeTimer = undefined
}

const show = () => {
	if (props.disabled || dismissed) return
	cancelTimers()
	isOpen.value = true
}

const hide = () => {
	cancelTimers()
	isOpen.value = false
}

const handleEnter = () => {
	if (props.disabled || dismissed) return
	clearTimeout(closeTimer)
	if (isOpen.value) return
	const delay = delayMs()
	if (!delay) return show()
	clearTimeout(openTimer)
	openTimer = setTimeout(show, delay)
}

const handleLeave = () => {
	clearTimeout(openTimer)
	openTimer = undefined
	if (!isOpen.value) return
	clearTimeout(closeTimer)
	closeTimer = setTimeout(hide, CLOSE_GRACE_MS)
}

const handleBubbleEnter = () => clearTimeout(closeTimer)

const handleMouseLeave = () => {
	dismissed = false
	handleLeave()
}

// `pointerenter`, not `mouseenter`: a tap's compatibility mouseenter falls between its pointerdown
// and its focus. Touch is skipped because it has no hover.
const handlePointerEnter = (event: PointerEvent) => {
	if (event.pointerType !== "touch") dismissed = false
}

const handleFocusOut = () => {
	dismissed = false
	hide()
}

// Bound in the capture phase, so a control that stops its own keydown or click still closes it.
const handlePress = (event: Event) => {
	const control = (event.target as Element | null)?.closest?.(PRESS_TARGETS)
	if (!control || !trigger.value?.contains(control)) return
	dismissed = true
	hide()
}

const handleKeydown = (event: KeyboardEvent) => {
	if (event.key === "Enter" || event.key === " ") handlePress(event)
}

// Window capture runs before focus-trap's and the menus' document listeners, so an open tooltip
// takes the first Escape and the popup or menu under it stays.
const handleEscape = (event: KeyboardEvent) => {
	if (event.key !== "Escape") return
	event.preventDefault()
	event.stopPropagation()
	hide()
}

const place = () => {
	if (!tip.value || !trigger.value) return
	const { x, y } = placeTooltip({
		trigger: trigger.value.getBoundingClientRect(),
		bubble: tip.value.getBoundingClientRect(),
		viewport: { width: window.innerWidth, height: window.innerHeight },
		side: props.side,
		position: props.position,
	})
	styles.transform = `translate3d(${x}px, ${y}px,0)`
}

const stopListening = () => {
	window.removeEventListener("keydown", handleEscape, true)
	window.removeEventListener("resize", place)
}

watch(isOpen, (open) => {
	if (!open) return stopListening()
	window.addEventListener("keydown", handleEscape, true)
	window.addEventListener("resize", place)
	nextTick(place)
})

onBeforeUnmount(() => {
	cancelTimers()
	stopListening()
})
</script>

<template>
	<div
		@pointerenter="handlePointerEnter"
		@mouseenter="handleEnter"
		@mouseleave="handleMouseLeave"
		@touchstart="handleEnter"
		@touchend="handleLeave"
		@focusin="show"
		@focusout="handleFocusOut"
		@pointerdown.capture="handlePress"
		@keydown.capture="handleKeydown"
		@click.capture="handlePress"
		:class="[$style.wrapper, inline && $style.inline]"
		:style="{ width: wide ? '100%' : undefined }"
	>
		<div
			ref="trigger"
			:class="[$style.trigger, inline && $style.inline]"
			:style="{ width: wide ? '100%' : undefined }"
		>
			<slot />
		</div>

		<teleport :to="teleportTo">
			<div
				v-if="isOpen"
				@click.stop
				@mousedown.prevent
				@mouseenter="handleBubbleEnter"
				@mouseleave="handleLeave"
				ref="tip"
				role="tooltip"
				data-testid="tooltip-bubble"
				:class="[$style.content, disabled && $style.disabled]"
				:style="styles"
			>
				<div
					data-testid="tooltip-text"
					:class="[$style.text]"
					:style="{
						textAlign: textAlign as 'left' | 'right' | 'center' | 'justify',
						maxWidth: maxWidth,
					}"
				>
					<slot name="content" />
				</div>
			</div>
		</teleport>
	</div>
</template>

<style module>
.wrapper {
	display: flex;
	position: relative;
	width: fit-content;
}

.trigger {
	display: flex;
}

.inline {
	display: inline-flex;
	align-items: baseline;
}

.content {
	position: fixed;
	top: 0;
	left: 0;
	z-index: 50000;

	width: max-content;
	max-width: min(272px, calc(100vw - 16px));

	box-sizing: border-box;
	background: var(--nulo-surface-highest);
	border: 1px solid var(--nulo-border);
	box-shadow: 0 4px 12px rgba(10, 9, 8, 0.6);

	padding: 6px 10px;

	animation: rise 0.12s ease-out;
}

.text {
	font-size: 12px;
	font-weight: 600;
	color: var(--txt-primary);
	overflow-wrap: anywhere;
}

/* The inline `transform` is the placement, so the rise animates `translate`. */
@keyframes rise {
	from {
		opacity: 0;
		translate: 0 -2px;
	}
}
</style>
