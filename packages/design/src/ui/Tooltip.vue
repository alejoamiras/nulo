<script setup lang="ts">
/**
 * Vendor
 */
import { ref, reactive, nextTick, watch } from "vue"
import type { PropType, VNode } from "vue"

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
	/** Cap on the tooltip's text width (CSS length string, e.g. "220px").
	 *  Default keeps the prior behavior: clamp to the popup viewport minus
	 *  padding. Callers with a short trigger + long copy should pass an
	 *  explicit value to avoid the tooltip rendering full-popup-width. */
	maxWidth: { type: String, default: undefined },
	// Host-DOM contract: the consuming app must declare this teleport root (the extension declares
	// `#tooltip` in its popup/onboarding shells). The tooltip text also clamps to
	// `calc(var(--base-width) - 40px)`, so the host must define the `--base-width` CSS var.
	teleportTo: { type: String, default: "#tooltip" },
})

defineSlots<{
	default?: () => VNode[]
	content?: () => VNode[]
}>()

const isHovered = ref(false)
const delayedHover = ref<ReturnType<typeof setTimeout> | null>(null)

const trigger = ref<HTMLElement | null>(null)
const tip = ref<HTMLElement | null>(null)

const styles = reactive({
	transform: "translate3d(0, 0, 0)",
})

watch(
	() => isHovered.value,
	() => {
		nextTick(() => {
			if (!tip.value || !trigger.value) return

			const triggerRect = trigger.value.getBoundingClientRect()
			const tooltipRect = tip.value.getBoundingClientRect()

			let xPos = 0
			let yPos = 0

			switch (props.side) {
				case "top":
					yPos = triggerRect.top - tooltipRect.height - 8

					switch (props.position) {
						case "center":
							xPos = triggerRect.left - (tooltipRect.width / 2 - triggerRect.width / 2)
							break

						case "start":
							xPos = triggerRect.left
							break

						case "end":
							xPos = triggerRect.right - tooltipRect.width
							break
					}
					break

				case "bottom":
					yPos = triggerRect.bottom + 8

					switch (props.position) {
						case "center":
							xPos = triggerRect.left - (tooltipRect.width / 2 - triggerRect.width / 2)
							break

						case "start":
							xPos = triggerRect.left
							break

						case "end":
							xPos = triggerRect.right - tooltipRect.width
							break
					}
					break

				case "left":
					xPos = triggerRect.left - tooltipRect.width - 8

					switch (props.position) {
						case "center":
							yPos = triggerRect.top - (tooltipRect.height / 2 - triggerRect.height / 2)
							break

						case "start":
							yPos = triggerRect.top
							break

						case "end":
							yPos = triggerRect.bottom - tooltipRect.height
							break
					}
					break

				case "right":
					xPos = triggerRect.right + 8

					switch (props.position) {
						case "center":
							yPos = triggerRect.top - (tooltipRect.height / 2 - triggerRect.height / 2)
							break

						case "start":
							yPos = triggerRect.top
							break

						case "end":
							yPos = triggerRect.bottom - tooltipRect.height
							break
					}
					break

				default:
					break
			}

			styles.transform = `translate3d(${xPos}px, ${yPos}px,0)`
		})
	},
)

const handleMouseEnter = () => {
	if (props.disabled) return

	if (props.delay) {
		delayedHover.value = setTimeout(
			() => {
				isHovered.value = true
			},
			typeof props.delay === "number" ? props.delay : Number.parseInt(props.delay, 10),
		)
	} else {
		isHovered.value = true
	}
}

const handleMouseLeave = () => {
	isHovered.value = false

	if (delayedHover.value) {
		clearTimeout(delayedHover.value)
	}
}

// Keyboard parity: focusin/focusout bubble from any focusable child of the trigger, so a
// tab-focused trigger shows the tooltip. Focus is deliberate — no hover delay applies.
const handleFocusIn = () => {
	if (props.disabled) return
	isHovered.value = true
}
</script>

<template>
	<div
		@mouseenter="handleMouseEnter"
		@mouseleave="handleMouseLeave"
		@touchstart="handleMouseEnter"
		@touchend="handleMouseLeave"
		@focusin="handleFocusIn"
		@focusout="handleMouseLeave"
		:class="$style.wrapper"
		:style="{ width: wide ? '100%' : undefined }"
	>
		<div
			ref="trigger"
			:class="$style.trigger"
			:style="{ width: wide ? '100%' : undefined }"
		>
			<slot />
		</div>

		<teleport :to="teleportTo">
			<Transition
				:enter-from-class="$style['fade-from']"
				:enter-active-class="$style['fade-active']"
				:enter-to-class="$style['fade-to']"
				:leave-from-class="$style['fade-to']"
				:leave-active-class="$style['fade-active']"
				:leave-to-class="$style['fade-from']"
			>
				<div
					v-if="isHovered"
					@click.stop
					ref="tip"
					:class="[$style.content, disabled && $style.disabled]"
					:style="styles"
				>
					<div
						:class="[$style.text]"
						:style="{
							textAlign: textAlign as 'left' | 'right' | 'center' | 'justify',
							maxWidth: maxWidth,
						}"
					>
						<slot name="content" />
					</div>
				</div>
			</Transition>
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

.content {
	position: fixed;
	top: 0;
	left: 0;
	z-index: 50000;

	width: max-content;

	box-sizing: border-box;
	background: var(--nulo-surface-highest);
	border: 1px solid var(--nulo-border);
	box-shadow: 0 4px 12px rgba(10, 9, 8, 0.6);

	padding: 6px 10px;
}

.text {
	max-width: calc(var(--base-width) - 40px);

	font-size: 12px;
	font-weight: 600;
	color: var(--txt-primary);
}

/* Opacity-only fade. We can't animate transform here — the position
 * resolver applies the (x, y) translate as an inline style on the same
 * element, which would override any class-driven transform mid-animation.
 * Bound via :enter-*-class / :leave-*-class on the Transition because
 * <style module> hashes class names. */
.fade-active {
	transition: opacity 0.12s ease;
}

.fade-from {
	opacity: 0;
}

.fade-to {
	opacity: 1;
}
</style>
