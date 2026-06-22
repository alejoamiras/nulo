<script setup lang="ts">
/**
 * Thin wrapper over the shared <Input> for ADDRESS fields. A long `0x…` value
 * scrolls the native input so its start is hidden once it overflows / on focus
 * ("the address goes to the left and we don't see anything"). On blur we reset
 * the input's `scrollLeft` to 0 so the address reads from the START at rest
 * (`0x3333…`, via the Input's `text-overflow: ellipsis`).
 *
 * The native <input> STAYS MOUNTED and its value is NEVER rewritten — paste,
 * selection, the `[data-testid] input` e2e selector, and screen readers are all
 * untouched. This is the extension-side affordance (NOT a `@nulo/design` change).
 * All props/slots/events pass through to the underlying <Input>.
 */
import { ref } from "vue"

defineOptions({ inheritAttrs: false })
// `placeholder` is the one REQUIRED prop on the underlying <Input>; declare it
// here (default "") so vue-tsc sees it satisfied — the rest pass via $attrs.
withDefaults(defineProps<{ placeholder?: string }>(), { placeholder: "" })
const emit = defineEmits(["blur", "focus"])

const inputRef = ref<{ inputEl?: HTMLInputElement | null; focus?: () => void } | null>(null)

const handleBlur = () => {
	const el = inputRef.value?.inputEl
	if (el) el.scrollLeft = 0
	emit("blur")
}

defineExpose({
	focus: () => inputRef.value?.focus?.(),
})
</script>

<template>
	<Input ref="inputRef" :placeholder="placeholder" v-bind="$attrs" @blur="handleBlur" @focus="emit('focus')">
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope" />
		</template>
	</Input>
</template>
