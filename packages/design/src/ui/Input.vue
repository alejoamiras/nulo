<script setup lang="ts">
/** Vendor */
import { computed, nextTick, onMounted, ref, watch, type PropType } from "vue"

/** Components */
import Flex from "../core/Flex.vue"
import Icon from "../core/Icon.vue"
import Text from "../core/Text.vue"
import Tooltip from "./Tooltip.vue"

/** Utils */
import { sanitizeString } from "../internal/sanitize"

const emit = defineEmits(["update:modelValue", "focus", "blur", "maxLengthReached", "clear"])
const props = defineProps({
	size: {
		type: String as PropType<"medium" | "small" | "mini">,
		default: "medium",
	},
	error: {
		type: Boolean,
		default: false,
	},
	type: {
		type: String,
	},
	subtype: {
		type: String,
	},
	sanitize: {
		type: Boolean,
		default: false,
	},
	max: {
		type: [String, Number],
	},
	maxLength: {
		type: Number,
		required: false,
	},
	label: {
		type: String,
	},
	leftText: {
		type: String,
		required: false,
	},
	suffix: {
		type: String,
		required: false,
	},
	icon: {
		type: String,
	},
	placeholder: {
		type: String,
		required: true,
	},
	modelValue: {
		type: [String, Number],
	},
	disabled: {
		type: Boolean,
	},
	autofocus: {
		type: Boolean,
		default: false,
	},
	clearable: {
		type: Boolean,
		default: false,
	},
	disablePaste: {
		type: Boolean,
		default: false,
	},
	autocomplete: {
		type: String,
		required: false,
	},
	autocapitalize: {
		type: String,
		required: false,
	},
	autocorrect: {
		type: String,
		required: false,
	},
	ariaInvalid: {
		type: Boolean,
		default: undefined,
	},
})

const isFocused = ref(false)

const inputEl = ref<HTMLInputElement | null>(null)
const focus = () => inputEl.value?.focus()
defineExpose({ inputEl, focus })

// `text` is intentionally a string|number|null union — the original binds modelValue ([String,Number])
// and assigns numbers/null in the int/clear branches. Casts at string-op sites preserve that.
const text = ref<string | number | null | undefined>(props.modelValue ? props.modelValue : "")
const warning = ref({
	show: false,
	text: "",
})
const fillWarning = (text?: string) => {
	if (text) {
		warning.value = {
			show: true,
			text,
		}
	} else {
		warning.value.show = false
	}
}

onMounted(() => {
	if (props.autofocus) {
		inputEl.value?.focus()
	}
})

watch(
	() => props.modelValue,
	() => {
		text.value = props.modelValue
	},
)

const getInputType = computed(() => {
	if (!!props.type) return props.type
	return "text"
})

const handleInput = (event?: Event) => {
	if (props.disabled) return

	text.value = props.sanitize ? sanitizeString(text.value as string, props.maxLength) : text.value

	if (!!props.maxLength) {
		fillWarning()
		emit("maxLengthReached", false)

		if ((text.value as string).length > props.maxLength) {
			text.value = (text.value as string).slice(0, props.maxLength)
		}

		if ((text.value as string).length === props.maxLength) {
			fillWarning(`You can’t enter more than ${props.maxLength} characters`)
			emit("maxLengthReached", true)
		}
	}

	if (props.type === "number") {
		emit(
			"update:modelValue",
			Number.isNaN(Number.parseFloat(text.value as string)) ? text.value : Number.parseFloat(text.value as string),
		)
	} else if (props.subtype === "int") {
		const value = (event!.target as HTMLInputElement).value.replace(/[^\d]/g, "")
		let res = value ? Number.parseInt(text.value as string, 10) : 0
		text.value = value ? value : 0

		if (props.max) {
			const max = Number(props.max)
			if (res > max) {
				res = max
				text.value = max
			}
		}

		emit("update:modelValue", res)
	} else {
		emit("update:modelValue", text.value)
	}
}

const handleKeydown = (e: KeyboardEvent) => {
	if (props.disabled && e.key !== "Tab") e.preventDefault()
	if (props.type === "number") {
		if (e.key === "-") e.preventDefault()
	}
}

const handleClick = () => {
	if (inputEl.value) inputEl.value.focus()
}

const handleFocus = () => {
	isFocused.value = true
	emit("focus")
}

const handleBlur = () => {
	isFocused.value = false
	emit("blur")
}

const handlePaste = (e: ClipboardEvent) => {
	if (props.disablePaste) {
		e.preventDefault()
		return
	}

	if (!!props.maxLength) {
		e.preventDefault()
		// `window.clipboardData` is the legacy IE fallback — cast to read it without `any`.
		const clip = e.clipboardData || (window as unknown as { clipboardData?: DataTransfer }).clipboardData
		const paste = (clip as DataTransfer).getData("text") || ""
		const el = inputEl.value as HTMLInputElement
		const start = el.selectionStart ?? (text.value as string).length
		const end = el.selectionEnd ?? start
		const before = (text.value as string).slice(0, start)
		const after = (text.value as string).slice(end)
		let newText = before + paste + after

		if (newText.length > props.maxLength) {
			newText = newText.slice(0, props.maxLength)
		}

		text.value = newText
		handleInput()

		nextTick(() => {
			const pos = Math.min(start + paste.length, props.maxLength as number)
			el.setSelectionRange(pos, pos)
		})

		return
	}
}

const handleClear = () => {
	isFocused.value = false
	text.value = null
	emit("clear")
	emit("blur")
}
</script>

<template>
	<Flex direction="column" gap="8">
		<Flex v-if="label" align="center" justify="between">
			<Flex align="center" gap="4">
				<Text size="13" weight="600" color="secondary">{{ label }}</Text>
				<slot name="labelSuffix" />
			</Flex>

			<Transition v-if="warning.show" name="fade">
				<Tooltip position="end">
					<Flex align="center" gap="6">
						<Icon name="warning" size="12" color="yellow" />
						<Text size="12" color="primary"> Maximum length reached </Text>
					</Flex>

					<template #content>
						{{ warning.text }}
					</template>
				</Tooltip>
			</Transition>

			<slot v-else name="right" />
		</Flex>

		<Flex
			ref="base"
			@click="handleClick"
			gap="12"
			:class="[$style.base, isFocused && $style.focused, disabled && $style.disabled, error && $style.error, $style[size]]"
		>
			<Flex align="center" gap="6" wide :class="$style.left">
				<Icon v-if="icon" :name="icon" size="16" color="tertiary" />
				<Text v-if="leftText" size="13" weight="600" color="tertiary">{{ leftText }}</Text>

				<input
					ref="inputEl"
					:type="getInputType"
					:max="max"
					v-model="text"
					@input="handleInput"
					@focus="handleFocus"
					@blur="handleBlur"
					@keydown="handleKeydown"
					@paste="handlePaste"
					:placeholder="placeholder"
					spellcheck="false"
					:autocomplete="autocomplete"
					:autocapitalize="autocapitalize"
					:autocorrect="autocorrect"
					:aria-invalid="ariaInvalid"
				/>
			</Flex>

			<Icon
				v-if="clearable && text"
				@click.stop="handleClear"
				name="close-circle"
				size="14"
				color="tertiary"
				:class="$style.clear_btn"
			/>
			
			<slot v-else name="suffix" />
		</Flex>

		<slot name="bottom" />
	</Flex>
</template>

<style module>
/**
 * Brutalist input visual — single canonical style. The legacy boxed
 * `default` variant was removed; callers that didn't pass `variant`
 * shift from the framed look to this brutalist underline.
 */
.base {
	display: flex;
	align-items: center;
	justify-content: space-between;

	border-radius: 0;
	border: none;
	border-bottom: 1px solid var(--nulo-border);
	background: transparent;
	padding: 12px 0;
	cursor: text;

	transition: border-color 0.2s ease;
}

.base:hover {
	border-bottom-color: var(--nulo-outline);
}

.base.focused {
	border-bottom-color: var(--nulo-accent);
}

.base.error {
	border-bottom-color: var(--red);
}

.base.disabled {
	opacity: 0.5;
	pointer-events: none;
}

/* Size variants are kept for callers that explicitly use them. The
 * brutalist style is height-auto by default; size classes are no-ops
 * unless overridden. */
.base.medium {
	min-height: 40px;
}

.base.small {
	min-height: 30px;
}

.base.mini {
	min-height: 24px;
	input {
		font-size: 12px;
	}
}

.base input {
	border: none;
	outline: none;
	width: 100%;
	height: 100%;
	padding: 0;
	background: transparent;

	font-family: var(--font-body);
	font-size: 15px;
	font-weight: 500;
	color: var(--txt-primary);

	text-overflow: ellipsis;
}

.base input::placeholder {
	color: var(--nulo-outline);
}

.base input::-webkit-outer-spin-button,
.base input::-webkit-inner-spin-button {
	-webkit-appearance: none;
	margin: 0;
}

.left {
	height: 100%;
}

.clear_btn {
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}
</style>
