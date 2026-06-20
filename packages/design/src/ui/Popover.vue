<script setup lang="ts">
/** Vendor */
import { nextTick, reactive, ref, watch } from "vue"

/** Composables */
import { useOutside } from "../composables/outside"

/** Components */
import Flex from "../core/Flex.vue"

// (BUG PIN) Initialised to null and assigned only inside the open-branch `nextTick`. If `open` flips
// to false BEFORE that nextTick runs, the else-branch calls `removeOutside()` on null → throws.
// Preserved verbatim from the extension.
let removeOutside: (() => void) | null = null

const props = defineProps({
	open: {
		type: Boolean,
		default: false,
	},
	width: {
		type: String,
		default: null,
	},
	height: {
		type: String,
		default: null,
	},
	side: {
		type: String,
		default: "left",
	},
	disabled: {
		type: Boolean,
		default: false,
	},
	// Host-DOM contract: the consuming app must declare this teleport root (the extension declares
	// `#popover` in its popup/onboarding shells).
	teleportTo: {
		type: String,
		default: "#popover",
	},
})
const emit = defineEmits(["onClose"])

const triggerEl = ref<HTMLElement>()
const cardEl = ref<HTMLElement>()

const popoverStyles = reactive<Record<string, string>>({})

const onClose = () => {
	emit("onClose")
}

const onKeydown = (e: KeyboardEvent) => {
	if (e.code === "Escape") onClose()
}

watch(
	() => props.open,
	() => {
		if (props.open) {
			const triggerRect = (triggerEl.value as HTMLElement).getBoundingClientRect()

			popoverStyles.top = `${triggerRect.y + triggerRect.height + 8}px`
			switch (props.side) {
				case "left":
					popoverStyles[props.side] = `${triggerRect.x + triggerRect.width - Number(props.width)}px`
					break
				case "right":
					popoverStyles[props.side] = `${Number(props.width) - triggerRect.x - triggerRect.width}px`
					break
			}

			document.addEventListener("scroll", onClose)
			document.addEventListener("keydown", onKeydown)

			nextTick(() => {
				removeOutside = useOutside(cardEl.value, onClose)
			})
		} else {
			document.removeEventListener("scroll", onClose)
			document.removeEventListener("keydown", onKeydown)
			;(removeOutside as () => void)()
		}
	},
)
</script>

<template>
	<Flex :class="disabled && $style.disabled">
		<div ref="triggerEl">
			<slot />
		</div>

		<teleport :to="teleportTo">
			<div v-if="open" :class="$style.canvas" />

			<Transition name="fastfade">
				<div v-if="open" :style="popoverStyles" :class="$style.popover">
					<div ref="cardEl" :style="{ width: `${width}px`, height: `${height}px` }" :class="$style.card">
						<slot name="content" />
					</div>
				</div>
			</Transition>
		</teleport>
	</Flex>
</template>

<style module>
.popover {
	position: fixed;
	z-index: 2010;
}

.canvas {
	position: fixed;
	inset: 0;
	z-index: 2005;
}

.card {
	overflow: hidden;

	border-radius: 10px;
	background: var(--dropdown-bg);
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 14px 34px rgba(0, 0, 0, 15%), 0 4px 14px rgba(0, 0, 0, 5%);

	padding: 6px 0;
}

.disabled {
	opacity: 0.6;
	cursor: auto;
	pointer-events: none;
}
</style>
