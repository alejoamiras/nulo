<script setup lang="ts">
/**
 * Thin wrapper over the shared <Input> for ADDRESS fields. A long `0x…` value
 * overflows the native input, which is then horizontally SCROLLABLE — at rest the
 * user can drag it around so it shows mid-address (janky / "broken" UX). While the
 * field is NOT focused we PIN it to the start: any scroll snaps `scrollLeft` back
 * to 0, so a blurred address always reads cleanly from `0x…` (with the Input's
 * `text-overflow: ellipsis`) and can't be dragged. While focused, scrolling is
 * allowed (you're editing).
 *
 * The native <input> stays mounted and its value is NEVER rewritten — paste,
 * selection, the `[data-testid] input` e2e selector, and screen readers are all
 * untouched. This is the extension-side affordance (NOT a `@nulo/design` change).
 */
import { onBeforeUnmount, onMounted, ref } from "vue"

defineOptions({ inheritAttrs: false })
// `placeholder` is the one REQUIRED prop on the underlying <Input>; declare it
// here (default "") so vue-tsc sees it satisfied — the rest pass via $attrs.
withDefaults(defineProps<{ placeholder?: string }>(), { placeholder: "" })
const emit = defineEmits(["blur", "focus"])

const inputRef = ref<{ $el?: HTMLElement; focus?: () => void } | null>(null)
let inputEl: HTMLInputElement | null = null
let focused = false

// Native listeners on the actual <input> (not the component's emit chain) so the
// pinning is robust. `scrollLeft !== 0` guard bounds the scroll→reset→scroll loop.
const pinStart = () => {
	if (!focused && inputEl && inputEl.scrollLeft !== 0) inputEl.scrollLeft = 0
}
const onNativeFocus = () => {
	focused = true
}
const onNativeBlur = () => {
	focused = false
	pinStart()
}

onMounted(() => {
	inputEl = inputRef.value?.$el?.querySelector?.("input") ?? null
	if (!inputEl) return
	inputEl.addEventListener("scroll", pinStart, { passive: true })
	inputEl.addEventListener("focus", onNativeFocus)
	inputEl.addEventListener("blur", onNativeBlur)
})
onBeforeUnmount(() => {
	inputEl?.removeEventListener("scroll", pinStart)
	inputEl?.removeEventListener("focus", onNativeFocus)
	inputEl?.removeEventListener("blur", onNativeBlur)
})

defineExpose({
	focus: () => inputRef.value?.focus?.(),
})
</script>

<template>
	<Input ref="inputRef" :placeholder="placeholder" v-bind="$attrs" @blur="emit('blur')" @focus="emit('focus')">
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope" />
		</template>
	</Input>
</template>
