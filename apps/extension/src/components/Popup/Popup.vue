<script setup>
/** Vendor */
import * as focusTrap from "focus-trap"

/** Utils */
import { managers } from "@/utils/core"

const props = defineProps({
	show: {
		type: Boolean,
		default: false,
	},
	displaceIdx: {
		type: Number,
	},
	/** Escape closes the popup the way tapping outside does. Off, Escape does nothing and the trap holds. */
	closeOnEscape: {
		type: Boolean,
		default: true,
	},
	/** What the trap focuses on activation: a selector, or false to leave focus where it was. */
	initialFocus: {
		type: [String, Boolean],
		default: false,
	},
})
const emit = defineEmits(["onClose"])

let trap
let mounted = true
// Activation waits a tick; only the latest request may create a trap, and only while still shown and mounted.
let activation = 0
const popupEl = useTemplateRef("popupEl")

const onEscape = (event) => {
	event.preventDefault()
	emit("onClose")
	return false
}

const releaseTrap = (options) => {
	if (trap?.active) trap.deactivate(options)
	trap = undefined
}

const activate = async () => {
	const _ = managers.profile?.refreshSession()
	const token = ++activation
	// Read before the tick: a child may focus its own input from a continuation queued in this same
	// flush, and the trap would then record that input as where focus returns on close.
	const opener = document.activeElement ?? undefined

	await nextTick()
	const container = popupEl.value?.wrapper
	if (token !== activation || !mounted || !props.show || !container) return

	releaseTrap({ returnFocus: false })
	trap = focusTrap.createFocusTrap(container, {
		initialFocus: props.initialFocus,
		allowOutsideClick: true,
		fallbackFocus: container,
		setReturnFocus: opener,
		escapeDeactivates: props.closeOnEscape ? onEscape : false,
	})
	trap.activate()
}

const deactivate = async () => {
	activation++
	await nextTick()
	releaseTrap()
}

watch(
	() => props.show,
	() => (props.show ? activate() : deactivate()),
	{ flush: "post" },
)

onBeforeUnmount(() => {
	mounted = false
	activation++
	releaseTrap({ returnFocus: false })
})
</script>

<template>
	<Transition name="slideopacity">
		<div v-if="show" :class="$style.dark_bg" :style="{ zIndex: (displaceIdx + 1) * 100 * 4 }" />
	</Transition>
	<Transition name="slide" appear>
		<template v-if="show">
			<teleport to="#popup">
				<Flex
					ref="popupEl"
					direction="column"
					:class="$style.wrapper"
					:style="{ zIndex: (displaceIdx + 1) * 100 * 5 }"
				>
					<div @click="emit('onClose')" :class="$style.close_area" />

					<!-- Need to refactor !!! -->
					<button style="position: absolute; opacity: 0; pointer-events: none;" aria-hidden="true" tabindex="0">
						focus trap dummy
					</button>

					<slot />
				</Flex>
			</teleport>
		</template>
	</Transition>
</template>

<style module>
.wrapper {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
}

.close_area {
	flex: 1;

	width: 100%;
	min-height: 40px;
}

.dark_bg {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;

	background: rgba(10, 9, 8, 0.8);
}
</style>
