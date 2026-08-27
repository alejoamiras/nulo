<script setup>
/**
 * Vendor
 */
import { ref, watch, nextTick, onBeforeUnmount } from "vue"
import * as focusTrap from "focus-trap"

/**
 * Composable
 */
import { useOutside } from "@/composables/outside"

const props = defineProps({
	side: {
		type: String,
		default: "bottom",
		validator: (value) => {
			return ["top", "bottom", "left", "right"].includes(value)
		},
	},
	position: {
		type: String,
		default: "start",
		validator: (value) => {
			return ["start", "end"].includes(value)
		},
	},

	forceOpen: Boolean,
	disabled: Boolean,

	wide: {
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
	fullWidth: {
		type: Boolean,
		default: false,
	},
	customPosition: {
		type: Object,
	},

	verticalOverflow: {
		type: Boolean,
		default: false,
	},
})

const emit = defineEmits(["onClose", "onOpen"])

const trigger = ref(null)
const dropdown = ref(null)
const isOpen = ref(false)
const trap = ref({})

watch(
	() => props.forceOpen,
	() => {
		isOpen.value = props.forceOpen
	},
)

const toggleDropdown = (event) => {
	if (event) event.stopPropagation()
	if (props.disabled) return
	isOpen.value = !isOpen.value
}
const close = (event) => {
	if (event) event.stopPropagation()

	isOpen.value = false
}

const dropdownStyles = ref({})

let removeOutside
const handleOutside = (e) => {
	const path = e.path ? e.path : e.composedPath()
	if (path.find((el) => el.id === "trigger")) {
		return
	}

	close()
}

watch(isOpen, async () => {
	if (!isOpen.value) {
		await nextTick()
		if (trap.value?.active) {
			trap.value.deactivate()
		}

		removeOutside?.()

		if (Object.hasOwn(dropdownStyles.value, "top")) {
			dropdownStyles.value.top = undefined
		}
		if (Object.hasOwn(dropdownStyles.value, "bottom")) {
			dropdownStyles.value.bottom = undefined
		}

		emit("onClose")

		document.removeEventListener("keydown", onKeydown)
	} else {
		document.addEventListener("keydown", onKeydown)

		const triggerRect = trigger.value.getBoundingClientRect()

		if (props.width) {
			dropdownStyles.value.width = `${props.width}px`
		}

		if (props.fullWidth) {
			dropdownStyles.value.width = `${triggerRect.width}px`
		}

		switch (props.position) {
			case "start":
				dropdownStyles.value.right = `${window.innerWidth - triggerRect.x - triggerRect.width}px`
				if (props.wide) dropdownStyles.value.left = `${triggerRect.x}px`
				break

			case "end":
				dropdownStyles.value.left = `${triggerRect.x}px`
				break
		}

		nextTick(() => {
			let candidate
			try {
				candidate = focusTrap.createFocusTrap(dropdown.value.$el, {
					initialFocus: false,
					// Container is focusable (tabindex=-1) so focus-trap can hold focus even
					// when every menu item is disabled (no tabbable node) — the case that
					// otherwise makes activate() throw. The try/catch stays as a backstop.
					fallbackFocus: () => dropdown.value?.$el,
				})
				candidate.activate()
				trap.value = candidate
			} catch {
				// Backstop: fallbackFocus should prevent the no-tabbable throw, but if activate()
				// still fails after partially installing listeners, deactivate the candidate so we
				// don't leak focus isolation — then leave `trap` inert (its deactivate() no-ops).
				// A menu that can't trap focus is far better than the y:0 undismissable lock-up
				// this whole path exists to prevent.
				try {
					candidate?.deactivate?.()
				} catch {
					// deactivating a half-activated trap can itself throw; ignore.
				}
				trap.value = {}
			}

			/** Check if there is enough space to open (top/bottom) */
			const dropdownRect = dropdown.value.$el.getBoundingClientRect()

			switch (props.side) {
				case "top":
					if (triggerRect.top < dropdownRect.height) {
						dropdownStyles.value.top = `${triggerRect.y + triggerRect.height + 8}px`
					} else {
						dropdownStyles.value.bottom = `${window.innerHeight - triggerRect.y + 8}px`
					}
					break

				case "bottom":
					if (window.innerHeight - dropdownRect.height - triggerRect.top < 50) {
						dropdownStyles.value.bottom = `${window.innerHeight - triggerRect.y + 8}px`
					} else {
						dropdownStyles.value.top = `${triggerRect.y + triggerRect.height + 8}px`
					}
					break
			}

			if (props.customPosition) {
				dropdownStyles.value.top = undefined
				dropdownStyles.value.bottom = undefined
				dropdownStyles.value.left = undefined
				dropdownStyles.value.right = undefined

				dropdownStyles.value = { ...props.customPosition }
			}

			if (props.height) dropdownStyles.value.maxHeight = props.height
			if (props.verticalOverflow) dropdownStyles.value.overflowY = "auto"

			emit("onOpen")

			removeOutside = useOutside(dropdown.value.wrapper, handleOutside)
		})
	}
})

onBeforeUnmount(() => {
	if (trap.value.active) trap.value.deactivate()
	if (removeOutside) removeOutside()
	document.removeEventListener("keydown", onKeydown)
})

const onKeydown = (event) => {
	if (event.key === "Escape") close()
	if (event.key === "Enter") {
		if (document.activeElement?.getAttribute("aria-disabled") !== "true") document.activeElement?.click()
	}

	if (event.key === "ArrowDown") {
		if (!dropdown.value?.wrapper) return
		const itemsToNavigate = dropdown.value.wrapper.querySelectorAll("[data-dropdown-item]")
		if (!itemsToNavigate.length) return
		const activeItemIdx = [...itemsToNavigate].findIndex((item) => item.isEqualNode(document.activeElement))

		if (activeItemIdx === -1 || activeItemIdx === itemsToNavigate.length - 1) {
			itemsToNavigate[0].focus()
		} else {
			itemsToNavigate[activeItemIdx + 1].focus()
		}
	}

	if (event.key === "ArrowUp") {
		if (!dropdown.value?.wrapper) return
		const itemsToNavigate = dropdown.value.wrapper.querySelectorAll("[data-dropdown-item]")
		if (!itemsToNavigate.length) return
		const activeItemIdx = [...itemsToNavigate].findIndex((item) => item.isEqualNode(document.activeElement))

		if (activeItemIdx === -1 || activeItemIdx === 0) {
			itemsToNavigate[itemsToNavigate.length - 1].focus()
		} else {
			itemsToNavigate[activeItemIdx - 1].focus()
		}
	}
}
</script>

<template>
	<div :class="$style.wrapper" :data-dropdown-open="isOpen ? 'true' : 'false'">
		<div ref="trigger" id="trigger" @click="toggleDropdown" :class="[$style.trigger]">
			<slot />
			<slot name="trigger" :isOpen="isOpen" />
		</div>

		<teleport to="#dropdown">
			<div v-if="isOpen" :class="$style.canvas" />

			<Transition name="dropdown">
				<Flex
					v-if="isOpen"
					ref="dropdown"
					tabindex="-1"
					@click="close"
					:class="[
						$style.dropdown,
						dropdownStyles.top ? $style.transform_origin_top : $style.transform_origin_bottom,
					]"
					:style="{
						...dropdownStyles,
					}"
					direction="column"
					gap="4"
				>
					<slot name="popup" />
				</Flex>
			</Transition>
		</teleport>
	</div>
</template>

<style module>
.wrapper {
	position: relative;
}

.trigger {
	width: 100%;
	cursor: pointer;
}

.canvas {
	position: fixed;
	inset: 0;
	z-index: 2000;
}

.dropdown {
	position: fixed;
	z-index: 2001;

	background: var(--app-bg);
	border: 2px solid var(--nulo-outline);

	padding: 4px 0;
}

.dropdown.transform_origin_top {
	transform-origin: top;
}

.dropdown.transform_origin_bottom {
	transform-origin: bottom center;
}
</style>
